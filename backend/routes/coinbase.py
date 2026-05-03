"""
backend/routes/coinbase.py
Coinbase Advanced Trade endpoints for FinHub frontend.
"""
import os
from flask import Blueprint, jsonify, request
from backend.models.database import get_db

coinbase_bp = Blueprint('coinbase', __name__)


def _is_configured() -> bool:
    return bool(
        os.environ.get('COINBASE_API_KEY_NAME') and
        os.environ.get('COINBASE_API_PRIVATE_KEY')
    )


@coinbase_bp.route('/status', methods=['GET'])
def status():
    if not _is_configured():
        return jsonify({'configured': False,
                        'message': 'Add COINBASE_API_KEY_NAME and COINBASE_API_PRIVATE_KEY to .env'})
    try:
        from backend.services.ingestion.kraken import test_connection
        result = test_connection()
        result['configured'] = True
        return jsonify(result)
    except Exception as e:
        return jsonify({'configured': True, 'ok': False, 'error': str(e)})


@coinbase_bp.route('/accounts', methods=['GET'])
def accounts():
    if not _is_configured():
        return jsonify({'error': 'Coinbase not configured'}), 400
    try:
        from backend.services.ingestion.kraken import get_accounts
        return jsonify(get_accounts())
    except Exception as e:
        return jsonify({'error': str(e)}), 503


@coinbase_bp.route('/positions', methods=['GET'])
def positions():
    if not _is_configured():
        return jsonify({'error': 'Coinbase not configured'}), 400
    try:
        from backend.services.ingestion.kraken import get_positions
        return jsonify(get_positions())
    except Exception as e:
        return jsonify({'error': str(e)}), 503


@coinbase_bp.route('/sync', methods=['POST'])
def manual_sync():
    """Trigger an immediate Coinbase sync."""
    if not _is_configured():
        return jsonify({'error': 'Coinbase not configured'}), 400
    try:
        from backend.services.ingestion.kraken import sync_coinbase
        result = sync_coinbase()
        return jsonify({'ok': True, **result})
    except Exception as e:
        return jsonify({'error': str(e)}), 503


@coinbase_bp.route('/fills', methods=['GET'])
def fills():
    """Return raw fills for the last N days (for debugging / manual review)."""
    if not _is_configured():
        return jsonify({'error': 'Coinbase not configured'}), 400
    days = min(int(request.args.get('days', 30)), 365)
    try:
        from backend.services.ingestion.kraken import get_fills
        return jsonify(get_fills(lookback_days=days))
    except Exception as e:
        return jsonify({'error': str(e)}), 503
