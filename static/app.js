// ══════════════════════════════════════════════════════════
// PeliScraper - Lógica de la interfaz web
// Maneja la comunicación con la API, renderizado de contenido,
// control del scraping y polling de progreso en tiempo real
// ══════════════════════════════════════════════════════════

// ─── ESTADO GLOBAL ──────────────────────────────────────
const state = {
    currentPage: 'dashboard',
    pages: { movies: 1, tvshows: 1, animes: 1 },
    searchTimers: {},
    pollingInterval: null,
    genres: [],
    years: [],
};

// Mapeo de tipos de contenido a nombres de sección
const TYPE_MAP = {
    movies: { label: 'Películas', page: 'movies', icon: '🎬' },
    tvshows: { label: 'Series', page: 'series', icon: '📺' },
    animes: { label: 'Animes', page: 'animes', icon: '🎌' },
};

// Mapeo de tipo a sufijo de ID en el DOM
const TYPE_TO_DOM = {
    movies: 'Movies',
    tvshows: 'Series',
    animes: 'Animes',
};

// URL base de imágenes de la.movie
const IMG_BASE = 'https://la.movie/wp-content/uploads';

// ─── INICIALIZACIÓN ─────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    // Configurar navegación
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.addEventListener('click', () => navigateTo(btn.dataset.page));
    });

    // Cerrar modal con Escape
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') closeModal();
    });

    // Cerrar modal al hacer clic fuera
    document.getElementById('detailModal').addEventListener('click', e => {
        if (e.target === e.currentTarget) closeModal();
    });

    // Mostrar/ocultar controles de página según tipo de scraping
    document.getElementById('scrapeType').addEventListener('change', e => {
        const showPages = ['movies', 'tvshows', 'animes'].includes(e.target.value);
        document.getElementById('pageControls').style.display = showPages ? '' : 'none';
        document.getElementById('endPageControls').style.display = showPages ? '' : 'none';
    });

    // Cargar datos iniciales
    loadStats();
    loadJobHistory();
    loadFilters();
    startPolling();
});

// ─── NAVEGACIÓN ─────────────────────────────────────────
function navigateTo(page) {
    state.currentPage = page;

    // Actualizar botones de navegación
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.page === page);
    });

    // Mostrar página activa
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById(`page-${page}`).classList.add('active');

    // Cargar contenido si es una página de contenido
    if (page === 'movies') loadContent('movies');
    if (page === 'series') loadContent('tvshows');
    if (page === 'animes') loadContent('animes');
    if (page === 'dashboard') {
        loadStats();
        loadJobHistory();
    }
}

// ─── API ────────────────────────────────────────────────
async function api(url, options = {}) {
    try {
        const response = await fetch(url, {
            headers: { 'Content-Type': 'application/json' },
            ...options,
        });
        return await response.json();
    } catch (error) {
        console.error('Error API:', error);
        showToast('Error de conexión con el servidor', 'error');
        return null;
    }
}

// ─── ESTADÍSTICAS ───────────────────────────────────────
async function loadStats() {
    const result = await api('/api/stats');
    if (!result || result.error) return;

    const s = result.stats;
    document.getElementById('statMovies').textContent = s.movies.toLocaleString();
    document.getElementById('statSeries').textContent = s.series.toLocaleString();
    document.getElementById('statAnimes').textContent = s.animes.toLocaleString();
    document.getElementById('statDownloads').textContent = s.downloads.toLocaleString();
    document.getElementById('statEpisodes').textContent = s.episodes.toLocaleString();
    document.getElementById('statWithDl').textContent = s.with_downloads.toLocaleString();

    // Actualizar badges en la navegación
    document.getElementById('moviesCount').textContent = s.movies.toLocaleString();
    document.getElementById('seriesCount').textContent = s.series.toLocaleString();
    document.getElementById('animesCount').textContent = s.animes.toLocaleString();
}

// ─── FILTROS ────────────────────────────────────────────
async function loadFilters() {
    // Cargar géneros
    const genresResult = await api('/api/genres');
    if (genresResult && !genresResult.error) {
        state.genres = genresResult.genres;
        ['Movies', 'Series', 'Animes'].forEach(suffix => {
            const select = document.getElementById(`genreFilter${suffix}`);
            genresResult.genres.forEach(g => {
                const opt = document.createElement('option');
                opt.value = g;
                opt.textContent = g;
                select.appendChild(opt);
            });
        });
    }

    // Cargar años
    const yearsResult = await api('/api/years');
    if (yearsResult && !yearsResult.error) {
        state.years = yearsResult.years;
        ['Movies', 'Series', 'Animes'].forEach(suffix => {
            const select = document.getElementById(`yearFilter${suffix}`);
            yearsResult.years.forEach(y => {
                const opt = document.createElement('option');
                opt.value = y;
                opt.textContent = y;
                select.appendChild(opt);
            });
        });
    }
}

// ─── CONTENIDO ──────────────────────────────────────────
async function loadContent(contentType, page = null) {
    const suffix = TYPE_TO_DOM[contentType];
    if (!suffix) return;

    if (page !== null) state.pages[contentType] = page;
    const currentPage = state.pages[contentType] || 1;

    const search = document.getElementById(`search${suffix}`).value;
    const genre = document.getElementById(`genreFilter${suffix}`).value;
    const year = document.getElementById(`yearFilter${suffix}`).value;
    const sort = document.getElementById(`sort${suffix}`).value;

    // Mostrar loader
    const grid = document.getElementById(`grid${suffix}`);
    const loader = document.getElementById(`loader${suffix}`);
    grid.innerHTML = '';
    loader.classList.add('active');

    const params = new URLSearchParams({
        type: contentType,
        page: currentPage,
        per_page: 24,
        search: search,
        genre: genre,
        year: year,
        sort: sort,
        order: sort === 'title' ? 'asc' : 'desc',
    });

    const result = await api(`/api/content?${params}`);
    loader.classList.remove('active');

    if (!result || result.error) {
        grid.innerHTML = renderEmptyState('Error al cargar contenido');
        return;
    }

    if (result.data.length === 0) {
        grid.innerHTML = renderEmptyState(search ? 'Sin resultados para tu búsqueda' : 'No hay contenido. Inicia un scraping desde el Dashboard.');
        return;
    }

    // Renderizar tarjetas
    grid.innerHTML = result.data.map(item => renderCard(item)).join('');

    // Renderizar paginación
    renderPagination(contentType, result.pagination);
}

function renderCard(item) {
    const posterUrl = item.poster || '';
    const posterHtml = posterUrl
        ? `<img class="card-poster" src="${posterUrl}" alt="${escapeHtml(item.title)}" loading="lazy" onerror="this.outerHTML='<div class=\\'card-poster-placeholder\\'>🎬</div>'">`
        : `<div class="card-poster-placeholder">🎬</div>`;

    const typeLabel = TYPE_MAP[item.content_type] || {};
    const genres = (item.genres || []).slice(0, 2);
    const languages = (item.languages || []);

    return `
        <div class="content-card" onclick="openDetail(${item.id})">
            <span class="card-type-badge ${item.content_type}">${typeLabel.icon || ''} ${typeLabel.label || item.content_type}</span>
            ${item.downloads_scraped ? '<span class="card-download-badge" title="Descargas disponibles">📥</span>' : ''}
            ${posterHtml}
            <div class="card-info">
                <div class="card-title" title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</div>
                <div class="card-meta">
                    ${item.rating ? `<span class="card-rating">⭐ ${item.rating}</span>` : ''}
                    ${item.year ? `<span>${item.year}</span>` : ''}
                    ${languages.length ? `<span>${languages.join(', ')}</span>` : ''}
                </div>
                ${genres.length ? `<div class="card-genres">${genres.map(g => `<span class="genre-tag">${g}</span>`).join('')}</div>` : ''}
            </div>
        </div>
    `;
}

function renderPagination(contentType, pagination) {
    const suffix = TYPE_TO_DOM[contentType];
    const container = document.getElementById(`pagination${suffix}`);
    if (!pagination || pagination.pages <= 1) {
        container.innerHTML = '';
        return;
    }

    const { page, pages, has_prev, has_next, total } = pagination;
    let html = '';

    html += `<button ${!has_prev ? 'disabled' : ''} onclick="loadContent('${contentType}', ${page - 1})">← Anterior</button>`;

    // Calcular rango de páginas visibles
    const range = 3;
    let start = Math.max(1, page - range);
    let end = Math.min(pages, page + range);

    if (start > 1) {
        html += `<button onclick="loadContent('${contentType}', 1)">1</button>`;
        if (start > 2) html += `<span class="page-info">...</span>`;
    }

    for (let i = start; i <= end; i++) {
        html += `<button class="${i === page ? 'active' : ''}" onclick="loadContent('${contentType}', ${i})">${i}</button>`;
    }

    if (end < pages) {
        if (end < pages - 1) html += `<span class="page-info">...</span>`;
        html += `<button onclick="loadContent('${contentType}', ${pages})">${pages}</button>`;
    }

    html += `<button ${!has_next ? 'disabled' : ''} onclick="loadContent('${contentType}', ${page + 1})">Siguiente →</button>`;
    html += `<span class="page-info">${total.toLocaleString()} resultados</span>`;

    container.innerHTML = html;
}

// ─── DETALLE / MODAL ────────────────────────────────────
async function openDetail(contentId) {
    const modal = document.getElementById('detailModal');
    const body = document.getElementById('modalBody');
    const hero = document.getElementById('modalHero');
    const backdropContainer = document.getElementById('modalBackdropContainer');

    // Mostrar modal con loader
    modal.classList.add('active');
    body.innerHTML = '<div class="loader active"><div class="spinner"></div>Cargando detalles...</div>';
    hero.innerHTML = '';
    backdropContainer.innerHTML = '<div class="modal-backdrop-placeholder"></div>';

    const result = await api(`/api/content/${contentId}`);
    if (!result || result.error) {
        body.innerHTML = '<p style="padding:20px;color:var(--danger)">Error al cargar detalles</p>';
        return;
    }

    const item = result.data;

    // Backdrop
    if (item.backdrop) {
        backdropContainer.innerHTML = `<img class="modal-backdrop" src="${item.backdrop}" alt="" onerror="this.outerHTML='<div class=\\'modal-backdrop-placeholder\\'></div>'">`;
    }

    // Hero (poster + título)
    hero.innerHTML = `
        ${item.poster ? `<img class="modal-poster" src="${item.poster}" alt="" onerror="this.style.display='none'">` : ''}
        <div class="modal-title-area">
            <h2>${escapeHtml(item.title)}</h2>
            ${item.original_title && item.original_title !== item.title ? `<div class="original-title">${escapeHtml(item.original_title)}</div>` : ''}
        </div>
    `;

    // Body del modal
    let bodyHtml = '';

    // Meta tags
    bodyHtml += '<div class="modal-meta">';
    if (item.rating) bodyHtml += `<span class="meta-tag rating">⭐ ${item.rating}</span>`;
    if (item.year) bodyHtml += `<span class="meta-tag">📅 ${item.year}</span>`;
    if (item.runtime) bodyHtml += `<span class="meta-tag">⏱️ ${item.runtime} min</span>`;
    if (item.certification) bodyHtml += `<span class="meta-tag">🔞 ${item.certification}</span>`;
    item.genres.forEach(g => { bodyHtml += `<span class="meta-tag">${g}</span>`; });
    item.languages.forEach(l => { bodyHtml += `<span class="meta-tag">🗣️ ${l}</span>`; });
    item.quality.forEach(q => { bodyHtml += `<span class="meta-tag quality-badge">${q}</span>`; });
    bodyHtml += '</div>';

    // Sinopsis
    if (item.overview) {
        bodyHtml += `<div class="modal-overview">${escapeHtml(item.overview)}</div>`;
    }

    // Enlace a la.movie
    if (item.slug) {
        const typeSlug = item.content_type === 'movies' ? 'peliculas' : item.content_type === 'tvshows' ? 'series' : 'animes';
        bodyHtml += `<div style="margin-bottom:20px"><a href="https://la.movie/${typeSlug}/${item.slug}" target="_blank" class="dl-link">🔗 Ver en la.movie</a></div>`;
    }

    // Trailer
    if (item.trailer) {
        bodyHtml += `
            <div class="modal-section">
                <h3>🎥 Trailer</h3>
                <a href="https://www.youtube.com/watch?v=${item.trailer}" target="_blank" class="dl-link">
                    ▶ Ver en YouTube
                </a>
            </div>
        `;
    }

    // Enlaces de descarga
    bodyHtml += `<div class="modal-section"><h3>📥 Enlaces de Descarga (${item.downloads.length})</h3>`;

    if (item.downloads.length > 0) {
        bodyHtml += `
            <table class="downloads-table">
                <thead>
                    <tr>
                        <th>Servidor</th>
                        <th>Calidad</th>
                        <th>Idioma</th>
                        <th>Tamaño</th>
                        <th>Enlace</th>
                    </tr>
                </thead>
                <tbody>
                    ${item.downloads.map(dl => `
                        <tr>
                            <td class="dl-server">${extractServerName(dl.url)}</td>
                            <td><span class="quality-badge">${escapeHtml(dl.quality || 'N/A')}</span></td>
                            <td>${escapeHtml(dl.language || 'N/A')}</td>
                            <td>${dl.size || '—'}</td>
                            <td><a href="${escapeHtml(dl.url)}" target="_blank" rel="noopener" class="dl-link">⬇ Descargar</a></td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
    } else if (!item.downloads_scraped) {
        bodyHtml += `
            <p style="color:var(--text-muted);margin-bottom:12px">Descargas no extraídas aún.</p>
            <button class="btn btn-primary btn-sm" onclick="scrapeContentDownloads(${item.id})">
                📥 Extraer descargas ahora
            </button>
        `;
    } else {
        bodyHtml += '<p style="color:var(--text-muted)">No se encontraron enlaces de descarga.</p>';
    }

    bodyHtml += '</div>';

    // Embeds
    if (item.embeds && item.embeds.length > 0) {
        bodyHtml += `
            <div class="modal-section">
                <h3>▶ Reproducciones (${item.embeds.length})</h3>
                <table class="downloads-table">
                    <thead>
                        <tr><th>Servidor</th><th>Calidad</th><th>Idioma</th></tr>
                    </thead>
                    <tbody>
                        ${item.embeds.map(em => `
                            <tr>
                                <td class="dl-server">${escapeHtml(em.server || 'Online')}</td>
                                <td><span class="quality-badge">${escapeHtml(em.quality || 'N/A')}</span></td>
                                <td>${escapeHtml(em.language || 'N/A')}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;
    }

    // Info adicional
    bodyHtml += `
        <div class="modal-section" style="font-size:12px;color:var(--text-muted)">
            <p>ID externo: ${item.external_id} | Scrapeado: ${item.scraped_at ? new Date(item.scraped_at).toLocaleString() : 'N/A'}</p>
        </div>
    `;

    body.innerHTML = bodyHtml;
}

function closeModal() {
    document.getElementById('detailModal').classList.remove('active');
}

// ─── SCRAPING ───────────────────────────────────────────
async function startScrape() {
    const contentType = document.getElementById('scrapeType').value;
    const startPage = parseInt(document.getElementById('startPage').value) || 1;
    const endPageVal = document.getElementById('endPage').value;
    const endPage = endPageVal ? parseInt(endPageVal) : null;

    const body = { content_type: contentType, start_page: startPage };
    if (endPage) body.end_page = endPage;

    const result = await api('/api/scrape/start', {
        method: 'POST',
        body: JSON.stringify(body),
    });

    if (!result) return;

    if (result.error) {
        showToast(result.message, 'error');
        return;
    }

    showToast(`Scraping de ${contentType} iniciado`, 'success');
    document.getElementById('btnStartScrape').disabled = true;
    document.getElementById('btnStopScrape').style.display = '';
    startPolling();
}

async function stopScrape() {
    await api('/api/scrape/stop', { method: 'POST' });
    showToast('Deteniendo scraping...', 'info');
}

async function scrapeContentDownloads(contentId) {
    const result = await api(`/api/content/${contentId}/scrape-downloads`, { method: 'POST' });
    if (result && !result.error) {
        showToast('Extrayendo descargas...', 'success');
        // Esperar unos segundos y recargar el detalle
        setTimeout(() => openDetail(contentId), 3000);
    }
}

// ─── POLLING DE PROGRESO ────────────────────────────────
function startPolling() {
    if (state.pollingInterval) clearInterval(state.pollingInterval);
    state.pollingInterval = setInterval(checkScrapeStatus, 2000);
    checkScrapeStatus();
}

async function checkScrapeStatus() {
    const result = await api('/api/scrape/status');
    if (!result) return;

    const container = document.getElementById('progressContainer');
    const startBtn = document.getElementById('btnStartScrape');
    const stopBtn = document.getElementById('btnStopScrape');

    if (result.active && result.job) {
        const job = result.job;
        container.classList.add('active');
        startBtn.disabled = true;
        stopBtn.style.display = '';

        document.getElementById('progressLabel').textContent = `Scrapeando ${job.content_type}...`;
        document.getElementById('progressPercent').textContent = `${job.progress}%`;
        document.getElementById('progressBar').style.width = `${job.progress}%`;
        document.getElementById('progressPage').textContent = `${job.current_page}/${job.total_pages}`;
        document.getElementById('progressItems').textContent = job.items_scraped.toLocaleString();
        document.getElementById('progressErrors').textContent = job.errors;

        // Actualizar estadísticas en tiempo real
        loadStats();
    } else {
        container.classList.remove('active');
        startBtn.disabled = false;
        stopBtn.style.display = 'none';

        // Si había un polling y el job terminó, actualizar todo
        if (result.job && ['completed', 'failed', 'stopped'].includes(result.job.status)) {
            loadStats();
            loadJobHistory();
        }
    }
}

// ─── HISTORIAL DE JOBS ──────────────────────────────────
async function loadJobHistory() {
    const result = await api('/api/scrape/history');
    if (!result || result.error) return;

    const tbody = document.getElementById('jobsBody');
    if (result.jobs.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:20px">Sin historial de scraping</td></tr>';
        return;
    }

    tbody.innerHTML = result.jobs.map(job => `
        <tr>
            <td>#${job.id}</td>
            <td>${job.content_type}</td>
            <td><span class="status-badge ${job.status}">${statusIcon(job.status)} ${job.status}</span></td>
            <td>${job.progress}%</td>
            <td>${job.items_scraped.toLocaleString()}</td>
            <td>${job.errors}</td>
            <td>${job.started_at ? new Date(job.started_at).toLocaleString() : '—'}</td>
        </tr>
    `).join('');
}

function statusIcon(status) {
    const icons = { running: '🔄', completed: '✅', failed: '❌', stopped: '⏸', pending: '⏳' };
    return icons[status] || '';
}

// ─── EXPORTACIÓN ────────────────────────────────────────
function exportData(format, type) {
    const url = `/api/export/${format}?type=${type}&downloads=true`;
    window.open(url, '_blank');
    showToast(`Exportando ${type} en formato ${format.toUpperCase()}`, 'success');
}

// ─── LIMPIAR BD ─────────────────────────────────────────
async function clearDatabase() {
    if (!confirm('¿Estás seguro de que deseas eliminar TODOS los datos scrapeados?')) return;

    const result = await api('/api/db/clear', {
        method: 'POST',
        body: JSON.stringify({ content_type: 'all' }),
    });

    if (result && !result.error) {
        showToast('Base de datos limpiada', 'success');
        loadStats();
        loadJobHistory();
    }
}

// ─── BÚSQUEDA CON DEBOUNCE ─────────────────────────────
function debounceSearch(contentType) {
    if (state.searchTimers[contentType]) clearTimeout(state.searchTimers[contentType]);
    state.searchTimers[contentType] = setTimeout(() => {
        state.pages[contentType] = 1;
        loadContent(contentType);
    }, 400);
}

// ─── UTILIDADES ─────────────────────────────────────────
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function extractServerName(url) {
    try {
        const hostname = new URL(url).hostname;
        return hostname.replace('www.', '');
    } catch {
        return 'Desconocido';
    }
}

function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    const icons = { success: '✅', error: '❌', info: 'ℹ️' };
    toast.innerHTML = `<span>${icons[type] || ''}</span><span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(50px)';
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

function renderEmptyState(message) {
    return `
        <div class="empty-state" style="grid-column:1/-1">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path d="M8 15h8M9 9h.01M15 9h.01"/></svg>
            <h3>${message}</h3>
            <p>Inicia un scraping desde el Dashboard para comenzar a recopilar datos.</p>
        </div>
    `;
}
