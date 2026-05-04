"""
backend/routes/backup.py
Backup export and import endpoints.
"""
import os
from datetime import datetime
from flask import Blueprint, request, jsonify, send_file
from backend.models.database import get_db
from backend.services.backup import (
    export_backup, import_backup, validate_backup,
    SCOPES, BACKUP_EXTENSION
)
import io

backup_bp = Blueprint('backup', __name__)


# ─────────────────────────────────────────
#  EXPORT
# ─────────────────────────────────────────

@backup_bp.route('/export', methods=['POST'])
def export():
    """
    Create and download a backup file.

    Body (JSON):
        scope:     'full' | 'financial' | 'settings' | 'market'
        password:  string (optional — omit for unencrypted backup)
        filename:  string (optional — custom filename)
    """
    data     = request.get_json() or {}
    scope    = data.get('scope', 'full')
    password = data.get('password') or None  # Empty string = None
    filename = data.get('filename', '')

    if scope not in SCOPES:
        return jsonify({'error': f'Invalid scope. Choose: {list(SCOPES.keys())}'}), 400

    db = get_db()
    try:
        content = export_backup(db, scope=scope, password=password)
    except Exception as e:
        db.close()
        return jsonify({'error': str(e)}), 500
    finally:
        db.close()

    # Build filename
    if not filename:
        ts       = datetime.now().strftime('%Y%m%d_%H%M%S')
        enc_tag  = '_encrypted' if password else ''
        filename = f'moneyright_{scope}_{ts}{enc_tag}{BACKUP_EXTENSION}'

    return send_file(
        io.BytesIO(content),
        mimetype='application/octet-stream',
        as_attachment=True,
        download_name=filename,
    )


# ─────────────────────────────────────────
#  VALIDATE (pre-import check)
# ─────────────────────────────────────────

@backup_bp.route('/validate', methods=['POST'])
def validate():
    """
    Validate a backup file and return its metadata.
    Accepts multipart file upload or raw bytes.

    Form data:
        file:     the .mrbackup file
        password: decryption password (optional)
    """
    password = request.form.get('password') or request.json and request.json.get('password')

    if 'file' in request.files:
        f       = request.files['file']
        content = f.read()
    elif request.data:
        content = request.data
    else:
        return jsonify({'error': 'No backup file provided'}), 400

    try:
        result = validate_backup(content, password=password or None)
        return jsonify(result)
    except Exception as e:
        return jsonify({'valid': False, 'error': str(e)}), 400


# ─────────────────────────────────────────
#  IMPORT
# ─────────────────────────────────────────

@backup_bp.route('/import', methods=['POST'])
def import_data():
    """
    Import a backup file.

    Form data:
        file:     the .mrbackup file
        password: decryption password (if encrypted)
        mode:     'merge' (default) | 'replace'
    """
    password = request.form.get('password') or None
    mode     = request.form.get('mode', 'merge')

    if mode not in ('merge', 'replace'):
        return jsonify({'error': "mode must be 'merge' or 'replace'"}), 400

    if 'file' not in request.files:
        return jsonify({'error': 'No backup file provided'}), 400

    f       = request.files['file']
    content = f.read()

    if not content:
        return jsonify({'error': 'Empty file'}), 400

    # Validate first
    validation = validate_backup(content, password=password)
    if not validation['valid']:
        return jsonify({'error': validation.get('error', 'Invalid backup')}), 400

    if validation['encrypted'] and not password:
        return jsonify({'error': 'Backup is encrypted — password required'}), 400

    # Import
    db = get_db()
    try:
        summary = import_backup(db, content, password=password, mode=mode)
        return jsonify({'ok': True, **summary})
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        db.rollback()
        return jsonify({'error': f'Import failed: {str(e)[:200]}'}), 500
    finally:
        db.close()


# ─────────────────────────────────────────
#  LIST LOCAL BACKUPS (safety backups)
# ─────────────────────────────────────────

@backup_bp.route('/list', methods=['GET'])
def list_backups():
    """List auto-generated safety backups stored in data/backups/."""
    try:
        base    = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))
        backups = os.path.join(base, 'data', 'backups')
        if not os.path.exists(backups):
            return jsonify([])

        files = []
        for fname in sorted(os.listdir(backups), reverse=True):
            if fname.endswith('.mrbackup'):
                path = os.path.join(backups, fname)
                files.append({
                    'filename': fname,
                    'size_kb':  round(os.path.getsize(path) / 1024, 1),
                    'created':  datetime.fromtimestamp(
                        os.path.getmtime(path)
                    ).isoformat(),
                })
        return jsonify(files[:20])  # Last 20 safety backups
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@backup_bp.route('/download-local/<filename>', methods=['GET'])
def download_local(filename):
    """Download a safety backup from data/backups/."""
    # Sanitize filename to prevent path traversal
    filename = os.path.basename(filename)
    if not filename.endswith('.mrbackup'):
        return jsonify({'error': 'Invalid filename'}), 400

    base    = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))
    path    = os.path.join(base, 'data', 'backups', filename)

    if not os.path.exists(path):
        return jsonify({'error': 'File not found'}), 404

    return send_file(path, as_attachment=True, download_name=filename)


# ─────────────────────────────────────────
#  SCOPES INFO
# ─────────────────────────────────────────

@backup_bp.route('/scopes', methods=['GET'])
def get_scopes():
    return jsonify({
        scope: {
            'tables': tables,
            'description': {
                'full':      'Complete database backup — all tables and settings',
                'financial': 'All financial data — trades, checkbook, credit, gambling, predictions',
                'settings':  'App settings and watchlists only — no financial records',
                'market':    'Watchlists and stock positions only',
            }.get(scope, '')
        }
        for scope, tables in SCOPES.items()
    })
