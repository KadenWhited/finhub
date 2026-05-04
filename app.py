from flask import Flask, send_from_directory, request, session, jsonify
from flask_cors import CORS
from datetime import timedelta
import threading as _threading
import os
import sys

def _get_base_dir() -> str:
    if getattr(sys, 'frozen', False):
        return os.path.dirname(sys.executable)
    return os.path.dirname(os.path.abspath(__file__))

BASE_DIR = _get_base_dir()

from dotenv import load_dotenv
_env_path = os.path.join(BASE_DIR, '.env')
if os.path.exists(_env_path):
    load_dotenv(_env_path, override=False)

def _get_frontend_dir() -> str:
    env_override = os.environ.get('MONEYRIGHT_FRONTEND_DIR')
    if env_override and os.path.isdir(env_override):
        return env_override
    if getattr(sys, 'frozen', False) and hasattr(sys, '_MEIPASS'):
        return os.path.join(sys._MEIPASS, 'frontend') # type: ignore[attr-defined]
    return os.path.join(BASE_DIR, 'frontend')

FRONTEND_DIR = _get_frontend_dir()
print(f"[startup] FRONTEND_DIR: {FRONTEND_DIR}")
print(f"[startup] login.html exists: {os.path.exists(os.path.join(FRONTEND_DIR, 'login.html'))}")

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
from backend.routes.backup import backup_bp

from backend.services.ingestion.scheduler import init_scheduler, shutdown_scheduler

app = Flask(
    __name__,
    #static_folder=os.path.join(FRONTEND_DIR),
    #static_url_path='',
    static_folder=None,
    static_url_path=None,
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
        path = os.path.join(BASE_DIR, 'version.txt')
        if not os.path.exists(path) and hasattr(sys, '_MEIPASS'):
            path = os.path.join(sys._MEIPASS, 'version.txt')  # type: ignore[attr-defined]
        with open(path) as f:
            return f.read().strip()
    except Exception:
        return '1.5.3'

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
app.register_blueprint(backup_bp,       url_prefix='/api/backup')


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
@app.route('/', defaults={'path': ''})
@app.route('/<path:path>')
def serve_frontend(path=''):
    from flask import send_from_directory
    
    public_files = ('manifest.json', 'sw.js', 'favicon.ico', 'robots.txt')
    
    if path.startswith('api/'):
        from flask import abort
        abort(404)

    if path in ('login', 'login.html'):
        return send_from_directory(FRONTEND_DIR, 'login.html')

    if path in public_files or path.startswith('assets/'):
        try:
            return send_from_directory(FRONTEND_DIR, path)
        except Exception:
            from flask import abort
            abort(404)

    if not session.get('authenticated'):
        app_password = os.environ.get('APP_PASSWORD')
        if app_password:
            return send_from_directory(FRONTEND_DIR, 'login.html')

    if path and '.' in path:
        try:
            return send_from_directory(FRONTEND_DIR, path)
        except Exception:
            from flask import abort
            abort(404)

    return send_from_directory(FRONTEND_DIR, 'index.html')


# ── Entry point ───────────────────────────────────────────────────────────────
if __name__ == '__main__':
    import os
    debug = os.environ.get('FLASK_ENV') == 'development'
    app.run(debug=debug, host='127.0.0.1', port=5000)

# ──   System   ───────────────────────────────────────────────────────────────
_scheduler_paused = False

@app.route('/api/system/pause', methods=['POST'])
def pause_system():
    """Pause background jobs (alerts, syncs) without stopping the server."""
    global _scheduler_paused
    from backend.services.ingestion.scheduler import get_scheduler
    sched = get_scheduler()
    if sched and sched.running:
        sched.pause()
    _scheduler_paused = True
    return jsonify({'ok': True, 'paused': True})

@app.route('/api/system/resume', methods=['POST'])
def resume_system():
    global _scheduler_paused
    from backend.services.ingestion.scheduler import get_scheduler
    sched = get_scheduler()
    if sched and sched.running:
        sched.resume()
    _scheduler_paused = False
    return jsonify({'ok': True, 'paused': False})

@app.route('/api/system/status', methods=['GET'])
def system_status():
    return jsonify({'paused': _scheduler_paused})

@app.route('/api/system/quit', methods=['POST'])
def quit_app():
    """Fully stop the server."""
    import threading
    def _stop():
        import time, os
        time.sleep(1)
        os._exit(0)
    threading.Thread(target=_stop, daemon=True).start()
    return jsonify({'ok': True, 'message': 'Shutting down...'})
