"""
backend/services/ingestion/deduplicator.py
Cross-source deduplication and merge logic.

Priority order (highest wins):
  1. gmail / email_parser  — bank is ground truth
  2. coinbase_api
  3. kalshi_api
  4. manual

When a higher-priority source sees the same transaction,
it updates the existing row's source field rather than
creating a duplicate.
"""
import re
from datetime import datetime, timedelta

SOURCE_PRIORITY = {
    'email_parser': 4,
    'gmail':        4,
    'coinbase_api': 3,
    'kalshi_api':   3,
    'robinhood_csv':2,
    'manual':       1,
}


def source_rank(source: str) -> int:
    return SOURCE_PRIORITY.get(source, 1)


def find_duplicate_checkbook(db, date: str, amount: float,
                              description: str, tx_type: str) -> dict | None:
    """
    Look for an existing checkbook entry that matches within
    ±1 day and ±1% amount. Returns the row or None.
    """
    try:
        d = datetime.fromisoformat(date[:10])
        d_min = (d - timedelta(days=1)).strftime('%Y-%m-%d')
        d_max = (d + timedelta(days=1)).strftime('%Y-%m-%d')
    except Exception:
        d_min = d_max = date[:10]

    amt_min = amount * 0.99
    amt_max = amount * 1.01

    rows = db.execute('''
        SELECT * FROM checkbook
        WHERE date BETWEEN ? AND ?
          AND amount BETWEEN ? AND ?
          AND type = ?
        ORDER BY date DESC
    ''', (d_min, d_max, amt_min, amt_max, tx_type)).fetchall()

    if not rows:
        return None

    # If multiple matches, prefer one with similar description
    desc_norm = _normalize(description)
    for row in rows:
        row_norm = _normalize(row['description'] or '')
        if desc_norm and row_norm and _similarity(desc_norm, row_norm) > 0.4:
            return dict(row)

    # Return closest date match
    return dict(rows[0])


def find_duplicate_credit(db, account_id: int, date: str,
                           amount: float, description: str) -> dict | None:
    """Look for matching credit transaction."""
    try:
        d = datetime.fromisoformat(date[:10])
        d_min = (d - timedelta(days=1)).strftime('%Y-%m-%d')
        d_max = (d + timedelta(days=1)).strftime('%Y-%m-%d')
    except Exception:
        d_min = d_max = date[:10]

    amt_min = amount * 0.99
    amt_max = amount * 1.01

    rows = db.execute('''
        SELECT * FROM credit_transactions
        WHERE account_id = ?
          AND date BETWEEN ? AND ?
          AND amount BETWEEN ? AND ?
        ORDER BY date DESC
    ''', (account_id, d_min, d_max, amt_min, amt_max)).fetchall()

    if not rows:
        return None

    desc_norm = _normalize(description)
    for row in rows:
        row_norm = _normalize(row['description'] or '')
        if desc_norm and row_norm and _similarity(desc_norm, row_norm) > 0.4:
            return dict(row)

    return dict(rows[0]) if rows else None


def find_duplicate_trade(db, external_id: str = None,
                          date: str = None, coin: str = None,
                          amount: float = None) -> dict | None:
    """Look for matching trade by external_id first, then by date/coin/amount."""
    if external_id:
        row = db.execute(
            'SELECT * FROM trades WHERE external_id = ?', (external_id,)
        ).fetchone()
        if row:
            return dict(row)

    if not (date and coin and amount):
        return None

    try:
        d = datetime.fromisoformat(date[:10])
        d_min = (d - timedelta(days=1)).strftime('%Y-%m-%d')
        d_max = (d + timedelta(days=1)).strftime('%Y-%m-%d')
    except Exception:
        d_min = d_max = date[:10]

    amt_min = amount * 0.98
    amt_max = amount * 1.02

    row = db.execute('''
        SELECT * FROM trades
        WHERE coin = ? AND entry_date BETWEEN ? AND ?
          AND entry_price BETWEEN ? AND ?
        ORDER BY entry_date DESC
        LIMIT 1
    ''', (coin.upper(), d_min, d_max, amt_min, amt_max)).fetchone()

    return dict(row) if row else None


def upsert_checkbook(db, data: dict) -> tuple[str, int]:
    """
    Insert or update a checkbook entry.
    Returns ('inserted'|'updated'|'skipped', row_id).
    """
    existing = find_duplicate_checkbook(
        db,
        data['date'],
        data['amount'],
        data.get('description', ''),
        data['type']
    )

    if existing:
        existing_rank = source_rank(existing.get('source', 'manual'))
        incoming_rank = source_rank(data.get('source', 'manual'))

        if incoming_rank > existing_rank:
            # Upgrade source, keep original data but update source
            db.execute(
                'UPDATE checkbook SET source=?, external_id=? WHERE id=?',
                (data['source'], data.get('external_id'), existing['id'])
            )
            db.commit()
            return 'updated', existing['id']
        else:
            return 'skipped', existing['id']

    # New record
    cur = db.cursor()
    cur.execute('''
        INSERT OR IGNORE INTO checkbook
            (type, amount, category, description, date, source, external_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    ''', (
        data['type'],
        data['amount'],
        data.get('category', 'Other'),
        data.get('description', ''),
        data['date'],
        data.get('source', 'manual'),
        data.get('external_id'),
    ))
    db.commit()
    return ('inserted', cur.lastrowid) if cur.lastrowid else ('skipped', 0)


def upsert_credit_transaction(db, data: dict) -> tuple[str, int]:
    """Insert or update a credit transaction."""
    existing = find_duplicate_credit(
        db,
        data['account_id'],
        data['date'],
        data['amount'],
        data.get('description', ''),
    )

    if existing:
        existing_rank = source_rank(existing.get('source', 'manual'))
        incoming_rank = source_rank(data.get('source', 'manual'))
        if incoming_rank > existing_rank:
            db.execute(
                'UPDATE credit_transactions SET source=?, external_id=? WHERE id=?',
                (data['source'], data.get('external_id'), existing['id'])
            )
            db.commit()
            return 'updated', existing['id']
        return 'skipped', existing['id']

    cur = db.cursor()
    cur.execute('''
        INSERT OR IGNORE INTO credit_transactions
            (account_id, type, amount, category, description, date, source, external_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ''', (
        data['account_id'],
        data.get('type', 'charge'),
        data['amount'],
        data.get('category', 'Other'),
        data.get('description', ''),
        data['date'],
        data.get('source', 'manual'),
        data.get('external_id'),
    ))
    db.commit()
    return ('inserted', cur.lastrowid) if cur.lastrowid else ('skipped', 0)


def log_ingestion(db, source: str, status: str, record_type: str,
                  external_id: str = None, message: str = None,
                  raw_data: str = None):
    """Write to ingestion_log table."""
    try:
        db.execute('''
            INSERT INTO ingestion_log
                (source, status, record_type, external_id, message, raw_data)
            VALUES (?, ?, ?, ?, ?, ?)
        ''', (source, status, record_type, external_id, message, raw_data))
        db.commit()
    except Exception as e:
        print(f"[dedup] Failed to write ingestion log: {e}")


# ── Text helpers ──────────────────────────────────────────────────────────────

def _normalize(text: str) -> str:
    if not text:
        return ''
    t = text.lower().strip()
    t = re.sub(r'[^a-z0-9 ]', ' ', t)
    return re.sub(r'\s+', ' ', t).strip()


def _similarity(a: str, b: str) -> float:
    wa = set(a.split())
    wb = set(b.split())
    if not wa or not wb:
        return 0.0
    return len(wa & wb) / len(wa | wb)
