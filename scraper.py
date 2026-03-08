# Motor de scraping para la.movie
# Consume la API REST interna del sitio para extraer datos de películas, series y animes
import requests
import json
import time
import threading
import logging
from datetime import datetime
from urllib.parse import urljoin

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# URL base de la API
BASE_URL = 'https://la.movie'
API_URL = f'{BASE_URL}/wp-api/v1'
IMAGE_BASE = f'{BASE_URL}/wp-content/uploads'
TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/w500'

# Mapeo de taxonomías (obtenido de window.siteConfig del sitio)
GENRES_MAP = {
    "17": "Drama", "18": "Comedia", "33": "Suspense", "32": "Acción",
    "520": "Animación", "96": "Terror", "130": "Aventura", "180": "Crimen",
    "115": "Romance", "398": "Familia", "97": "Misterio", "131": "Ciencia ficción",
    "229": "Fantasía", "704": "Sci-Fi & Fantasy", "705": "Action & Adventure",
    "165": "Historia", "164": "Documental", "8": "Música", "6787": "Película de TV",
    "3056": "Bélica", "674": "Western", "703": "Kids", "786": "War & Politics",
    "12485": "Reality", "19824": "Soap"
}

QUALITY_MAP = {
    "495": "Full HD", "496": "Dual 1080p", "649": "HD", "58679": "BDRip",
    "58681": "HDTV", "58683": "WEB-DL 720p", "53691": "DVDRip",
    "58680": "BDRip 1080p IMAX", "12703": "HD1080p", "26624": "4K",
    "59268": "Dual 720p", "49673": "1080P", "58682": "BRRip 1080p IMAX",
    "58678": "WEB-DL 1080p", "9771": "Select quality", "69831": "WEB-DL 4k"
}

LANG_MAP = {
    "58651": "Latino", "58652": "Inglés", "58654": "Japonés",
    "58655": "Subtitulado", "58653": "Castellano"
}


class LaMovieScraper:
    """Scraper principal para la.movie usando su API REST interna."""

    def __init__(self, app=None):
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            'Accept': 'application/json, text/plain, */*',
            'Referer': BASE_URL,
        })
        self.app = app
        self._stop_event = threading.Event()
        self._current_job_id = None
        self._lock = threading.Lock()
        # Controles de velocidad
        self.delay = 0.5  # Segundos entre peticiones
        self.max_retries = 3

    def stop(self):
        """Detiene el scraping actual."""
        self._stop_event.set()

    def is_stopped(self):
        """Verifica si se solicitó detener el scraping."""
        return self._stop_event.is_set()

    def _request(self, url, params=None):
        """Realiza una petición HTTP con reintentos."""
        for attempt in range(self.max_retries):
            try:
                if self.is_stopped():
                    return None
                response = self.session.get(url, params=params, timeout=30)
                response.raise_for_status()
                return response.json()
            except requests.exceptions.RequestException as e:
                logger.warning(f"Intento {attempt + 1}/{self.max_retries} falló para {url}: {e}")
                if attempt < self.max_retries - 1:
                    time.sleep(2 ** attempt)  # Backoff exponencial
                else:
                    logger.error(f"Error definitivo para {url}: {e}")
                    return None

    def fetch_listing(self, content_type, page=1):
        """Obtiene una página del listado de contenido."""
        url = f'{API_URL}/listing/{content_type}'
        return self._request(url, params={'page': page})

    def fetch_player(self, post_id):
        """Obtiene enlaces de reproducción y descarga."""
        url = f'{API_URL}/player'
        return self._request(url, params={'postId': post_id})

    def fetch_episodes(self, post_id, season=1):
        """Obtiene episodios de una serie/anime."""
        url = f'{API_URL}/single/episodes/list'
        return self._request(url, params={'_id': post_id, 'season': season})

    def _resolve_taxonomies(self, ids, taxonomy_map):
        """Resuelve IDs de taxonomías a sus nombres."""
        if not ids:
            return []
        return [taxonomy_map.get(str(id_), f'ID:{id_}') for id_ in ids]

    def _build_image_url(self, path):
        """Construye la URL completa de una imagen."""
        if not path:
            return None
        if path.startswith('http'):
            return path
        if path.startswith('/'):
            return f'{IMAGE_BASE}{path}'
        return f'{IMAGE_BASE}/{path}'

    def _parse_content_item(self, item):
        """Parsea un item del listado a un diccionario normalizado."""
        # Resolver taxonomías a nombres legibles
        genres = self._resolve_taxonomies(item.get('genres', []), GENRES_MAP)
        quality = self._resolve_taxonomies(item.get('quality', []), QUALITY_MAP)
        languages = self._resolve_taxonomies(item.get('lang', []), LANG_MAP)

        # Resolver año desde los IDs de taxonomía
        year_ids = item.get('years', [])
        year = None
        if year_ids:
            # Extraer año de la fecha de estreno si está disponible
            release_date = item.get('release_date', '')
            if release_date:
                year = release_date.split('-')[0]

        images = item.get('images', {})

        return {
            'external_id': item.get('_id'),
            'title': item.get('title', ''),
            'original_title': item.get('original_title', ''),
            'slug': item.get('slug', ''),
            'overview': item.get('overview', ''),
            'content_type': item.get('type', 'movies'),
            'poster': self._build_image_url(images.get('poster')),
            'backdrop': self._build_image_url(images.get('backdrop')),
            'logo': self._build_image_url(images.get('logo')),
            'trailer': item.get('trailer', ''),
            'rating': item.get('rating', ''),
            'imdb_rating': item.get('imdb_rating'),
            'vote_count': item.get('vote_count', ''),
            'genres': json.dumps(genres, ensure_ascii=False),
            'quality': json.dumps(quality, ensure_ascii=False),
            'countries': json.dumps(self._resolve_taxonomies(item.get('countries', []), {}), ensure_ascii=False),
            'languages': json.dumps(languages, ensure_ascii=False),
            'year': year,
            'runtime': item.get('runtime', ''),
            'certification': item.get('certification', ''),
            'release_date': item.get('release_date', ''),
            'tagline': item.get('tagline', ''),
            'gallery': item.get('gallery', ''),
            'last_update': item.get('last_update', ''),
        }

    def scrape_listing(self, content_type, start_page=1, end_page=None, job_id=None):
        """
        Scrapea el listado completo de un tipo de contenido con paginación.
        Ejecuta en un hilo separado.
        """
        from models import db, Content, ScrapeJob

        self._stop_event.clear()
        self._current_job_id = job_id

        with self.app.app_context():
            # Obtener primera página para saber total
            first_page = self.fetch_listing(content_type, start_page)
            if not first_page or first_page.get('error'):
                self._update_job(job_id, 'failed', error_log='Error al obtener la primera página')
                return

            pagination = first_page.get('data', {}).get('pagination', {})
            total_pages = pagination.get('last_page', 1)

            if end_page:
                total_pages = min(total_pages, end_page)

            # Actualizar trabajo con total de páginas
            self._update_job(job_id, 'running', total_pages=total_pages)

            items_scraped = 0
            errors = 0
            error_messages = []

            for page in range(start_page, total_pages + 1):
                if self.is_stopped():
                    self._update_job(job_id, 'stopped',
                                     current_page=page - 1,
                                     items_scraped=items_scraped,
                                     errors=errors,
                                     error_log='\n'.join(error_messages[-50:]))
                    return

                try:
                    if page == start_page:
                        data = first_page
                    else:
                        data = self.fetch_listing(content_type, page)
                        time.sleep(self.delay)

                    if not data or data.get('error'):
                        errors += 1
                        error_messages.append(f'Página {page}: Error al obtener datos')
                        continue

                    posts = data.get('data', {}).get('posts', [])

                    for post in posts:
                        try:
                            parsed = self._parse_content_item(post)

                            # Verificar si ya existe y actualizar o crear
                            existing = Content.query.filter_by(
                                external_id=parsed['external_id']
                            ).first()

                            if existing:
                                for key, value in parsed.items():
                                    setattr(existing, key, value)
                                existing.scraped_at = datetime.utcnow()
                            else:
                                content = Content(**parsed)
                                db.session.add(content)

                            items_scraped += 1
                        except Exception as e:
                            errors += 1
                            error_messages.append(f'Item {post.get("_id", "?")}: {str(e)}')

                    db.session.commit()

                    # Actualizar progreso del trabajo
                    self._update_job(job_id, 'running',
                                     current_page=page,
                                     items_scraped=items_scraped,
                                     errors=errors)

                    logger.info(f'[{content_type}] Página {page}/{total_pages} - {items_scraped} items')

                except Exception as e:
                    errors += 1
                    error_messages.append(f'Página {page}: {str(e)}')
                    db.session.rollback()

            # Trabajo completado
            self._update_job(job_id, 'completed',
                             current_page=total_pages,
                             items_scraped=items_scraped,
                             errors=errors,
                             error_log='\n'.join(error_messages[-50:]) if error_messages else None)

    def scrape_downloads(self, content_ids=None, job_id=None):
        """
        Scrapea los enlaces de descarga para el contenido especificado.
        Si no se especifican IDs, scrapea todos los que no tengan descargas.
        """
        from models import db, Content, DownloadLink, EmbedLink, ScrapeJob

        self._stop_event.clear()

        with self.app.app_context():
            if content_ids:
                contents = Content.query.filter(Content.id.in_(content_ids)).all()
            else:
                contents = Content.query.filter_by(downloads_scraped=False).all()

            total = len(contents)
            if total == 0:
                self._update_job(job_id, 'completed', items_scraped=0, total_pages=0)
                return

            self._update_job(job_id, 'running', total_pages=total)

            items_scraped = 0
            errors = 0
            error_messages = []

            for i, content in enumerate(contents):
                if self.is_stopped():
                    self._update_job(job_id, 'stopped',
                                     current_page=i,
                                     items_scraped=items_scraped,
                                     errors=errors)
                    return

                try:
                    player_data = self.fetch_player(content.external_id)
                    time.sleep(self.delay)

                    if not player_data or player_data.get('error'):
                        errors += 1
                        error_messages.append(f'{content.title}: Error al obtener player')
                        continue

                    data = player_data.get('data', {})

                    # Limpiar descargas y embeds existentes
                    DownloadLink.query.filter_by(content_id=content.id).delete()
                    EmbedLink.query.filter_by(content_id=content.id).delete()

                    # Guardar descargas
                    downloads = data.get('downloads', [])
                    for dl in downloads:
                        download = DownloadLink(
                            content_id=content.id,
                            url=dl.get('url', ''),
                            server=dl.get('server', ''),
                            quality=dl.get('quality', ''),
                            language=dl.get('lang', ''),
                            size=dl.get('size'),
                            subtitle=dl.get('subtitle', 0),
                            format=dl.get('format'),
                            resolution=dl.get('resolution'),
                        )
                        db.session.add(download)

                    # Guardar embeds
                    embeds = data.get('embeds', [])
                    for em in embeds:
                        embed = EmbedLink(
                            content_id=content.id,
                            url=em.get('url', ''),
                            server=em.get('server', ''),
                            quality=em.get('quality', ''),
                            language=em.get('lang', ''),
                            subtitle=em.get('subtitle', 0),
                        )
                        db.session.add(embed)

                    content.downloads_scraped = True
                    items_scraped += 1
                    db.session.commit()

                    self._update_job(job_id, 'running',
                                     current_page=i + 1,
                                     items_scraped=items_scraped,
                                     errors=errors)

                    logger.info(f'[downloads] {i + 1}/{total} - {content.title}: {len(downloads)} descargas')

                except Exception as e:
                    errors += 1
                    error_messages.append(f'{content.title}: {str(e)}')
                    db.session.rollback()

            self._update_job(job_id, 'completed',
                             current_page=total,
                             items_scraped=items_scraped,
                             errors=errors,
                             error_log='\n'.join(error_messages[-50:]) if error_messages else None)

    def scrape_episodes(self, content_ids=None, job_id=None):
        """Scrapea episodios de series y animes."""
        from models import db, Content, Episode, EpisodeDownload, ScrapeJob

        self._stop_event.clear()

        with self.app.app_context():
            query = Content.query.filter(Content.content_type.in_(['tvshows', 'animes']))
            if content_ids:
                query = query.filter(Content.id.in_(content_ids))

            contents = query.all()
            total = len(contents)

            self._update_job(job_id, 'running', total_pages=total)

            items_scraped = 0
            errors = 0

            for i, content in enumerate(contents):
                if self.is_stopped():
                    self._update_job(job_id, 'stopped', current_page=i, items_scraped=items_scraped, errors=errors)
                    return

                try:
                    # Intentar obtener hasta 20 temporadas
                    for season_num in range(1, 21):
                        ep_data = self.fetch_episodes(content.external_id, season_num)
                        time.sleep(self.delay * 0.5)

                        if not ep_data or not ep_data.get('data'):
                            break

                        episodes_list = ep_data.get('data', [])
                        if not episodes_list:
                            break

                        for ep in episodes_list:
                            # Verificar si ya existe
                            existing = Episode.query.filter_by(
                                content_id=content.id,
                                season=season_num,
                                episode_number=ep.get('number', ep.get('episode_number'))
                            ).first()

                            if not existing:
                                episode = Episode(
                                    content_id=content.id,
                                    external_id=ep.get('_id'),
                                    title=ep.get('title', ''),
                                    slug=ep.get('slug', ''),
                                    season=season_num,
                                    episode_number=ep.get('number', ep.get('episode_number')),
                                    poster=ep.get('poster', ''),
                                )
                                db.session.add(episode)

                    items_scraped += 1
                    db.session.commit()

                    self._update_job(job_id, 'running',
                                     current_page=i + 1,
                                     items_scraped=items_scraped,
                                     errors=errors)

                except Exception as e:
                    errors += 1
                    db.session.rollback()

            self._update_job(job_id, 'completed',
                             current_page=total,
                             items_scraped=items_scraped,
                             errors=errors)

    def _update_job(self, job_id, status, **kwargs):
        """Actualiza el estado de un trabajo de scraping."""
        if not job_id or not self.app:
            return
        from models import db, ScrapeJob
        try:
            with self.app.app_context():
                job = ScrapeJob.query.get(job_id)
                if job:
                    job.status = status
                    for key, value in kwargs.items():
                        if hasattr(job, key):
                            setattr(job, key, value)
                    if status == 'running' and not job.started_at:
                        job.started_at = datetime.utcnow()
                    if status in ('completed', 'failed', 'stopped'):
                        job.finished_at = datetime.utcnow()
                    db.session.commit()
        except Exception as e:
            logger.error(f'Error actualizando job {job_id}: {e}')
