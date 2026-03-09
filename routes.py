# Rutas API para el servidor Flask
# Maneja endpoints de scraping, consulta de contenido, y exportación
import json
import csv
import io
import os
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


# ─── TMDB & GENERADOR DE COMANDOS ────────────────────────────

@api.route('/api/tmdb/search')
def tmdb_search():
    """Busca en TMDB por título y año para obtener el TMDB ID."""
    import requests as req
    import random

    title = request.args.get('title', '').strip()
    year = request.args.get('year', '').strip()
    content_type = request.args.get('type', 'movie')  # movie o tv

    if not title:
        return jsonify({'error': True, 'message': 'Título requerido'}), 400

    # Pool de API keys de TMDB (rotación para evitar límites)
    TMDB_API_KEYS = [
        '10923b261ba94d897ac6b81148314a3f',
        'b573d051ec65413c949e68169923f7ff',
        'da40aaeca884d8c9a9a4c088917c474c',
        '4e44d9029b1270a757cddc766a1bcb63',
        '39151834c95219c3cae772b4465079d7',
        '6bca0b74270a3299673d934c1bb11b4d',
        '902ddd650dd51f569c2ef95468612ad1',
        '4c7ff8e6151131469216f007e4be3b3d',
        '21e3f055fa996f78a2886737bb6e7957',
        '98325a9d3ed3ec225e41ccc4d360c817',
        '3fd2be6f0c70a2a598f084ddfb75487c',
        '9780d3ceee590a40bd3446da3f81171d',
        '04c35731a5ee918f014970082a0088b1',
        '516adf1e1567058f8ecbf30bf2eb9378',
        '9b702a6b89b0278738dab62417267c49',
    ]

    search_type = 'movie' if content_type in ('movies', 'movie') else 'tv'
    url = f'https://api.themoviedb.org/3/search/{search_type}'

    # Limpiar título: quitar año entre paréntesis
    import re
    clean_title = re.sub(r'\s*\(\d{4}\)\s*$', '', title).strip()

    # Intentar con varias keys hasta que funcione
    last_error = None
    random.shuffle(TMDB_API_KEYS)

    for api_key in TMDB_API_KEYS[:3]:
        params = {
            'api_key': api_key,
            'query': clean_title,
            'language': 'es-MX',
        }
        if year:
            params['year' if search_type == 'movie' else 'first_air_date_year'] = year

        try:
            response = req.get(url, params=params, timeout=10)
            if response.status_code == 401:
                last_error = 'API key inválida'
                continue

            data = response.json()
            results = data.get('results', [])

            # Devolver los primeros 5 resultados
            simplified = []
            for r in results[:5]:
                simplified.append({
                    'tmdb_id': r.get('id'),
                    'title': r.get('title') or r.get('name', ''),
                    'original_title': r.get('original_title') or r.get('original_name', ''),
                    'year': (r.get('release_date') or r.get('first_air_date') or '')[:4],
                    'poster': f"https://image.tmdb.org/t/p/w92{r['poster_path']}" if r.get('poster_path') else None,
                    'overview': r.get('overview', '')[:100],
                })

            return jsonify({'error': False, 'results': simplified})
        except Exception as e:
            last_error = str(e)
            continue

    return jsonify({'error': True, 'message': f'Error en búsqueda TMDB: {last_error}'}), 500


@api.route('/api/content/<int:content_id>/set-tmdb', methods=['POST'])
def set_tmdb_id(content_id):
    """Asigna un TMDB ID a un contenido."""
    content = Content.query.get_or_404(content_id)
    data = request.get_json() or {}
    tmdb_id = data.get('tmdb_id')

    if not tmdb_id:
        return jsonify({'error': True, 'message': 'tmdb_id requerido'}), 400

    content.tmdb_id = tmdb_id
    db.session.commit()

    return jsonify({'error': False, 'message': f'TMDB ID {tmdb_id} asignado a "{content.title}"'})


@api.route('/api/content/<int:content_id>/generate-command', methods=['POST'])
def generate_command(content_id):
    """Genera comandos CLI para procesar descargas."""
    content = Content.query.get_or_404(content_id)
    data = request.get_json() or {}

    tmdb_id = data.get('tmdb_id') or content.tmdb_id
    upload_servers = data.get('upload_servers', [])
    password = data.get('password', '')

    if not tmdb_id:
        return jsonify({'error': True, 'message': 'Se requiere un TMDB ID. Búscalo primero.'}), 400

    # Extraer año limpio del título o de la fecha
    year = content.year or ''
    if not year and content.release_date:
        year = content.release_date[:4]

    # Título limpio (sin año entre paréntesis)
    import re
    clean_title = re.sub(r'\s*\(\d{4}\)\s*$', '', content.title).strip()

    # Generar un comando por cada enlace de descarga
    commands = []
    downloads = DownloadLink.query.filter_by(content_id=content.id).all()

    for dl in downloads:
        # Determinar calidad limpia
        quality = dl.quality or ''
        quality_clean = quality.replace('Dual ', '').replace('Full HD', '1080p').replace('HD', '720p')
        if not quality_clean:
            quality_clean = '1080p'

        # Determinar idioma limpio
        lang = dl.language or ''
        lang_parts = [l.strip() for l in lang.split('/')]
        lang_clean = lang_parts[0] if lang_parts else 'Latino'

        # Construir comando base
        cmd_parts = ['python main.py process']
        cmd_parts.append(f'"{dl.url}"')
        cmd_parts.append(f'-i {tmdb_id}')
        cmd_parts.append(f'-t "{clean_title}"')
        if year:
            cmd_parts.append(f'-y {year}')
        cmd_parts.append(f'-Q {quality_clean}')
        cmd_parts.append(f'-l {lang_clean}')

        if password:
            cmd_parts.append(f'-p "{password}"')

        # Agregar servidores de upload
        for server in upload_servers:
            cmd_parts.append(f'--upload {server}')

        commands.append({
            'command': ' '.join(cmd_parts) + '; rm -rf downloads/*;',
            'server': dl.server,
            'quality': dl.quality,
            'language': dl.language,
            'url': dl.url,
        })

    return jsonify({
        'error': False,
        'commands': commands,
        'total': len(commands),
        'title': clean_title,
        'tmdb_id': tmdb_id,
    })


@api.route('/api/content/bulk-generate', methods=['POST'])
def bulk_generate_commands():
    """Genera comandos CLI para múltiples contenidos a la vez."""
    import requests as req
    import random
    import re

    data = request.get_json() or {}
    content_ids = data.get('content_ids', [])
    upload_servers = data.get('upload_servers', [])
    password = data.get('password', '')
    auto_resolve_tmdb = data.get('auto_resolve_tmdb', True)

    if not content_ids:
        return jsonify({'error': True, 'message': 'No se seleccionaron contenidos'}), 400

    # Pool de API keys
    TMDB_API_KEYS = [
        '10923b261ba94d897ac6b81148314a3f',
        'b573d051ec65413c949e68169923f7ff',
        'da40aaeca884d8c9a9a4c088917c474c',
        '4e44d9029b1270a757cddc766a1bcb63',
        '39151834c95219c3cae772b4465079d7',
        '6bca0b74270a3299673d934c1bb11b4d',
        '902ddd650dd51f569c2ef95468612ad1',
        '4c7ff8e6151131469216f007e4be3b3d',
        '21e3f055fa996f78a2886737bb6e7957',
        '98325a9d3ed3ec225e41ccc4d360c817',
        '3fd2be6f0c70a2a598f084ddfb75487c',
    ]

    all_results = []
    errors = []
    import time

    for cid in content_ids:
        content = Content.query.get(cid)
        if not content:
            errors.append(f'ID {cid} no encontrado')
            continue

        tmdb_id = content.tmdb_id

        # Auto-resolver TMDB ID si no tiene
        if not tmdb_id and auto_resolve_tmdb:
            clean_title = re.sub(r'\s*\(\d{4}\)\s*$', '', content.title).strip()
            search_type = 'movie' if content.content_type in ('movies',) else 'tv'
            year = content.year or ''

            api_key = random.choice(TMDB_API_KEYS)
            params = {
                'api_key': api_key,
                'query': clean_title,
                'language': 'es-MX',
            }
            if year:
                params['year' if search_type == 'movie' else 'first_air_date_year'] = year

            try:
                resp = req.get(
                    f'https://api.themoviedb.org/3/search/{search_type}',
                    params=params, timeout=10
                )
                if resp.status_code == 200:
                    results = resp.json().get('results', [])
                    if results:
                        tmdb_id = results[0]['id']
                        content.tmdb_id = tmdb_id
                        db.session.commit()
                time.sleep(0.3)  # Rate limiting para TMDB
            except Exception:
                pass

        if not tmdb_id:
            errors.append(f'"{content.title}" - No se pudo obtener TMDB ID')
            continue

        # Obtener año y título limpio
        year = content.year or ''
        if not year and content.release_date:
            year = content.release_date[:4]
        clean_title = re.sub(r'\s*\(\d{4}\)\s*$', '', content.title).strip()

        # Generar comandos para cada descarga
        downloads = DownloadLink.query.filter_by(content_id=content.id).all()

        if not downloads:
            errors.append(f'"{content.title}" - Sin enlaces de descarga')
            continue

        for dl in downloads:
            quality = dl.quality or ''
            quality_clean = quality.replace('Dual ', '').replace('Full HD', '1080p').replace('HD', '720p')
            if not quality_clean:
                quality_clean = '1080p'

            lang = dl.language or ''
            lang_parts = [l.strip() for l in lang.split('/')]
            lang_clean = lang_parts[0] if lang_parts else 'Latino'

            cmd_parts = ['python main.py process']
            cmd_parts.append(f'"{dl.url}"')
            cmd_parts.append(f'-i {tmdb_id}')
            cmd_parts.append(f'-t "{clean_title}"')
            if year:
                cmd_parts.append(f'-y {year}')
            cmd_parts.append(f'-Q {quality_clean}')
            cmd_parts.append(f'-l {lang_clean}')

            if password:
                cmd_parts.append(f'-p "{password}"')

            for server in upload_servers:
                cmd_parts.append(f'--upload {server}')

            all_results.append({
                'command': ' '.join(cmd_parts) + '; rm -rf downloads/*;',
                'title': clean_title,
                'tmdb_id': tmdb_id,
                'quality': dl.quality,
                'language': dl.language,
                'server': extractServerNamePy(dl.url),
            })

    return jsonify({
        'error': False,
        'commands': all_results,
        'total': len(all_results),
        'errors': errors,
        'processed': len(content_ids) - len(errors),
    })


def _build_command(dl, tmdb_id, clean_title, year, password='', upload_servers=None, poster=None, content_type='movies', content_id=None):
    """Construye un comando CLI a partir de un enlace de descarga."""
    # Determinar calidad limpia
    quality = dl.quality or ''
    quality_clean = quality.replace('Dual ', '').replace('Full HD', '1080p').replace('HD', '720p')
    if not quality_clean:
        quality_clean = '1080p'

    # Determinar idioma limpio
    lang = dl.language or ''
    lang_parts = [l.strip() for l in lang.split('/')]
    lang_clean = lang_parts[0] if lang_parts else 'Latino'

    # Construir comando base
    cmd_parts = ['python main.py process']
    cmd_parts.append(f'"{dl.url}"')
    cmd_parts.append(f'-i {tmdb_id}')
    cmd_parts.append(f'-t "{clean_title}"')
    if year:
        cmd_parts.append(f'-y {year}')
    cmd_parts.append(f'-Q {quality_clean}')
    cmd_parts.append(f'-l {lang_clean}')

    if password:
        cmd_parts.append(f'-p "{password}"')

    # Agregar servidores de upload
    for server in (upload_servers or []):
        cmd_parts.append(f'--upload {server}')

    return {
        'command': ' '.join(cmd_parts) + '; rm -rf downloads/*;',
        'title': clean_title,
        'tmdb_id': tmdb_id,
        'content_id': content_id,
        'quality': dl.quality,
        'language': dl.language,
        'server': extractServerNamePy(dl.url),
        'url': dl.url,
        'poster': poster,
        'content_type': content_type,
        'year': year,
    }


@api.route('/api/content/page-generate-mediafire', methods=['POST'])
def page_generate_mediafire():
    """Genera comandos CLI solo para enlaces de MediaFire de los contenidos indicados.
       Auto-scrapea descargas si no han sido extraídas aún."""
    import requests as req
    import random
    import re
    import time

    data = request.get_json() or {}
    content_ids = data.get('content_ids', [])
    upload_servers = data.get('upload_servers', [])
    password = data.get('password', '')
    auto_resolve_tmdb = data.get('auto_resolve_tmdb', True)

    if not content_ids:
        return jsonify({'error': True, 'message': 'No se enviaron IDs de contenido'}), 400

    # Pool de API keys para TMDB
    TMDB_API_KEYS = [
        '10923b261ba94d897ac6b81148314a3f',
        'b573d051ec65413c949e68169923f7ff',
        'da40aaeca884d8c9a9a4c088917c474c',
        '4e44d9029b1270a757cddc766a1bcb63',
        '39151834c95219c3cae772b4465079d7',
        '6bca0b74270a3299673d934c1bb11b4d',
        '902ddd650dd51f569c2ef95468612ad1',
        '4c7ff8e6151131469216f007e4be3b3d',
        '21e3f055fa996f78a2886737bb6e7957',
        '98325a9d3ed3ec225e41ccc4d360c817',
        '3fd2be6f0c70a2a598f084ddfb75487c',
    ]

    all_results = []
    errors = []
    skipped = 0
    scraped_count = 0

    for cid in content_ids:
        content = Content.query.get(cid)
        if not content:
            continue

        # Auto-scrapear descargas si no se han extraído aún
        if not content.downloads_scraped and scraper:
            try:
                player_data = scraper.fetch_player(content.external_id)
                time.sleep(0.3)

                if player_data and not player_data.get('error'):
                    pdata = player_data.get('data', {})

                    # Limpiar descargas y embeds existentes
                    DownloadLink.query.filter_by(content_id=content.id).delete()
                    EmbedLink.query.filter_by(content_id=content.id).delete()

                    # Guardar descargas
                    for dl in pdata.get('downloads', []):
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
                    for em in pdata.get('embeds', []):
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
                    db.session.commit()
                    scraped_count += 1
            except Exception as e:
                db.session.rollback()
                errors.append(f'"{content.title}" - Error scrapeando descargas: {str(e)[:50]}')
                continue

        tmdb_id = content.tmdb_id

        # Auto-resolver TMDB ID si no tiene
        if not tmdb_id and auto_resolve_tmdb:
            clean_title = re.sub(r'\s*\(\d{4}\)\s*$', '', content.title).strip()
            search_type = 'movie' if content.content_type in ('movies',) else 'tv'
            year = content.year or ''

            api_key = random.choice(TMDB_API_KEYS)
            params = {
                'api_key': api_key,
                'query': clean_title,
                'language': 'es-MX',
            }
            if year:
                params['year' if search_type == 'movie' else 'first_air_date_year'] = year

            try:
                resp = req.get(
                    f'https://api.themoviedb.org/3/search/{search_type}',
                    params=params, timeout=10
                )
                if resp.status_code == 200:
                    results = resp.json().get('results', [])
                    if results:
                        tmdb_id = results[0]['id']
                        content.tmdb_id = tmdb_id
                        db.session.commit()
                time.sleep(0.3)
            except Exception:
                pass

        if not tmdb_id:
            errors.append(f'"{content.title}" - No se pudo obtener TMDB ID')
            continue

        # Preparar título y año
        year = content.year or ''
        if not year and content.release_date:
            year = content.release_date[:4]
        clean_title = re.sub(r'\s*\(\d{4}\)\s*$', '', content.title).strip()

        # Obtener solo descargas de MediaFire
        downloads = DownloadLink.query.filter_by(content_id=content.id).all()
        mf_downloads = [dl for dl in downloads if dl.url and 'mediafire' in dl.url.lower()]

        if not mf_downloads:
            skipped += 1
            continue

        for dl in mf_downloads:
            all_results.append(
                _build_command(dl, tmdb_id, clean_title, year, password, upload_servers,
                               poster=content.poster, content_type=content.content_type,
                               content_id=content.id)
            )

    return jsonify({
        'error': False,
        'commands': all_results,
        'total': len(all_results),
        'errors': errors,
        'skipped': skipped,
        'scraped': scraped_count,
        'processed': len(content_ids) - len(errors) - skipped,
    })


def extractServerNamePy(url):
    """Extrae nombre del servidor de una URL."""
    try:
        from urllib.parse import urlparse
        return urlparse(url).hostname.replace('www.', '')
    except Exception:
        return 'unknown'


# ─── COLA DE COMANDOS (SERVIDOR) ─────────────────────────

import json

QUEUE_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'command_queue.json')


def _load_queue():
    """Carga la cola de comandos del archivo JSON."""
    try:
        with open(QUEUE_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return []


def _save_queue(queue):
    """Guarda la cola de comandos en el archivo JSON."""
    with open(QUEUE_FILE, 'w', encoding='utf-8') as f:
        json.dump(queue, f, ensure_ascii=False, indent=2)


@api.route('/api/queue')
def get_queue():
    """Obtiene todos los comandos en la cola."""
    queue = _load_queue()
    return jsonify({'error': False, 'commands': queue, 'total': len(queue)})


@api.route('/api/queue/add', methods=['POST'])
def add_to_queue():
    """Agrega uno o varios comandos a la cola."""
    data = request.get_json() or {}
    commands = data.get('commands', [])

    if not commands:
        return jsonify({'error': True, 'message': 'No se enviaron comandos'}), 400

    queue = _load_queue()
    queue.extend(commands)
    _save_queue(queue)

    return jsonify({'error': False, 'message': f'{len(commands)} comando(s) agregado(s)', 'total': len(queue)})


@api.route('/api/queue/clear', methods=['POST'])
def clear_queue():
    """Limpia toda la cola de comandos."""
    _save_queue([])
    return jsonify({'error': False, 'message': 'Cola limpiada'})


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
