"""
backend/routes/email_parser.py
Gmail email parser endpoints.
"""
import os
from flask import Blueprint, request, jsonify
from backend.models.database import get_db

email_bp = Blueprint('email', __name__)


def _is_configured() -> bool:
    return bool(
        os.environ.get('GMAIL_ADDRESS') and
        os.environ.get('GMAIL_APP_PASSWORD')
    )


@email_bp.route('/status', methods=['GET'])
def status():
    if not _is_configured():
        return jsonify({
            'configured': False,
            'message':    'Add GMAIL_ADDRESS and GMAIL_APP_PASSWORD to .env'
        })
    try:
        from backend.services.ingestion.email_parser import test_connection
        result = test_connection()
        result['configured'] = True
        return jsonify(result)
    except Exception as e:
        return jsonify({'configured': True, 'ok': False, 'error': str(e)})


@email_bp.route('/sync', methods=['POST'])
def manual_sync():
    """Trigger an immediate email sync."""
    if not _is_configured():
        return jsonify({'error': 'Gmail not configured'}), 400
    try:
        from backend.services.ingestion.email_parser import sync_emails
        result = sync_emails()
        return jsonify({'ok': True, **result})
    except Exception as e:
        return jsonify({'error': str(e)}), 503


@email_bp.route('/preview', methods=['POST'])
def preview_emails():
    """
    Preview what would be imported without actually importing.
    Body: { lookback_days: int }
    Useful for testing pattern matching before committing.
    """
    if not _is_configured():
        return jsonify({'error': 'Gmail not configured'}), 400

    data         = request.get_json() or {}
    lookback_days = min(int(data.get('lookback_days', 7)), 90)

    try:
        from backend.services.ingestion.email_parser import (
            fetch_emails, parse_transaction
        )
        emails = fetch_emails(lookback_days=lookback_days)
        parsed = []
        skipped = []

        for em in emails:
            tx = parse_transaction(em)
            if tx:
                parsed.append({
                    'subject':     em['subject'],
                    'sender':      em['sender'],
                    'date':        em['date'],
                    'parsed':      tx,
                })
            else:
                skipped.append({
                    'subject': em['subject'][:80],
                    'sender':  em['sender'][:60],
                    'date':    em['date'],
                })

        return jsonify({
            'total_emails':   len(emails),
            'parseable':      len(parsed),
            'skipped':        len(skipped),
            'transactions':   parsed[:50],
            'skipped_emails': skipped[:20],
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 503


@email_bp.route('/patterns', methods=['GET'])
def get_patterns():
    """List all known bank email patterns."""
    from backend.services.ingestion.bank_patterns import BANK_PATTERNS
    return jsonify([
        {
            'name':     p.name,
            'senders':  p.senders,
            'tx_type':  p.tx_type,
            'category': p.category,
        }
        for p in BANK_PATTERNS
    ])


@email_bp.route('/log', methods=['GET'])
def get_log():
    """Recent email ingestion log entries."""
    limit = min(int(request.args.get('limit', 50)), 200)
    db    = get_db()
    rows  = [dict(r) for r in db.execute('''
        SELECT * FROM ingestion_log
        WHERE source = 'gmail'
        ORDER BY created_at DESC
        LIMIT ?
    ''', (limit,)).fetchall()]
    db.close()
    return jsonify(rows)
