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
    selectedItems: new Set(),
    selectionMode: false,
    commandQueue: [],
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
    loadQueueCount();
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

    const isSelected = state.selectedItems.has(item.id);

    return `
        <div class="content-card ${isSelected ? 'selected' : ''}" onclick="handleCardClick(event, ${item.id})" data-id="${item.id}">
            <div class="card-checkbox" onclick="event.stopPropagation(); toggleSelection(${item.id})">${isSelected ? '✓' : ''}</div>
            <span class="card-type-badge ${item.content_type}">${typeLabel.icon || ''} ${typeLabel.label || item.content_type}</span>
            ${item.downloads_scraped ? '<span class="card-download-badge" title="Descargas disponibles">📥</span>' : ''}
            ${item.downloads_scraped ? `<button class="card-quick-cmd" onclick="event.stopPropagation(); quickGenerate(${item.id})" title="Generar comandos y agregar a la cola">⚡</button>` : ''}
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

    // ─── GENERADOR DE COMANDOS ──────────────────────────
    bodyHtml += `
        <div class="modal-section">
            <h3>⚙️ Generador de Comandos</h3>
            <div class="cmd-generator" id="cmdGenerator" data-content-id="${item.id}" data-content-type="${item.content_type}">
                <!-- TMDB ID -->
                <div style="margin-bottom:12px">
                    <div class="cmd-config">
                        <div class="field">
                            <label>TMDB ID</label>
                            <input type="number" id="cmdTmdbId" value="${item.tmdb_id || ''}" placeholder="ID de TheMovieDB" style="min-width:140px">
                        </div>
                        <button class="btn btn-outline btn-sm" onclick="searchTmdb(${item.id}, '${escapeHtml(item.title)}', '${item.year || ''}', '${item.content_type}')">
                            🔍 Buscar en TMDB
                        </button>
                        ${item.tmdb_id ? `<span class="tmdb-id-display">✅ TMDB: ${item.tmdb_id}</span>` : ''}
                    </div>
                    <div id="tmdbResults"></div>
                </div>

                <!-- Contraseña y Servidores de Upload -->
                <div class="cmd-config">
                    <div class="field">
                        <label>Contraseña (archivo)</label>
                        <input type="text" id="cmdPassword" value="cc" placeholder="ej: cc" style="min-width:100px">
                    </div>
                </div>

                <div style="margin:10px 0">
                    <label style="font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px">Servidores de upload</label>
                    <div class="upload-servers-grid" id="uploadServers">
                        ${UPLOAD_SERVERS.map(s => `
                            <span class="upload-server-tag active" data-server="${s}" onclick="toggleUploadServer(this)">${s}</span>
                        `).join('')}
                    </div>
                    <div style="margin-top:6px">
                        <button class="btn btn-outline btn-sm" onclick="selectAllUploadServers()">Seleccionar todos</button>
                        <button class="btn btn-outline btn-sm" onclick="deselectAllUploadServers()">Deseleccionar</button>
                    </div>
                </div>

                <button class="btn btn-primary" onclick="generateCommands(${item.id})" ${item.downloads.length === 0 ? 'disabled title=\"Primero extrae las descargas\"' : ''}>
                    🚀 Generar Comandos
                </button>

                <div class="cmd-output" id="cmdOutput"></div>
            </div>
        </div>
    `;

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
            <p>ID externo: ${item.external_id} | TMDB: ${item.tmdb_id || 'No asignado'} | Scrapeado: ${item.scraped_at ? new Date(item.scraped_at).toLocaleString() : 'N/A'}</p>
        </div>
    `;

    body.innerHTML = bodyHtml;

    // Si no tiene TMDB ID, buscar automáticamente
    if (!item.tmdb_id && item.title) {
        searchTmdb(item.id, item.title, item.year || '', item.content_type);
    }

    // Auto-generar comandos si ya tiene TMDB ID y descargas
    if (item.tmdb_id && item.downloads.length > 0) {
        generateCommands(item.id);
    }
}

function closeModal() {
    document.getElementById('detailModal').classList.remove('active');
}

// ─── GENERADOR DE COMANDOS ──────────────────────────────

// Servidores de upload disponibles
const UPLOAD_SERVERS = [
    'desu', 'okru', 'netu', 'seekstreaming', 'buzzheavier',
    'googledrive', 'mediafire', 'mega', 'ranoz', 'pixeldrain',
];

function toggleUploadServer(el) {
    el.classList.toggle('active');
}

function selectAllUploadServers() {
    document.querySelectorAll('.upload-server-tag').forEach(el => el.classList.add('active'));
}

function deselectAllUploadServers() {
    document.querySelectorAll('.upload-server-tag').forEach(el => el.classList.remove('active'));
}

// Generación rápida desde la tarjeta: un solo clic
async function quickGenerate(contentId) {
    // Feedback visual inmediato
    const card = document.querySelector(`.content-card[data-id="${contentId}"]`);
    const btn = card ? card.querySelector('.card-quick-cmd') : null;
    if (btn) {
        btn.classList.add('loading');
        btn.textContent = '⏳';
    }

    const result = await api('/api/content/bulk-generate', {
        method: 'POST',
        body: JSON.stringify({
            content_ids: [contentId],
            upload_servers: UPLOAD_SERVERS,
            password: 'cc',
            auto_resolve_tmdb: true,
        }),
    });

    if (btn) {
        btn.classList.remove('loading');
        btn.textContent = '⚡';
    }

    if (!result || result.error) {
        showToast(result?.message || 'Error generando comandos', 'error');
        return;
    }

    if (result.commands.length === 0) {
        showToast('No se generaron comandos (sin descargas o TMDB no encontrado)', 'warning');
        return;
    }

    // Agregar a la cola automáticamente
    const queueResult = await api('/api/queue/add', {
        method: 'POST',
        body: JSON.stringify({ commands: result.commands }),
    });

    if (queueResult && !queueResult.error) {
        result.commands.forEach(c => state.commandQueue.push(c));
        updateQueueBadge();
        if (btn) {
            btn.textContent = '✅';
            setTimeout(() => { btn.textContent = '⚡'; }, 1500);
        }
        showToast(`${result.commands.length} comando(s) agregado(s) a la cola · ${result.commands[0]?.title || ''}`, 'success');
    }
}

async function searchTmdb(contentId, title, year, contentType) {
    // Limpiar el título: quitar año entre paréntesis
    const cleanTitle = title.replace(/\s*\(\d{4}\)\s*$/, '').trim();
    const searchType = contentType === 'movies' ? 'movie' : 'tv';

    const params = new URLSearchParams({ title: cleanTitle, year, type: searchType });
    const result = await api(`/api/tmdb/search?${params}`);

    const container = document.getElementById('tmdbResults');
    if (!result || result.error || result.results.length === 0) {
        container.innerHTML = '<p style="font-size:12px;color:var(--text-muted);margin:8px 0">No se encontraron resultados en TMDB. Intenta buscar manualmente.</p>';
        return;
    }

    container.innerHTML = `
        <div class="tmdb-search-results">
            ${result.results.map(r => `
                <div class="tmdb-result" onclick="selectTmdbResult(${contentId}, ${r.tmdb_id}, this)">
                    ${r.poster ? `<img src="${r.poster}" alt="">` : '<div style="width:34px;height:50px;background:var(--bg-card);border-radius:3px;flex-shrink:0"></div>'}
                    <div class="tmdb-info">
                        <strong>${escapeHtml(r.title)}</strong>
                        <span>${r.year} · ID: ${r.tmdb_id}</span>
                        ${r.original_title !== r.title ? `<br><span style="font-style:italic">${escapeHtml(r.original_title)}</span>` : ''}
                    </div>
                </div>
            `).join('')}
        </div>
    `;

    // Auto-seleccionar el primer resultado
    if (result.results.length > 0) {
        const firstResult = container.querySelector('.tmdb-result');
        if (firstResult) {
            selectTmdbResult(contentId, result.results[0].tmdb_id, firstResult);
        }
    }
}

async function selectTmdbResult(contentId, tmdbId, element) {
    // Marcar como seleccionado
    document.querySelectorAll('.tmdb-result').forEach(el => el.classList.remove('selected'));
    element.classList.add('selected');

    // Actualizar input
    document.getElementById('cmdTmdbId').value = tmdbId;

    // Guardar en la BD
    await api(`/api/content/${contentId}/set-tmdb`, {
        method: 'POST',
        body: JSON.stringify({ tmdb_id: tmdbId }),
    });

    showToast(`TMDB ID ${tmdbId} asignado`, 'success');
}

async function generateCommands(contentId) {
    const tmdbId = document.getElementById('cmdTmdbId').value;
    const password = document.getElementById('cmdPassword').value;

    if (!tmdbId) {
        showToast('Selecciona o ingresa un TMDB ID primero', 'error');
        return;
    }

    // Obtener servidores seleccionados
    const uploadServers = [];
    document.querySelectorAll('.upload-server-tag.active').forEach(el => {
        uploadServers.push(el.dataset.server);
    });

    const result = await api(`/api/content/${contentId}/generate-command`, {
        method: 'POST',
        body: JSON.stringify({
            tmdb_id: parseInt(tmdbId),
            password,
            upload_servers: uploadServers,
        }),
    });

    if (!result || result.error) {
        showToast(result?.message || 'Error generando comandos', 'error');
        return;
    }

    const output = document.getElementById('cmdOutput');

    if (result.commands.length === 0) {
        output.innerHTML = '<p style="color:var(--text-muted);margin-top:12px">No hay enlaces de descarga para generar comandos.</p>';
        return;
    }

    // Renderizar comandos
    let html = `<p style="font-size:12px;color:var(--text-secondary);margin-bottom:8px">📋 ${result.total} comando(s) generado(s) para <strong>${escapeHtml(result.title)}</strong> (TMDB: ${result.tmdb_id})</p>`;

    // Botón agregar todos a la cola
    html += `<button class="btn btn-outline btn-sm" style="margin-bottom:10px" onclick="addAllToQueue(${JSON.stringify(result.commands).replace(/"/g, '&quot;')})">📦 Agregar todos a la cola</button>`;

    // Botón copiar todos
    const allCmds = result.commands.map(c => c.command).join(' ');
    html += `<button class="btn btn-outline btn-sm" style="margin-bottom:10px" onclick="copyToClipboard(\`${allCmds.replace(/`/g, '\\`')}\`)">📋 Copiar todos los comandos</button>`;

    result.commands.forEach((cmd, i) => {
        const isMf = (cmd.url || '').includes('mediafire');
        html += `
            <div class="cmd-block" ${isMf ? 'style="border-left:3px solid #4ade80"' : ''}>
                <div class="cmd-label">
                    <span class="quality-badge">${escapeHtml(cmd.quality || 'N/A')}</span>
                    ${escapeHtml(cmd.language || '')} · ${extractServerName(cmd.url)}
                </div>
                <pre>${escapeHtml(cmd.command)}</pre>
                <button class="copy-btn" style="right:50px" onclick="copyToClipboard(this.previousElementSibling.textContent)">📋</button>
                <button class="copy-btn" onclick="addOneToQueue(${JSON.stringify(cmd).replace(/"/g, '&quot;')})">➕</button>
            </div>
        `;
    });

    output.innerHTML = html;
}

function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => {
        showToast('Copiado al portapapeles', 'success');
    }).catch(() => {
        // Fallback para navegadores sin soporte
        const textarea = document.createElement('textarea');
        textarea.value = text;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        showToast('Copiado al portapapeles', 'success');
    });
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
    // Polling lento por defecto (cada 10s), se acelera cuando hay scraping activo
    state.pollingInterval = setInterval(checkScrapeStatus, 10000);
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

        // Polling rápido durante scraping activo
        if (!state.fastPolling) {
            state.fastPolling = true;
            clearInterval(state.pollingInterval);
            state.pollingInterval = setInterval(checkScrapeStatus, 2000);
        }

        // Actualizar estadísticas en tiempo real
        loadStats();
        loadJobHistory();
    } else {
        container.classList.remove('active');
        startBtn.disabled = false;
        stopBtn.style.display = 'none';

        // Volver a polling lento cuando no hay scraping
        if (state.fastPolling) {
            state.fastPolling = false;
            clearInterval(state.pollingInterval);
            state.pollingInterval = setInterval(checkScrapeStatus, 10000);
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

// ─── GENERACIÓN MASIVA MEDIAFIRE POR PÁGINA ────────────

async function generatePageMediafire(contentType) {
    // Obtener el sufijo del DOM según el tipo de contenido
    const suffix = TYPE_TO_DOM[contentType];
    if (!suffix) return;

    // Recopilar todos los IDs de las tarjetas visibles en la grilla activa
    const grid = document.getElementById(`grid${suffix}`);
    if (!grid) return;

    const cards = grid.querySelectorAll('.content-card[data-id]');
    const contentIds = Array.from(cards).map(c => parseInt(c.dataset.id)).filter(id => id);

    if (contentIds.length === 0) {
        showToast('No hay contenido visible en esta página', 'warning');
        return;
    }

    // Mostrar overlay con loader
    const overlay = document.getElementById('bulkResultsOverlay');
    const content = document.getElementById('bulkResultsContent');
    overlay.classList.add('active');
    content.innerHTML = `
        <div class="loader active"><div class="spinner"></div>
            Generando comandos MediaFire para ${contentIds.length} título(s)...<br>
            <small style="color:var(--text-muted)">Scrapeando descargas, filtrando MediaFire y resolviendo TMDB IDs...</small>
        </div>
    `;

    // Servidores de upload y contraseña por defecto
    const uploadServers = UPLOAD_SERVERS;
    const password = 'cc';

    const result = await api('/api/content/page-generate-mediafire', {
        method: 'POST',
        body: JSON.stringify({
            content_ids: contentIds,
            upload_servers: uploadServers,
            password: password,
            auto_resolve_tmdb: true,
        }),
    });

    if (!result || result.error) {
        content.innerHTML = `<p style="color:var(--danger)">Error: ${result?.message || 'Error desconocido'}</p>`;
        return;
    }

    // Renderizar resultados
    let html = '';

    // Resumen
    html += `<div style="margin-bottom:16px;padding:12px;background:var(--bg-card);border-radius:var(--radius-sm);border:1px solid var(--border-color)">`;
    html += `<p style="font-size:13px"><strong>🗂️ MediaFire · ${result.processed} título(s) con enlaces</strong> · ${result.total} comando(s) generado(s)</p>`;
    if (result.scraped > 0) {
        html += `<p style="font-size:12px;color:var(--accent);margin-top:4px">📥 ${result.scraped} título(s) scrapeados automáticamente desde la.movie</p>`;
    }
    if (result.skipped > 0) {
        html += `<p style="font-size:12px;color:var(--text-muted);margin-top:4px">${result.skipped} título(s) sin enlaces de MediaFire (omitidos)</p>`;
    }
    if (result.errors.length > 0) {
        html += `<div style="margin-top:8px;font-size:12px;color:var(--danger)">`;
        html += `<strong>⚠️ ${result.errors.length} error(es):</strong><br>`;
        result.errors.forEach(e => { html += `• ${escapeHtml(e)}<br>`; });
        html += `</div>`;
    }
    html += `</div>`;

    if (result.commands.length > 0) {
        // Botones de acción
        const allCmds = result.commands.map(c => c.command).join(' ');
        html += `<button class="btn btn-primary btn-sm" style="margin-bottom:14px" onclick="copyToClipboard(document.getElementById('allMfCmds').textContent)">📋 Copiar todos (${result.total})</button>`;
        html += `<button class="btn btn-outline btn-sm" style="margin-bottom:14px;margin-left:8px" onclick="addAllToQueue(${JSON.stringify(result.commands).replace(/"/g, '&quot;')})">📦 Agregar todos a la cola</button>`;
        html += `<pre id="allMfCmds" style="display:none">${escapeHtml(allCmds)}</pre>`;

        // Agrupar por título y content_id
        const grouped = {};
        let groupIdx = 0;
        result.commands.forEach(cmd => {
            const key = `${cmd.content_id}`;
            if (!grouped[key]) {
                grouped[key] = { cmds: [], title: cmd.title, tmdbId: cmd.tmdb_id, poster: cmd.poster || '', cType: cmd.content_type || 'movies', year: cmd.year || '', idx: groupIdx++ };
            }
            grouped[key].cmds.push(cmd);
        });

        for (const [contentId, group] of Object.entries(grouped)) {
            const { cmds, title, tmdbId, poster, cType, year, idx } = group;
            const tmdbType = cType === 'movies' ? 'movie' : 'tv';
            const tmdbUrl = `https://www.themoviedb.org/${tmdbType}/${tmdbId}`;

            html += `<div id="mfGroup_${idx}" style="margin-bottom:20px;padding:14px;background:var(--bg-card);border-radius:var(--radius-sm);border:1px solid var(--border-color)">`;

            // Encabezado con poster y título
            html += `<div style="display:flex;gap:14px;margin-bottom:12px">`;

            // Poster
            html += `<div id="mfPoster_${idx}" style="flex-shrink:0">`;
            if (poster) {
                html += `<img src="${escapeHtml(poster)}" alt="" style="width:70px;height:105px;object-fit:cover;border-radius:6px" onerror="this.style.display='none'">`;
            } else {
                html += `<div style="width:70px;height:105px;background:var(--bg-main);border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:28px">🎬</div>`;
            }
            html += `</div>`;

            // Info del título + TMDB
            html += `<div style="flex:1;min-width:0">`;
            html += `<div style="font-size:14px;font-weight:700;color:var(--text-primary);margin-bottom:4px">${escapeHtml(title)}</div>`;
            html += `<div id="mfTmdbInfo_${idx}" style="font-size:12px;color:var(--text-muted);margin-bottom:8px">${year ? year + ' · ' : ''}TMDB: <a href="${tmdbUrl}" target="_blank" style="color:var(--accent)">${tmdbId}</a> · ${cmds.length} comando(s)</div>`;

            // Botón Buscar en TMDB (inline)
            html += `<div style="display:flex;gap:6px;flex-wrap:wrap">`;
            html += `<button class="btn btn-outline btn-sm" style="font-size:11px" onclick="searchTmdbForMf(${contentId}, '${escapeHtml(title).replace(/'/g, "\\'")}', '${year}', '${cType}', ${idx})">🔎 Buscar en TMDB</button>`;
            html += `<a href="${tmdbUrl}" target="_blank" rel="noopener" class="btn btn-outline btn-sm" style="font-size:11px;text-decoration:none">🔍 Ver en TMDB</a>`;
            html += `</div>`;

            html += `</div>`;
            html += `</div>`;

            // Contenedor de resultados TMDB (se llena al buscar)
            html += `<div id="mfTmdbResults_${idx}" style="margin-bottom:10px"></div>`;

            // Comandos
            cmds.forEach((cmd, ci) => {
                html += `
                    <div class="cmd-block" id="mfCmd_${idx}_${ci}" style="border-left:3px solid #4ade80;margin-bottom:6px" data-url="${escapeHtml(cmd.url)}" data-quality="${escapeHtml(cmd.quality || '')}" data-language="${escapeHtml(cmd.language || '')}">
                        <div class="cmd-label">
                            <span class="quality-badge">${escapeHtml(cmd.quality || 'N/A')}</span>
                            ${escapeHtml(cmd.language || '')} · ${cmd.server}
                        </div>
                        <pre>${escapeHtml(cmd.command)}</pre>
                        <button class="copy-btn" style="right:50px" onclick="copyToClipboard(this.previousElementSibling.textContent)">📋</button>
                        <button class="copy-btn" onclick="addOneToQueue(${JSON.stringify(cmd).replace(/"/g, '&quot;')})">➕</button>
                    </div>
                `;
            });

            html += `</div>`;
        }
    } else {
        html += `<p style="color:var(--text-muted);text-align:center;padding:20px">No se encontraron enlaces de MediaFire en los ${contentIds.length} título(s) de esta página.</p>`;
    }

    content.innerHTML = html;
}

// Buscar en TMDB desde el overlay de MediaFire
async function searchTmdbForMf(contentId, title, year, contentType, groupIdx) {
    const cleanTitle = title.replace(/\s*\(\d{4}\)\s*$/, '').trim();
    const searchType = contentType === 'movies' ? 'movie' : 'tv';

    const container = document.getElementById(`mfTmdbResults_${groupIdx}`);
    container.innerHTML = '<div style="padding:8px;font-size:12px;color:var(--text-muted)">Buscando en TMDB...</div>';

    const params = new URLSearchParams({ title: cleanTitle, year, type: searchType });
    const result = await api(`/api/tmdb/search?${params}`);

    if (!result || result.error || !result.results || result.results.length === 0) {
        container.innerHTML = '<p style="font-size:12px;color:var(--text-muted);margin:8px 0">No se encontraron resultados en TMDB.</p>';
        return;
    }

    container.innerHTML = `
        <div class="tmdb-search-results" style="margin:8px 0">
            ${result.results.map(r => `
                <div class="tmdb-result" onclick="selectTmdbForMf(${contentId}, ${r.tmdb_id}, this, ${groupIdx}, '${(r.poster || '').replace(/'/g, "\\'")}', '${escapeHtml(r.title).replace(/'/g, "\\'")}')" style="cursor:pointer">
                    ${r.poster ? `<img src="${r.poster}" alt="">` : '<div style="width:34px;height:50px;background:var(--bg-card);border-radius:3px;flex-shrink:0"></div>'}
                    <div class="tmdb-info">
                        <strong>${escapeHtml(r.title)}</strong>
                        <span>${r.year} · ID: ${r.tmdb_id}</span>
                        ${r.original_title !== r.title ? `<br><span style="font-style:italic">${escapeHtml(r.original_title)}</span>` : ''}
                    </div>
                </div>
            `).join('')}
        </div>
    `;
}

// Seleccionar un resultado TMDB y actualizar comandos del grupo
async function selectTmdbForMf(contentId, newTmdbId, element, groupIdx, newPoster, newTitle) {
    // Marcar como seleccionado
    const container = element.parentElement;
    container.querySelectorAll('.tmdb-result').forEach(el => el.classList.remove('selected'));
    element.classList.add('selected');

    // Guardar en la BD
    await api(`/api/content/${contentId}/set-tmdb`, {
        method: 'POST',
        body: JSON.stringify({ tmdb_id: newTmdbId }),
    });

    // Actualizar poster
    const posterEl = document.getElementById(`mfPoster_${groupIdx}`);
    if (newPoster) {
        posterEl.innerHTML = `<img src="${newPoster}" alt="" style="width:70px;height:105px;object-fit:cover;border-radius:6px">`;
    }

    // Actualizar info TMDB
    const infoEl = document.getElementById(`mfTmdbInfo_${groupIdx}`);
    if (infoEl) {
        const tmdbUrl = `https://www.themoviedb.org/movie/${newTmdbId}`;
        infoEl.innerHTML = `TMDB: <a href="${tmdbUrl}" target="_blank" style="color:var(--accent)">${newTmdbId}</a> (actualizado ✅)`;
    }

    // Actualizar comandos: reemplazar el -i viejo por el nuevo
    const group = document.getElementById(`mfGroup_${groupIdx}`);
    if (group) {
        const pres = group.querySelectorAll('.cmd-block pre');
        pres.forEach(pre => {
            pre.textContent = pre.textContent.replace(/-i \d+/, `-i ${newTmdbId}`);
        });
    }

    showToast(`TMDB ID ${newTmdbId} asignado correctamente`, 'success');
}

// ─── SELECCIÓN MASIVA ───────────────────────────────────

function handleCardClick(event, contentId) {
    if (state.selectionMode) {
        toggleSelection(contentId);
    } else {
        openDetail(contentId);
    }
}

function toggleSelection(contentId) {
    if (!state.selectionMode) enterSelectionMode();

    if (state.selectedItems.has(contentId)) {
        state.selectedItems.delete(contentId);
    } else {
        state.selectedItems.add(contentId);
    }

    // Actualizar visual de la tarjeta
    const card = document.querySelector(`.content-card[data-id="${contentId}"]`);
    if (card) {
        card.classList.toggle('selected', state.selectedItems.has(contentId));
        const cb = card.querySelector('.card-checkbox');
        if (cb) cb.textContent = state.selectedItems.has(contentId) ? '✓' : '';
    }

    updateBulkToolbar();
}

function enterSelectionMode() {
    state.selectionMode = true;
    // Activar modo selección en todas las páginas de contenido
    document.querySelectorAll('.content-grid').forEach(g => g.classList.add('selection-mode'));
    document.getElementById('bulkToolbar').classList.add('active');
    document.getElementById('bulkCount').textContent = '0 seleccionados';
}

function exitSelectionMode() {
    state.selectionMode = false;
    state.selectedItems.clear();
    document.querySelectorAll('.content-grid').forEach(g => g.classList.remove('selection-mode'));
    document.querySelectorAll('.content-card.selected').forEach(c => {
        c.classList.remove('selected');
        const cb = c.querySelector('.card-checkbox');
        if (cb) cb.textContent = '';
    });
    document.getElementById('bulkToolbar').classList.remove('active');
}

function selectAllVisible() {
    const currentGrid = document.querySelector('.page.active .content-grid');
    if (!currentGrid) return;

    currentGrid.querySelectorAll('.content-card').forEach(card => {
        const id = parseInt(card.dataset.id);
        if (id) {
            state.selectedItems.add(id);
            card.classList.add('selected');
            const cb = card.querySelector('.card-checkbox');
            if (cb) cb.textContent = '✓';
        }
    });
    updateBulkToolbar();
}

function updateBulkToolbar() {
    const count = state.selectedItems.size;
    document.getElementById('bulkCount').textContent = `${count} seleccionado${count !== 1 ? 's' : ''}`;

    if (count === 0 && state.selectionMode) {
        exitSelectionMode();
    }
}

async function bulkGenerate() {
    const contentIds = Array.from(state.selectedItems);
    if (contentIds.length === 0) {
        showToast('Selecciona al menos una película', 'error');
        return;
    }

    const password = document.getElementById('bulkPassword').value;

    // Usar todos los servidores por defecto en masivo
    const uploadServers = ['desu', 'okru', 'netu', 'seekstreaming', 'buzzheavier',
                           'googledrive', 'mediafire', 'mega', 'ranoz', 'pixeldrain'];

    // Mostrar panel de resultados con loader
    const overlay = document.getElementById('bulkResultsOverlay');
    const content = document.getElementById('bulkResultsContent');
    overlay.classList.add('active');
    content.innerHTML = `
        <div class="loader active"><div class="spinner"></div>
            Generando comandos para ${contentIds.length} título(s)...<br>
            <small style="color:var(--text-muted)">Buscando TMDB IDs automáticamante y generando comandos...</small>
        </div>
    `;

    const result = await api('/api/content/bulk-generate', {
        method: 'POST',
        body: JSON.stringify({
            content_ids: contentIds,
            upload_servers: uploadServers,
            password: password,
            auto_resolve_tmdb: true,
        }),
    });

    if (!result || result.error) {
        content.innerHTML = `<p style="color:var(--danger)">Error: ${result?.message || 'Error desconocido'}</p>`;
        return;
    }

    // Renderizar resultados
    let html = '';

    // Resumen
    html += `<div style="margin-bottom:16px;padding:12px;background:var(--bg-card);border-radius:var(--radius-sm);border:1px solid var(--border-color)">`;
    html += `<p style="font-size:13px"><strong>✅ ${result.processed} título(s) procesado(s)</strong> · ${result.total} comando(s) generado(s)</p>`;
    if (result.errors.length > 0) {
        html += `<div style="margin-top:8px;font-size:12px;color:var(--danger)">`;
        html += `<strong>⚠️ ${result.errors.length} error(es):</strong><br>`;
        result.errors.forEach(e => { html += `• ${escapeHtml(e)}<br>`; });
        html += `</div>`;
    }
    html += `</div>`;

    if (result.commands.length > 0) {
        // Botón copiar todos
        const allCmds = result.commands.map(c => c.command).join(' ');
        html += `<button class="btn btn-primary btn-sm" style="margin-bottom:14px" onclick="copyToClipboard(document.getElementById('allBulkCmds').textContent)">📋 Copiar todos (${result.total})</button>`;
        html += `<button class="btn btn-outline btn-sm" style="margin-bottom:14px;margin-left:8px" onclick="addAllToQueue(${JSON.stringify(result.commands).replace(/"/g, '&quot;')})">📦 Agregar todos a la cola</button>`;
        html += `<pre id="allBulkCmds" style="display:none">${escapeHtml(allCmds)}</pre>`;

        // Agrupar por título
        const grouped = {};
        result.commands.forEach(cmd => {
            const key = `${cmd.title} (TMDB: ${cmd.tmdb_id})`;
            if (!grouped[key]) grouped[key] = [];
            grouped[key].push(cmd);
        });

        for (const [title, cmds] of Object.entries(grouped)) {
            html += `<div style="margin-bottom:16px">`;
            html += `<div style="font-size:13px;font-weight:700;color:var(--text-primary);margin-bottom:8px">🎬 ${escapeHtml(title)}</div>`;

            cmds.forEach(cmd => {
                html += `
                    <div class="cmd-block">
                        <div class="cmd-label">
                            <span class="quality-badge">${escapeHtml(cmd.quality || 'N/A')}</span>
                            ${escapeHtml(cmd.language || '')} · ${cmd.server}
                        </div>
                        <pre>${escapeHtml(cmd.command)}</pre>
                        <button class="copy-btn" onclick="copyToClipboard(this.previousElementSibling.textContent)">📋</button>
                    </div>
                `;
            });

            html += `</div>`;
        }
    }

    content.innerHTML = html;
}

function closeBulkResults() {
    document.getElementById('bulkResultsOverlay').classList.remove('active');
}

// ─── COLA DE COMANDOS ───────────────────────────────────

function updateQueueBadge() {
    const badge = document.getElementById('queueBadge');
    const count = state.commandQueue.length;
    if (badge) {
        badge.textContent = count;
        badge.parentElement.style.display = count > 0 ? 'flex' : 'none';
    }
}

async function loadQueueCount() {
    const result = await api('/api/queue');
    if (result && !result.error) {
        state.commandQueue = result.commands;
        updateQueueBadge();
    }
}

async function addOneToQueue(cmd) {
    const result = await api('/api/queue/add', {
        method: 'POST',
        body: JSON.stringify({ commands: [cmd] }),
    });
    if (result && !result.error) {
        state.commandQueue.push(cmd);
        updateQueueBadge();
        showToast('Comando agregado a la cola', 'success');
    }
}

async function addAllToQueue(commands) {
    const result = await api('/api/queue/add', {
        method: 'POST',
        body: JSON.stringify({ commands }),
    });
    if (result && !result.error) {
        commands.forEach(c => state.commandQueue.push(c));
        updateQueueBadge();
        showToast(`${commands.length} comando(s) agregado(s) a la cola`, 'success');
    }
}

async function openQueuePanel() {
    const overlay = document.getElementById('bulkResultsOverlay');
    const content = document.getElementById('bulkResultsContent');
    overlay.classList.add('active');
    content.innerHTML = '<div class="loader active"><div class="spinner"></div>Cargando cola...</div>';

    const result = await api('/api/queue');
    if (!result || result.error) {
        content.innerHTML = '<p style="color:var(--danger)">Error cargando la cola</p>';
        return;
    }

    state.commandQueue = result.commands;
    updateQueueBadge();

    if (result.commands.length === 0) {
        content.innerHTML = '<p style="color:var(--text-muted);padding:20px;text-align:center">La cola de comandos está vacía.<br>Agrega comandos con el botón ➕ Cola desde el detalle de una película.</p>';
        return;
    }

    let html = '';
    const total = result.commands.length;
    const allCmds = result.commands.map(c => c.command).join(' ');

    html += `<div style="margin-bottom:16px;padding:12px;background:var(--bg-card);border-radius:var(--radius-sm);border:1px solid var(--border-color)">`;
    html += `<p style="font-size:13px"><strong>📦 ${total} comando(s) en la cola</strong></p>`;
    html += `</div>`;

    html += `<div style="margin-bottom:14px;display:flex;gap:8px;flex-wrap:wrap">`;
    html += `<button class="btn btn-primary btn-sm" onclick="copyToClipboard(document.getElementById('allQueueCmds').textContent)">📋 Copiar todos (${total})</button>`;
    html += `<button class="btn btn-danger btn-sm" onclick="clearQueue()">🗑️ Limpiar cola</button>`;
    html += `</div>`;
    html += `<pre id="allQueueCmds" style="display:none">${escapeHtml(allCmds)}</pre>`;

    const grouped = {};
    result.commands.forEach(cmd => {
        const key = `${cmd.title} (TMDB: ${cmd.tmdb_id})`;
        if (!grouped[key]) grouped[key] = [];
        grouped[key].push(cmd);
    });

    for (const [title, cmds] of Object.entries(grouped)) {
        html += `<div style="margin-bottom:16px">`;
        html += `<div style="font-size:13px;font-weight:700;color:var(--text-primary);margin-bottom:8px">🎬 ${escapeHtml(title)} <span style="font-weight:400;color:var(--text-muted)">(${cmds.length})</span></div>`;
        cmds.forEach(cmd => {
            html += `
                <div class="cmd-block">
                    <div class="cmd-label">
                        <span class="quality-badge">${escapeHtml(cmd.quality || 'N/A')}</span>
                        ${escapeHtml(cmd.language || '')} · ${cmd.server || ''}
                    </div>
                    <pre>${escapeHtml(cmd.command)}</pre>
                    <button class="copy-btn" onclick="copyToClipboard(this.previousElementSibling.textContent)">📋</button>
                </div>
            `;
        });
        html += `</div>`;
    }

    content.innerHTML = html;
}

async function clearQueue() {
    if (!confirm(`¿Limpiar los ${state.commandQueue.length} comando(s) de la cola?`)) return;
    await api('/api/queue/clear', { method: 'POST' });
    state.commandQueue = [];
    updateQueueBadge();
    openQueuePanel();
    showToast('Cola de comandos limpiada', 'success');
}
