from flask import Blueprint, request, jsonify, session
import os

auth_bp = Blueprint('auth', __name__)

def require_auth(f):
    """Decorator to protect API routes."""
    from functools import wraps
    @wraps(f)
    def decorated(*args, **kwargs):
        # Skip auth if no password is set (local dev)
        app_password = os.environ.get('APP_PASSWORD')
        if not app_password:
            return f(*args, **kwargs)
        if not session.get('authenticated'):
            return jsonify({'error': 'Unauthorized', 'redirect': '/login'}), 401
        return f(*args, **kwargs)
    return decorated

@auth_bp.route('/login', methods=['POST'])
def login():
    app_password = os.environ.get('APP_PASSWORD')
    if not app_password:
        session['authenticated'] = True
        return jsonify({'ok': True})

    data = request.get_json()
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
        'password_set': True
    })