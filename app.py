# Aplicación principal Flask para el scraper de la.movie
# Servidor web que integra el motor de scraping con la interfaz web
import os
from flask import Flask, render_template
from flask_cors import CORS
from models import db
from routes import api, set_scraper
from scraper import LaMovieScraper

# Configuración de la aplicación
BASE_DIR = os.path.abspath(os.path.dirname(__file__))


def create_app():
    """Crea y configura la aplicación Flask."""
    app = Flask(__name__, 
                template_folder='templates',
                static_folder='static')

    # Configuración de la base de datos SQLite
    app.config['SQLALCHEMY_DATABASE_URI'] = f'sqlite:///{os.path.join(BASE_DIR, "peliscraper.db")}'
    app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
    app.config['SECRET_KEY'] = 'peliscraper-secret-key-2024'

    # Inicializar extensiones
    CORS(app)
    db.init_app(app)

    # Crear tablas de la base de datos
    with app.app_context():
        db.create_all()

        # Migración: agregar columna tmdb_id si no existe
        try:
            from sqlalchemy import text, inspect
            inspector = inspect(db.engine)
            columns = [col['name'] for col in inspector.get_columns('content')]
            if 'tmdb_id' not in columns:
                db.session.execute(text('ALTER TABLE content ADD COLUMN tmdb_id INTEGER'))
                db.session.commit()
                print('✅ Columna tmdb_id agregada a la tabla content')
        except Exception as e:
            print(f'⚠️ Migración tmdb_id: {e}')

    # Inicializar el scraper con referencia a la app
    scraper_instance = LaMovieScraper(app=app)
    set_scraper(scraper_instance)

    # Registrar rutas de la API
    app.register_blueprint(api)

    # Ruta principal - sirve la interfaz web
    @app.route('/')
    def index():
        return render_template('index.html')

    return app


if __name__ == '__main__':
    app = create_app()
    print('╔══════════════════════════════════════════╗')
    print('║   🎬 PeliScraper - la.movie Scraper     ║')
    print('║   Servidor: http://localhost:5000        ║')
    print('╚══════════════════════════════════════════╝')
    app.run(debug=True, host='0.0.0.0', port=5000)
