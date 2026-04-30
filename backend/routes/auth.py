from flask import Blueprint, request, jsonify, session
from collections import defaultdict
import os, time

auth_bp = Blueprint('auth', __name__)

_login_attempts = defaultdict(list)
MAX_ATTEMPTS    = 10
WINDOW_SECONDS  = 300  # 5 minutes


def require_auth(f):
    from functools import wraps
    @wraps(f)
    def decorated(*args, **kwargs):
        app_password = os.environ.get('APP_PASSWORD')
        if not app_password:
            return f(*args, **kwargs)
        if not session.get('authenticated'):
            return jsonify({'error': 'Unauthorized', 'redirect': '/login'}), 401
        return f(*args, **kwargs)
    return decorated


@auth_bp.route('/login', methods=['POST'])
def login():
    ip  = request.remote_addr
    now = time.time()

    # Rate limiting — clean old attempts then check
    _login_attempts[ip] = [t for t in _login_attempts[ip] if now - t < WINDOW_SECONDS]
    if len(_login_attempts[ip]) >= MAX_ATTEMPTS:
        return jsonify({'error': 'Too many attempts. Try again in 5 minutes.'}), 429
    _login_attempts[ip].append(now)

    # Auth check
    app_password = os.environ.get('APP_PASSWORD')
    if not app_password:
        session['authenticated'] = True
        return jsonify({'ok': True})

    data = request.get_json() or {}
    if data.get('password') == app_password:
        session['authenticated'] = True
        session.permanent = True
        return jsonify({'ok': True})

    return jsonify({'error': 'Wrong password'}), 401


@auth_bp.route('/logout', methods=['POST'])
def logout():
    session.clear()
    return jsonify({'ok': True})


@auth_bp.route('/check', methods=['GET'])
def check():
    app_password = os.environ.get('APP_PASSWORD')
    if not app_password:
        return jsonify({'authenticated': True, 'password_set': False})
    return jsonify({
        'authenticated': session.get('authenticated', False),
        'password_set':  True
    })