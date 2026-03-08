# Modelos de base de datos para el scraper de la.movie
from flask_sqlalchemy import SQLAlchemy
from datetime import datetime

db = SQLAlchemy()


class Content(db.Model):
    """Modelo principal para películas, series y animes."""
    __tablename__ = 'content'

    id = db.Column(db.Integer, primary_key=True)
    external_id = db.Column(db.Integer, unique=True, nullable=False)  # _id de la.movie
    title = db.Column(db.String(500), nullable=False)
    original_title = db.Column(db.String(500))
    slug = db.Column(db.String(500))
    overview = db.Column(db.Text)
    content_type = db.Column(db.String(20), nullable=False)  # movies, tvshows, animes
    poster = db.Column(db.String(500))
    backdrop = db.Column(db.String(500))
    logo = db.Column(db.String(500))
    trailer = db.Column(db.String(200))
    rating = db.Column(db.String(10))
    imdb_rating = db.Column(db.Float)
    vote_count = db.Column(db.String(20))
    genres = db.Column(db.Text)  # JSON almacenado como texto
    quality = db.Column(db.Text)  # JSON almacenado como texto
    countries = db.Column(db.Text)
    languages = db.Column(db.Text)
    year = db.Column(db.String(10))
    runtime = db.Column(db.String(20))
    certification = db.Column(db.String(20))
    release_date = db.Column(db.String(20))
    tagline = db.Column(db.Text)
    gallery = db.Column(db.Text)
    last_update = db.Column(db.String(30))
    scraped_at = db.Column(db.DateTime, default=datetime.utcnow)
    downloads_scraped = db.Column(db.Boolean, default=False)

    # Relaciones
    downloads = db.relationship('DownloadLink', backref='content', lazy=True, cascade='all, delete-orphan')
    embeds = db.relationship('EmbedLink', backref='content', lazy=True, cascade='all, delete-orphan')
    episodes = db.relationship('Episode', backref='content', lazy=True, cascade='all, delete-orphan')

    def to_dict(self):
        """Convierte el modelo a diccionario para la API."""
        import json
        return {
            'id': self.id,
            'external_id': self.external_id,
            'title': self.title,
            'original_title': self.original_title,
            'slug': self.slug,
            'overview': self.overview,
            'content_type': self.content_type,
            'poster': self.poster,
            'backdrop': self.backdrop,
            'logo': self.logo,
            'trailer': self.trailer,
            'rating': self.rating,
            'imdb_rating': self.imdb_rating,
            'vote_count': self.vote_count,
            'genres': json.loads(self.genres) if self.genres else [],
            'quality': json.loads(self.quality) if self.quality else [],
            'countries': json.loads(self.countries) if self.countries else [],
            'languages': json.loads(self.languages) if self.languages else [],
            'year': self.year,
            'runtime': self.runtime,
            'certification': self.certification,
            'release_date': self.release_date,
            'tagline': self.tagline,
            'gallery': self.gallery.split('\n') if self.gallery else [],
            'last_update': self.last_update,
            'scraped_at': self.scraped_at.isoformat() if self.scraped_at else None,
            'downloads_scraped': self.downloads_scraped,
            'downloads': [d.to_dict() for d in self.downloads],
            'embeds': [e.to_dict() for e in self.embeds],
            'episodes_count': len(self.episodes),
        }

    def to_summary(self):
        """Versión resumida para listados (sin descargas ni episodios)."""
        import json
        return {
            'id': self.id,
            'external_id': self.external_id,
            'title': self.title,
            'slug': self.slug,
            'content_type': self.content_type,
            'poster': self.poster,
            'rating': self.rating,
            'year': self.year,
            'genres': json.loads(self.genres) if self.genres else [],
            'quality': json.loads(self.quality) if self.quality else [],
            'languages': json.loads(self.languages) if self.languages else [],
            'downloads_scraped': self.downloads_scraped,
            'downloads_count': len(self.downloads),
        }


class DownloadLink(db.Model):
    """Enlaces de descarga de contenido."""
    __tablename__ = 'download_links'

    id = db.Column(db.Integer, primary_key=True)
    content_id = db.Column(db.Integer, db.ForeignKey('content.id'), nullable=False)
    url = db.Column(db.Text, nullable=False)
    server = db.Column(db.String(100))
    quality = db.Column(db.String(100))
    language = db.Column(db.String(100))
    size = db.Column(db.String(50))
    subtitle = db.Column(db.Integer, default=0)
    format = db.Column(db.String(50))
    resolution = db.Column(db.String(50))

    def to_dict(self):
        return {
            'id': self.id,
            'url': self.url,
            'server': self.server,
            'quality': self.quality,
            'language': self.language,
            'size': self.size,
            'subtitle': self.subtitle,
            'format': self.format,
            'resolution': self.resolution,
        }


class EmbedLink(db.Model):
    """Enlaces de reproducción embed."""
    __tablename__ = 'embed_links'

    id = db.Column(db.Integer, primary_key=True)
    content_id = db.Column(db.Integer, db.ForeignKey('content.id'), nullable=False)
    url = db.Column(db.Text, nullable=False)
    server = db.Column(db.String(100))
    quality = db.Column(db.String(100))
    language = db.Column(db.String(100))
    subtitle = db.Column(db.Integer, default=0)

    def to_dict(self):
        return {
            'id': self.id,
            'url': self.url,
            'server': self.server,
            'quality': self.quality,
            'language': self.language,
            'subtitle': self.subtitle,
        }


class Episode(db.Model):
    """Episodios de series y animes."""
    __tablename__ = 'episodes'

    id = db.Column(db.Integer, primary_key=True)
    content_id = db.Column(db.Integer, db.ForeignKey('content.id'), nullable=False)
    external_id = db.Column(db.Integer)
    title = db.Column(db.String(500))
    slug = db.Column(db.String(500))
    season = db.Column(db.Integer)
    episode_number = db.Column(db.Integer)
    poster = db.Column(db.String(500))

    # Relación con descargas del episodio
    downloads = db.relationship('EpisodeDownload', backref='episode', lazy=True, cascade='all, delete-orphan')

    def to_dict(self):
        return {
            'id': self.id,
            'external_id': self.external_id,
            'title': self.title,
            'slug': self.slug,
            'season': self.season,
            'episode_number': self.episode_number,
            'poster': self.poster,
            'downloads': [d.to_dict() for d in self.downloads],
        }


class EpisodeDownload(db.Model):
    """Enlaces de descarga de episodios."""
    __tablename__ = 'episode_downloads'

    id = db.Column(db.Integer, primary_key=True)
    episode_id = db.Column(db.Integer, db.ForeignKey('episodes.id'), nullable=False)
    url = db.Column(db.Text, nullable=False)
    server = db.Column(db.String(100))
    quality = db.Column(db.String(100))
    language = db.Column(db.String(100))
    size = db.Column(db.String(50))
    subtitle = db.Column(db.Integer, default=0)

    def to_dict(self):
        return {
            'id': self.id,
            'url': self.url,
            'server': self.server,
            'quality': self.quality,
            'language': self.language,
            'size': self.size,
            'subtitle': self.subtitle,
        }


class ScrapeJob(db.Model):
    """Registro de trabajos de scraping."""
    __tablename__ = 'scrape_jobs'

    id = db.Column(db.Integer, primary_key=True)
    content_type = db.Column(db.String(20), nullable=False)  # movies, tvshows, animes, downloads
    status = db.Column(db.String(20), default='pending')  # pending, running, completed, failed, stopped
    current_page = db.Column(db.Integer, default=0)
    total_pages = db.Column(db.Integer, default=0)
    items_scraped = db.Column(db.Integer, default=0)
    errors = db.Column(db.Integer, default=0)
    error_log = db.Column(db.Text)
    started_at = db.Column(db.DateTime)
    finished_at = db.Column(db.DateTime)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def to_dict(self):
        return {
            'id': self.id,
            'content_type': self.content_type,
            'status': self.status,
            'current_page': self.current_page,
            'total_pages': self.total_pages,
            'items_scraped': self.items_scraped,
            'errors': self.errors,
            'error_log': self.error_log,
            'started_at': self.started_at.isoformat() if self.started_at else None,
            'finished_at': self.finished_at.isoformat() if self.finished_at else None,
            'progress': round((self.current_page / self.total_pages * 100), 1) if self.total_pages > 0 else 0,
        }
