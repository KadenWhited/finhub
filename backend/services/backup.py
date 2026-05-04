"""
backend/services/backup.py
Encrypted backup and restore for Money Right.

Format: .mrbackup (JSON envelope with AES-256-GCM encrypted payload)
Encryption: AES-256-GCM with PBKDF2 key derivation from user password
No password stored anywhere — loss of password = loss of backup access.

Requires: cryptography (already installed)
"""
import os
import json
import base64
import hashlib
import secrets
from datetime import datetime, timezone

# All tables that can be backed up, in dependency order
ALL_TABLES = [
    'settings',
    'watchlist',
    'stock_watchlist',
    'stock_positions',
    'trades',
    'checkbook',
    'credit_accounts',
    'credit_transactions',
    'gambling_sessions',
    'notes',
    'predictions',
    'prediction_watchlist',
    'connections',
    'ingestion_log',
]

# Scope presets
SCOPES = {
    'full': ALL_TABLES,
    'financial': [
        'trades', 'checkbook', 'credit_accounts', 'credit_transactions',
        'gambling_sessions', 'predictions', 'prediction_watchlist',
    ],
    'settings': ['settings', 'watchlist', 'stock_watchlist'],
    'market': ['watchlist', 'stock_watchlist', 'stock_positions'],
}

BACKUP_VERSION = '1.0'
BACKUP_EXTENSION = '.mrbackup'


# ─────────────────────────────────────────
#  KEY DERIVATION
# ─────────────────────────────────────────

def _derive_key(password: str, salt: bytes) -> bytes:
    """Derive 256-bit AES key from password using PBKDF2-HMAC-SHA256."""
    return hashlib.pbkdf2_hmac(
        'sha256',
        password.encode('utf-8'),
        salt,
        iterations=310_000,  # OWASP 2023 recommendation
        dklen=32,
    )


# ─────────────────────────────────────────
#  ENCRYPT / DECRYPT
# ─────────────────────────────────────────

def _encrypt(plaintext: str, password: str) -> dict:
    """
    Encrypt plaintext with AES-256-GCM.
    Returns dict with salt, nonce, ciphertext, tag (all base64).
    """
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    salt      = secrets.token_bytes(32)
    nonce     = secrets.token_bytes(12)
    key       = _derive_key(password, salt)
    aesgcm    = AESGCM(key)
    encrypted = aesgcm.encrypt(nonce, plaintext.encode('utf-8'), None)

    return {
        'salt':       base64.b64encode(salt).decode(),
        'nonce':      base64.b64encode(nonce).decode(),
        'ciphertext': base64.b64encode(encrypted).decode(),
    }


def _decrypt(envelope: dict, password: str) -> str:
    """
    Decrypt AES-256-GCM envelope.
    Raises ValueError on wrong password or tampered data.
    """
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    from cryptography.exceptions import InvalidTag

    try:
        salt       = base64.b64decode(envelope['salt'])
        nonce      = base64.b64decode(envelope['nonce'])
        ciphertext = base64.b64decode(envelope['ciphertext'])
        key        = _derive_key(password, salt)
        aesgcm     = AESGCM(key)
        plaintext  = aesgcm.decrypt(nonce, ciphertext, None)
        return plaintext.decode('utf-8')
    except InvalidTag:
        raise ValueError("Incorrect password or corrupted backup file.")
    except Exception as e:
        raise ValueError(f"Failed to decrypt backup: {e}")


# ─────────────────────────────────────────
#  EXPORT
# ─────────────────────────────────────────

def export_backup(db, scope: str = 'full',
                  password: str | None = None) -> bytes:
    """
    Create a backup of the database.

    Args:
        db:       SQLite connection
        scope:    'full' | 'financial' | 'settings' | 'market'
        password: If provided, encrypts the backup. If None, plain JSON.

    Returns:
        bytes — the complete backup file content
    """
    tables = SCOPES.get(scope, ALL_TABLES)
    payload = {}

    for table in tables:
        try:
            rows = db.execute(f'SELECT * FROM {table}').fetchall()
            payload[table] = [dict(row) for row in rows]
        except Exception:
            # Table might not exist (e.g. newer schema on older install)
            payload[table] = []

    payload_json = json.dumps(payload, ensure_ascii=False, default=str)

    envelope = {
        'format':     'moneyright-backup',
        'version':    BACKUP_VERSION,
        'created_at': datetime.now(timezone.utc).isoformat(),
        'scope':      scope,
        'tables':     tables,
        'encrypted':  password is not None,
        'app_version': _read_app_version(),
    }

    if password:
        envelope['data'] = _encrypt(payload_json, password)
    else:
        # Plain JSON — base64 encode for consistent parsing
        envelope['data'] = {
            'plaintext': base64.b64encode(
                payload_json.encode('utf-8')
            ).decode()
        }

    return json.dumps(envelope, indent=2).encode('utf-8')


def _read_app_version() -> str:
    try:
        base = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))
        with open(os.path.join(base, 'version.txt')) as f:
            return f.read().strip()
    except Exception:
        return 'unknown'


# ─────────────────────────────────────────
#  IMPORT
# ─────────────────────────────────────────

def import_backup(db, backup_bytes: bytes,
                  password: str | None = None,
                  mode: str = 'merge') -> dict:
    """
    Restore from a backup file.

    Args:
        db:           SQLite connection
        backup_bytes: Raw backup file content
        password:     Decryption password (required if encrypted)
        mode:         'merge' — import missing records only
                      'replace' — wipe and restore (creates safety backup first)

    Returns:
        dict with summary: {tables_restored, records_imported, records_skipped, warnings}
    """
    try:
        envelope = json.loads(backup_bytes.decode('utf-8'))
    except Exception:
        raise ValueError("Invalid backup file — not valid JSON.")

    if envelope.get('format') != 'moneyright-backup':
        raise ValueError("Not a Money Right backup file.")

    # Decrypt or decode payload
    data_block = envelope.get('data', {})
    encrypted  = envelope.get('encrypted', False)

    if encrypted:
        if not password:
            raise ValueError("This backup is encrypted. A password is required.")
        payload_json = _decrypt(data_block, password)
    else:
        raw = data_block.get('plaintext', '')
        payload_json = base64.b64decode(raw).decode('utf-8')

    payload = json.loads(payload_json)

    # Safety backup before replace
    if mode == 'replace':
        _safety_backup(db)

    summary = {
        'tables_restored':  0,
        'records_imported': 0,
        'records_skipped':  0,
        'warnings':         [],
        'mode':             mode,
        'scope':            envelope.get('scope', 'unknown'),
        'backup_date':      envelope.get('created_at', 'unknown'),
    }

    for table, rows in payload.items():
        if not rows:
            continue
        try:
            if mode == 'replace':
                db.execute(f'DELETE FROM {table}')

            imported, skipped = _import_table(db, table, rows, mode)
            summary['tables_restored']  += 1
            summary['records_imported'] += imported
            summary['records_skipped']  += skipped

        except Exception as e:
            summary['warnings'].append(f"{table}: {str(e)[:100]}")

    db.commit()
    return summary


def _import_table(db, table: str, rows: list, mode: str) -> tuple[int, int]:
    """Import rows into a table. Returns (imported, skipped)."""
    if not rows:
        return 0, 0

    imported = 0
    skipped  = 0

    # Get column names from first row
    columns = list(rows[0].keys())
    # Remove auto-generated columns that DB handles
    skip_cols = {'created_at', 'updated_at'}
    insert_cols = [c for c in columns if c not in skip_cols or mode == 'replace']

    placeholders = ', '.join(['?' for _ in insert_cols])
    col_str      = ', '.join(insert_cols)

    for row in rows:
        values = [row.get(c) for c in insert_cols]
        try:
            db.execute(
                f'INSERT OR {"REPLACE" if mode == "replace" else "IGNORE"} '
                f'INTO {table} ({col_str}) VALUES ({placeholders})',
                values
            )
            if db.execute('SELECT changes()').fetchone()[0] > 0:
                imported += 1
            else:
                skipped += 1
        except Exception:
            skipped += 1

    return imported, skipped


def _safety_backup(db):
    """Create a timestamped safety backup before destructive import."""
    try:
        base    = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))
        backups = os.path.join(base, 'data', 'backups')
        os.makedirs(backups, exist_ok=True)

        ts       = datetime.now().strftime('%Y%m%d_%H%M%S')
        filename = os.path.join(backups, f'pre_import_{ts}.mrbackup')

        content = export_backup(db, scope='full', password=None)
        with open(filename, 'wb') as f:
            f.write(content)

        print(f"[backup] Safety backup created: {filename}")
    except Exception as e:
        print(f"[backup] Safety backup failed: {e}")
        # Don't block the import if safety backup fails


# ─────────────────────────────────────────
#  VALIDATE
# ─────────────────────────────────────────

def validate_backup(backup_bytes: bytes,
                    password: str | None = None) -> dict:
    """
    Validate a backup file without importing.
    Returns metadata about the backup.
    """
    try:
        envelope = json.loads(backup_bytes.decode('utf-8'))
    except Exception:
        return {'valid': False, 'error': 'Not a valid backup file'}

    if envelope.get('format') != 'moneyright-backup':
        return {'valid': False, 'error': 'Not a Money Right backup file'}

    encrypted = envelope.get('encrypted', False)

    if encrypted and password:
        try:
            _decrypt(envelope['data'], password)
            decrypted = True
        except ValueError as e:
            return {'valid': False, 'error': str(e)}
    else:
        decrypted = not encrypted

    # Count records per table without importing
    record_counts = {}
    if decrypted:
        try:
            data_block   = envelope['data']
            payload_json = _decrypt(data_block, password) if encrypted \
                           else base64.b64decode(data_block['plaintext']).decode()
            payload      = json.loads(payload_json)
            record_counts = {t: len(r) for t, r in payload.items() if r}
        except Exception:
            pass

    return {
        'valid':        True,
        'encrypted':    encrypted,
        'decrypted':    decrypted,
        'scope':        envelope.get('scope', 'unknown'),
        'backup_date':  envelope.get('created_at', 'unknown'),
        'app_version':  envelope.get('app_version', 'unknown'),
        'tables':       envelope.get('tables', []),
        'record_counts': record_counts,
        'total_records': sum(record_counts.values()),
    }
