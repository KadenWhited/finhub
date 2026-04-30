from flask import Flask, send_from_directory, request, session, jsonify
from flask_cors import CORS
from dotenv import load_dotenv
from datetime import timedelta
load_dotenv()
import os

# Visible
from backend.models.database import init_db
from backend.routes.auth import auth_bp
from backend.routes.market import market_bp
from backend.routes.trades import trades_bp
from backend.routes.checkbook import checkbook_bp
from backend.routes.credit import credit_bp
from backend.routes.gambling import gambling_bp
from backend.routes.dashboard import dashboard_bp
from backend.routes.notes import notes_bp
from backend.routes.settings import settings_bp
from backend.routes.tools import tools_bp

# Non Visible
from backend.routes.export import export_bp
from backend.routes.charts import charts_bp

app = Flask(__name__, static_folder='frontend', static_url_path='')
CORS(app)

app.secret_key = os.environ.get('SECRET_KEY', 'dev-fallback-change-this')

# Register blueprints
app.register_blueprint(auth_bp, url_prefix='/api/auth')
app.register_blueprint(market_bp, url_prefix='/api/market')
app.register_blueprint(trades_bp, url_prefix='/api/trades')
app.register_blueprint(checkbook_bp, url_prefix='/api/checkbook')
app.register_blueprint(credit_bp, url_prefix='/api/credit')
app.register_blueprint(gambling_bp, url_prefix='/api/gambling')
app.register_blueprint(dashboard_bp, url_prefix='/api/dashboard')
app.register_blueprint(notes_bp, url_prefix='/api/notes')
app.register_blueprint(settings_bp, url_prefix='/api/settings')
app.register_blueprint(tools_bp, url_prefix='/api/tools')

app.register_blueprint(export_bp, url_prefix='/api/export')
app.register_blueprint(charts_bp, url_prefix='/api/charts')

app.config['PERMANENT_SESSION_LIFETIME'] = timedelta(days=30)
app.config['SESSION_COOKIE_HTTPONLY'] = True
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'

@app.before_request
def check_auth():
    # Allow auth endpoints and static files through always
    open_paths = ['/api/auth/', '/css/', '/js/', '/assets/', '/manifest.json']
    if any(request.path.startswith(p) for p in open_paths):
        return None

    # Check password if set
    app_password = os.environ.get('APP_PASSWORD')
    if not app_password:
        return None  # No password set, allow everything

    if request.path.startswith('/api/') and not session.get('authenticated'):
        return jsonify({'error': 'Unauthorized', 'redirect': '/login'}), 401

@app.route('/')
def index():
    return send_from_directory('frontend', 'index.html')

@app.route('/<path:path>')
def serve_static(path):
    return send_from_directory('frontend', path)

@app.route('/login')
def login_page():
    return send_from_directory('frontend', 'login.html')

if __name__ == '__main__':
    init_db()
    debug_mode = os.environ.get('FLASK_ENV') == 'development'
    print("\n🚀 Finance Hub running at http://localhost:5000\n")
    if debug_mode:
        print("⚠  Debug mode ON — development only\n")
    app.run(debug=debug_mode, host='0.0.0.0', port=5000)