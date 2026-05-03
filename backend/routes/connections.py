"""
backend/routes/connections.py
Connection status, configuration, and manual sync triggers.
"""
import os
from flask import Blueprint, request, jsonify
from backend.models.database import get_db
from backend.services.ingestion.scheduler import get_scheduler, get_scheduler_status

connections_bp = Blueprint('connections', __name__)

SERVICES = {
    'kraken': {
        'label':       'Kraken',
        'description': 'Read-only trade history and balance sync',
        'env_keys':    ['KRAKEN_API_KEY', 'KRAKEN_API_SECRET'],
        'mode':        'read',
        'phase':       2,
    },
    'kalshi': {
        'label':       'Kalshi',
        'description': 'Prediction market positions, watchlist, and order execution',
        'env_keys':    ['KALSHI_API_KEY_ID', 'KALSHI_API_PRIVATE_KEY'],
        'mode':        'read_write',
        'phase':       3,
    },
    'gmail': {
        'label':       'Gmail (Bank & Credit Email Parsing)',
        'description': 'Auto-import transactions from bank and credit card emails',
        'env_keys':    ['GMAIL_ADDRESS', 'GMAIL_APP_PASSWORD'],
        'mode':        'read',
        'phase':       4,
    },
}


@connections_bp.route('/', methods=['GET'])
def get_connections():
    """Return status of all services."""
    db = get_db()
    rows = db.execute('SELECT * FROM connections').fetchall()
    db.close()

    db_status = {r['service']: dict(r) for r in rows}
    scheduler_status = get_scheduler_status()

    result = []
    for service_id, meta in SERVICES.items():
        configured = all(os.environ.get(k) for k in meta['env_keys'])
        db_row     = db_status.get(service_id, {})

        result.append({
            'service':         service_id,
            'label':           meta['label'],
            'description':     meta['description'],
            'mode':            meta['mode'],
            'phase':           meta['phase'],
            'configured':      configured,
            'enabled':         db_row.get('enabled', 1),
            'last_sync_at':    db_row.get('last_sync_at'),
            'last_sync_status':db_row.get('last_sync_status'),
            'records_imported':db_row.get('records_imported', 0),
            'error_message':   db_row.get('error_message'),
        })

    return jsonify({
        'connections': result,
        'scheduler':   scheduler_status,
    })


@connections_bp.route('/<service>/toggle', methods=['POST'])
def toggle_service(service):
    """Enable or disable a service."""
    if service not in SERVICES:
        return jsonify({'error': 'Unknown service'}), 404

    data    = request.get_json() or {}
    enabled = 1 if data.get('enabled', True) else 0

    db = get_db()
    db.execute('''
        INSERT INTO connections (service, enabled, updated_at)
        VALUES (?, ?, datetime('now'))
        ON CONFLICT(service) DO UPDATE SET
            enabled    = excluded.enabled,
            updated_at = excluded.updated_at
    ''', (service, enabled))
    db.commit()
    db.close()

    return jsonify({'ok': True, 'service': service, 'enabled': bool(enabled)})


@connections_bp.route('/<service>/sync', methods=['POST'])
def manual_sync(service):
    """Trigger an immediate sync for a service."""
    if service not in SERVICES:
        return jsonify({'error': 'Unknown service'}), 404

    meta       = SERVICES[service]
    configured = all(os.environ.get(k) for k in meta['env_keys'])
    if not configured:
        return jsonify({'error': f'{meta["label"]} not configured — add API keys to .env'}), 400

    scheduler = get_scheduler()
    if scheduler:
        job = scheduler.get_job(f'{service}_sync')
        if job:
            job.modify(next_run_time=__import__('datetime').datetime.now(
                __import__('datetime').timezone.utc
            ))
            return jsonify({'ok': True, 'message': f'{service} sync triggered'})

    return jsonify({'error': 'Scheduler not running'}), 503


@connections_bp.route('/log', methods=['GET'])
def get_ingestion_log():
    """Return recent ingestion log entries."""
    source = request.args.get('source')
    limit  = min(int(request.args.get('limit', 100)), 500)

    db    = get_db()
    query = 'SELECT * FROM ingestion_log'
    args  = []
    if source:
        query += ' WHERE source = ?'
        args.append(source)
    query += ' ORDER BY created_at DESC LIMIT ?'
    args.append(limit)

    rows = [dict(r) for r in db.execute(query, args).fetchall()]
    db.close()
    return jsonify(rows)


@connections_bp.route('/status', methods=['GET'])
def get_status():
    """Quick health check for all configured services."""
    results = {}

    # Coinbase
    if os.environ.get('COINBASE_API_KEY_NAME'):
        try:
            from backend.services.ingestion.kraken import test_connection
            results['coinbase'] = test_connection()
        except ImportError:
            results['coinbase'] = {'ok': False, 'error': 'Service not built yet'}
        except Exception as e:
            results['coinbase'] = {'ok': False, 'error': str(e)}
    else:
        results['coinbase'] = {'ok': False, 'error': 'Not configured'}

    # Kalshi
    if os.environ.get('KALSHI_API_KEY_ID'):
        try:
            from backend.services.ingestion.kalshi import test_connection
            results['kalshi'] = test_connection()
        except ImportError:
            results['kalshi'] = {'ok': False, 'error': 'Service not built yet'}
        except Exception as e:
            results['kalshi'] = {'ok': False, 'error': str(e)}
    else:
        results['kalshi'] = {'ok': False, 'error': 'Not configured'}

    # Gmail
    if os.environ.get('GMAIL_APP_PASSWORD'):
        try:
            from backend.services.ingestion.email_parser import test_connection
            results['gmail'] = test_connection()
        except ImportError:
            results['gmail'] = {'ok': False, 'error': 'Service not built yet'}
        except Exception as e:
            results['gmail'] = {'ok': False, 'error': str(e)}
    else:
        results['gmail'] = {'ok': False, 'error': 'Not configured'}

    return jsonify(results)
