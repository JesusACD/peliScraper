# Rutas API para el servidor Flask
# Maneja endpoints de scraping, consulta de contenido, y exportación
import json
import csv
import io
import threading
from flask import Blueprint, request, jsonify, Response
from datetime import datetime
from models import db, Content, DownloadLink, EmbedLink, Episode, EpisodeDownload, ScrapeJob

api = Blueprint('api', __name__)

# Referencia global al scraper (se asigna desde app.py)
scraper = None


def set_scraper(s):
    """Asigna la instancia del scraper desde app.py."""
    global scraper
    scraper = s


# ─── SCRAPING ────────────────────────────────────────────────

@api.route('/api/scrape/start', methods=['POST'])
def start_scrape():
    """Inicia un trabajo de scraping."""
    data = request.get_json() or {}
    content_type = data.get('content_type', 'movies')  # movies, tvshows, animes, downloads, episodes
    start_page = data.get('start_page', 1)
    end_page = data.get('end_page')  # None = todas las páginas

    # Verificar si ya hay un scraping en curso
    active_job = ScrapeJob.query.filter_by(status='running').first()
    if active_job:
        return jsonify({'error': True, 'message': 'Ya hay un scraping en curso', 'job': active_job.to_dict()}), 409

    # Crear nuevo trabajo
    job = ScrapeJob(content_type=content_type, status='pending')
    db.session.add(job)
    db.session.commit()

    # Ejecutar en hilo separado según el tipo
    if content_type in ('movies', 'tvshows', 'animes'):
        thread = threading.Thread(
            target=scraper.scrape_listing,
            args=(content_type, start_page, end_page, job.id),
            daemon=True
        )
    elif content_type == 'downloads':
        # Scrapea descargas de todo el contenido que no las tenga
        content_ids = data.get('content_ids')  # Opcional: IDs específicos
        thread = threading.Thread(
            target=scraper.scrape_downloads,
            args=(content_ids, job.id),
            daemon=True
        )
    elif content_type == 'episodes':
        content_ids = data.get('content_ids')
        thread = threading.Thread(
            target=scraper.scrape_episodes,
            args=(content_ids, job.id),
            daemon=True
        )
    else:
        db.session.delete(job)
        db.session.commit()
        return jsonify({'error': True, 'message': f'Tipo no válido: {content_type}'}), 400

    thread.start()
    return jsonify({'error': False, 'message': 'Scraping iniciado', 'job': job.to_dict()})


@api.route('/api/scrape/status')
def scrape_status():
    """Obtiene el estado del scraping activo o el último completado."""
    active_job = ScrapeJob.query.filter_by(status='running').first()
    if active_job:
        return jsonify({'error': False, 'active': True, 'job': active_job.to_dict()})

    # Si no hay activo, devolver el último
    last_job = ScrapeJob.query.order_by(ScrapeJob.id.desc()).first()
    if last_job:
        return jsonify({'error': False, 'active': False, 'job': last_job.to_dict()})

    return jsonify({'error': False, 'active': False, 'job': None})


@api.route('/api/scrape/stop', methods=['POST'])
def stop_scrape():
    """Detiene el scraping actual."""
    if scraper:
        scraper.stop()
    return jsonify({'error': False, 'message': 'Señal de parada enviada'})


@api.route('/api/scrape/history')
def scrape_history():
    """Historial de trabajos de scraping."""
    jobs = ScrapeJob.query.order_by(ScrapeJob.id.desc()).limit(20).all()
    return jsonify({'error': False, 'jobs': [j.to_dict() for j in jobs]})


# ─── CONTENIDO ───────────────────────────────────────────────

@api.route('/api/content')
def list_content():
    """Lista contenido con filtros y paginación."""
    content_type = request.args.get('type', 'all')
    page = int(request.args.get('page', 1))
    per_page = int(request.args.get('per_page', 24))
    search = request.args.get('search', '').strip()
    genre = request.args.get('genre', '').strip()
    year = request.args.get('year', '').strip()
    sort_by = request.args.get('sort', 'scraped_at')  # scraped_at, title, rating, year
    order = request.args.get('order', 'desc')

    query = Content.query

    # Filtrar por tipo de contenido
    if content_type != 'all':
        query = query.filter_by(content_type=content_type)

    # Búsqueda por título
    if search:
        query = query.filter(
            db.or_(
                Content.title.ilike(f'%{search}%'),
                Content.original_title.ilike(f'%{search}%')
            )
        )

    # Filtrar por género
    if genre:
        query = query.filter(Content.genres.ilike(f'%{genre}%'))

    # Filtrar por año
    if year:
        query = query.filter(Content.year == year)

    # Ordenamiento
    sort_column = getattr(Content, sort_by, Content.scraped_at)
    if order == 'desc':
        query = query.order_by(sort_column.desc())
    else:
        query = query.order_by(sort_column.asc())

    # Paginación
    paginated = query.paginate(page=page, per_page=per_page, error_out=False)

    return jsonify({
        'error': False,
        'data': [c.to_summary() for c in paginated.items],
        'pagination': {
            'page': paginated.page,
            'per_page': per_page,
            'total': paginated.total,
            'pages': paginated.pages,
            'has_next': paginated.has_next,
            'has_prev': paginated.has_prev,
        }
    })


@api.route('/api/content/<int:content_id>')
def get_content(content_id):
    """Obtiene detalle completo de un contenido junto con descargas."""
    content = Content.query.get_or_404(content_id)
    data = content.to_dict()

    # Incluir episodios si es serie o anime
    if content.content_type in ('tvshows', 'animes'):
        episodes = Episode.query.filter_by(content_id=content.id).order_by(
            Episode.season, Episode.episode_number
        ).all()
        data['episodes'] = [e.to_dict() for e in episodes]

    return jsonify({'error': False, 'data': data})


@api.route('/api/content/<int:content_id>/scrape-downloads', methods=['POST'])
def scrape_content_downloads(content_id):
    """Scrapea descargas de un contenido específico."""
    content = Content.query.get_or_404(content_id)

    # Crear trabajo
    job = ScrapeJob(content_type='downloads', status='pending')
    db.session.add(job)
    db.session.commit()

    thread = threading.Thread(
        target=scraper.scrape_downloads,
        args=([content.id], job.id),
        daemon=True
    )
    thread.start()

    return jsonify({'error': False, 'message': f'Scrapeando descargas de "{content.title}"', 'job': job.to_dict()})


# ─── ESTADÍSTICAS ────────────────────────────────────────────

@api.route('/api/stats')
def get_stats():
    """Estadísticas generales del scraping."""
    total_movies = Content.query.filter_by(content_type='movies').count()
    total_series = Content.query.filter_by(content_type='tvshows').count()
    total_animes = Content.query.filter_by(content_type='animes').count()
    total_downloads = DownloadLink.query.count()
    total_episodes = Episode.query.count()
    total_with_downloads = Content.query.filter_by(downloads_scraped=True).count()

    return jsonify({
        'error': False,
        'stats': {
            'movies': total_movies,
            'series': total_series,
            'animes': total_animes,
            'total_content': total_movies + total_series + total_animes,
            'downloads': total_downloads,
            'episodes': total_episodes,
            'with_downloads': total_with_downloads,
        }
    })


# ─── EXPORTACIÓN ─────────────────────────────────────────────

@api.route('/api/export/<export_type>')
def export_data(export_type):
    """Exporta datos en formato JSON o CSV."""
    content_type = request.args.get('type', 'all')
    include_downloads = request.args.get('downloads', 'true') == 'true'

    query = Content.query
    if content_type != 'all':
        query = query.filter_by(content_type=content_type)

    contents = query.all()

    if export_type == 'json':
        data = []
        for c in contents:
            item = c.to_dict() if include_downloads else c.to_summary()
            data.append(item)

        return Response(
            json.dumps(data, ensure_ascii=False, indent=2),
            mimetype='application/json',
            headers={'Content-Disposition': f'attachment; filename=lamovie_{content_type}_{datetime.now().strftime("%Y%m%d")}.json'}
        )

    elif export_type == 'csv':
        output = io.StringIO()
        writer = csv.writer(output)

        # Cabeceras
        headers = ['ID', 'Título', 'Título Original', 'Tipo', 'Año', 'Rating', 'Géneros',
                    'Calidad', 'Idiomas', 'Duración', 'Sinopsis', 'Poster', 'Slug']
        if include_downloads:
            headers.extend(['Descargas (JSON)'])
        writer.writerow(headers)

        for c in contents:
            row = [
                c.external_id, c.title, c.original_title, c.content_type,
                c.year, c.rating, c.genres, c.quality, c.languages,
                c.runtime, c.overview, c.poster, c.slug
            ]
            if include_downloads:
                downloads = [d.to_dict() for d in c.downloads]
                row.append(json.dumps(downloads, ensure_ascii=False))
            writer.writerow(row)

        return Response(
            output.getvalue(),
            mimetype='text/csv',
            headers={'Content-Disposition': f'attachment; filename=lamovie_{content_type}_{datetime.now().strftime("%Y%m%d")}.csv'}
        )

    return jsonify({'error': True, 'message': 'Formato no soportado. Usa json o csv'}), 400


# ─── UTILIDADES ──────────────────────────────────────────────

@api.route('/api/genres')
def list_genres():
    """Lista todos los géneros disponibles."""
    from scraper import GENRES_MAP
    return jsonify({'error': False, 'genres': list(GENRES_MAP.values())})


@api.route('/api/years')
def list_years():
    """Lista todos los años disponibles en la base de datos."""
    years = db.session.query(Content.year).distinct().filter(
        Content.year.isnot(None)
    ).order_by(Content.year.desc()).all()
    return jsonify({'error': False, 'years': [y[0] for y in years if y[0]]})


@api.route('/api/db/clear', methods=['POST'])
def clear_database():
    """Limpia toda la base de datos."""
    data = request.get_json() or {}
    content_type = data.get('content_type', 'all')

    if content_type == 'all':
        EpisodeDownload.query.delete()
        Episode.query.delete()
        EmbedLink.query.delete()
        DownloadLink.query.delete()
        Content.query.delete()
        ScrapeJob.query.delete()
    else:
        contents = Content.query.filter_by(content_type=content_type).all()
        for c in contents:
            db.session.delete(c)

    db.session.commit()
    return jsonify({'error': False, 'message': f'Base de datos limpiada ({content_type})'})
