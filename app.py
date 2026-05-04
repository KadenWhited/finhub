from flask import Flask, send_from_directory, request, session, jsonify
from flask_cors import CORS
from dotenv import load_dotenv
from datetime import timedelta
load_dotenv()
import os
import sys

def _get_base_dir() -> str:
    if getattr(sys, 'frozen', False):
        return os.path.dirname(sys.executable)
    return os.path.dirname(os.path.abspath(__file__))

BASE_DIR = _get_base_dir()

def _get_frontend_dir() -> str:
    env_override = os.environ.get('MONEYRIGHT_FRONTEND_DIR')
    if env_override and os.path.isdir(env_override):
        return env_override
    if getattr(sys, 'frozen', False) and hasattr(sys, '_MEIPASS'):
        return os.path.join(sys._MEIPASS, 'frontend')
    return os.path.join(BASE_DIR, 'frontend')

FRONTEND_DIR = _get_frontend_dir()

# Visible
from backend.models.database import init_db
from backend.routes.auth import auth_bp
from backend.routes.market import market_bp
from backend.routes.trades import trades_bp
from backend.routes.checkbook import checkbook_bp
from backend.routes.credit import credit_bp
from backend.routes.budget import budget_bp
from backend.routes.gambling import gambling_bp
from backend.routes.predictions import predictions_bp
from backend.routes.market_sentiment import sentiment_bp
from backend.routes.dashboard import dashboard_bp
from backend.routes.notes import notes_bp
from backend.routes.news import news_bp
from backend.routes.settings import settings_bp
from backend.routes.tools import tools_bp

# Non Visible
from backend.routes.export import export_bp
from backend.routes.charts import charts_bp
from backend.routes.backtester import backtester_bp
from backend.routes.safeguards import safeguards_bp
from backend.routes.alerts import alerts_bp
from backend.routes.push import push_bp
from backend.routes.connections import connections_bp
from backend.routes.coinbase import coinbase_bp
from backend.routes.email_parser import email_bp

from backend.services.ingestion.scheduler import init_scheduler, shutdown_scheduler

app = Flask(
    __name__,
    static_folder=os.path.join(FRONTEND_DIR),
    static_url_path='',
)

with app.app_context():
    init_db()

CORS(app, origins=[
    'http://localhost:5000',
    'http://127.0.0.1:5000',
    # Add your Tailscale IP and domain if VPS deployed:
    # 'http://100.x.x.x:5000',
    # 'https://yourdomain.com',
], supports_credentials=True)

app.config['SESSION_COOKIE_SECURE']       = os.environ.get('FLASK_ENV') != 'development'
app.config['SESSION_COOKIE_HTTPONLY']     = True
app.config['SESSION_COOKIE_SAMESITE']    = 'Lax'
app.config['PERMANENT_SESSION_LIFETIME'] = timedelta(days=30)
app.config['MAX_CONTENT_LENGTH']         = 16 * 1024 * 1024  # 16MB max

secret = os.environ.get('SECRET_KEY')
if not secret:
    if os.environ.get('FLASK_ENV') == 'development':
        secret = 'dev-only-not-for-production'
    else:
        raise RuntimeError('SECRET_KEY must be set in .env before running in production')
app.secret_key = secret

def _read_version() -> str:
    try:
        with open(os.path.join(os.path.dirname(__file__), 'version.txt')) as f:
            return f.read().strip()
    except Exception:
        return '1.0.0'

APP_VERSION = _read_version()

# ── Blueprints ────────────────────────────────────────────────────────────────
app.register_blueprint(auth_bp,         url_prefix='/api/auth')
app.register_blueprint(market_bp,       url_prefix='/api/market')
app.register_blueprint(trades_bp,       url_prefix='/api/trades')
app.register_blueprint(checkbook_bp,    url_prefix='/api/checkbook')
app.register_blueprint(credit_bp,       url_prefix='/api/credit')
app.register_blueprint(budget_bp,       url_prefix='/api/budget')
app.register_blueprint(gambling_bp,     url_prefix='/api/gambling')
app.register_blueprint(dashboard_bp,    url_prefix='/api/dashboard')
app.register_blueprint(notes_bp,        url_prefix='/api/notes')
app.register_blueprint(news_bp,         url_prefix='/api/news')
app.register_blueprint(settings_bp,     url_prefix='/api/settings')
app.register_blueprint(tools_bp,        url_prefix='/api/tools')
app.register_blueprint(export_bp,       url_prefix='/api/export')
app.register_blueprint(charts_bp,       url_prefix='/api/charts')
app.register_blueprint(backtester_bp,   url_prefix='/api/backtester')
app.register_blueprint(safeguards_bp,   url_prefix='/api/safeguards')
app.register_blueprint(alerts_bp,       url_prefix='/api/alerts')
app.register_blueprint(push_bp,         url_prefix='/api/push')
app.register_blueprint(connections_bp,  url_prefix='/api/connections')
app.register_blueprint(coinbase_bp,     url_prefix='/api/coinbase')
app.register_blueprint(predictions_bp,  url_prefix='/api/predictions')
app.register_blueprint(email_bp,        url_prefix='/api/email')
app.register_blueprint(sentiment_bp,    url_prefix='/api/sentiment')


# ── Auth middleware ───────────────────────────────────────────────────────────
@app.before_request
def check_auth():
    open_prefixes = ('/api/auth/', '/css/', '/js/', '/assets/')
    open_exact    = {'/manifest.json', '/login', '/sw.js', '/'}
    if request.path in open_exact or any(request.path.startswith(p) for p in open_prefixes):
        return None

    app_password = os.environ.get('APP_PASSWORD')
    if not app_password:
        return None

    if request.path.startswith('/api/') and not session.get('authenticated'):
        return jsonify({'error': 'Unauthorized', 'redirect': '/login'}), 401


# ── Security headers ──────────────────────────────────────────────────────────
@app.after_request
def security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options']        = 'SAMEORIGIN'
    response.headers['X-XSS-Protection']       = '1; mode=block'
    if os.environ.get('FLASK_ENV') != 'development':
        response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    return response

# ──   App Version    ──────────────────────────────────────────────────────────
@app.route('/api/version')
def get_version():
    return jsonify({'version': APP_VERSION})

# ── Static routes ─────────────────────────────────────────────────────────────
@app.route('/')
@app.route('/<path:path>')
def serve_frontend(path=''):
    # Auth check
    if path.startswith('api/'):
        return  # Let API routes handle it

    # Serve login page if not authenticated
    from flask import session, send_from_directory
    if path == 'login' or path == 'login.html':
        return send_from_directory(FRONTEND_DIR, 'login.html')

    # Check auth
    if not session.get('authenticated'):
        return send_from_directory(FRONTEND_DIR, 'login.html')

    # Serve index for all other routes (SPA)
    return send_from_directory(FRONTEND_DIR, 'index.html')


# ── Entry point ───────────────────────────────────────────────────────────────
if __name__ == '__main__':
    import os
    debug = os.environ.get('FLASK_ENV') == 'development'
    app.run(debug=debug, host='127.0.0.1', port=5000)