"""
backend/services/ingestion/email_parser.py
Gmail IMAP email parsing for bank and credit card transaction emails.

Auth: Gmail App Password (NOT your main Gmail password)
  - GMAIL_ADDRESS      — your Gmail address
  - GMAIL_APP_PASSWORD — 16-char app password from myaccount.google.com/apppasswords

Reads financial transaction emails, parses amount/merchant/date,
and imports to checkbook or credit_transactions table.
Bank email is treated as ground truth — highest priority source.
"""
import os
import re
import imaplib
import email
import email.header
import hashlib
from datetime import datetime, timezone, timedelta
from email.utils import parsedate_to_datetime

from backend.services.ingestion.bank_patterns import (
    match_pattern, extract_amount, extract_description,
    classify_income_stream, BANK_PATTERNS
)

GMAIL_IMAP = 'imap.gmail.com'
GMAIL_PORT = 993


# ─────────────────────────────────────────
#  CONNECTION
# ─────────────────────────────────────────

def _connect() -> imaplib.IMAP4_SSL:
    """Connect and authenticate to Gmail IMAP."""
    address  = os.environ.get('GMAIL_ADDRESS', '')
    password = os.environ.get('GMAIL_APP_PASSWORD', '')

    if not address or not password:
        raise ValueError(
            "GMAIL_ADDRESS and GMAIL_APP_PASSWORD must be set in .env\n"
            "Generate an App Password at: myaccount.google.com/apppasswords"
        )

    mail = imaplib.IMAP4_SSL(GMAIL_IMAP, GMAIL_PORT)
    mail.login(address, password)
    return mail


def test_connection() -> dict:
    """Verify Gmail credentials work."""
    try:
        mail = _connect()
        mail.select('INBOX')
        mail.logout()
        return {'ok': True, 'message': 'Gmail connected successfully'}
    except ValueError as e:
        return {'ok': False, 'error': str(e)}
    except imaplib.IMAP4.error as e:
        return {'ok': False, 'error': f'IMAP auth failed: {str(e)[:200]}'}
    except Exception as e:
        return {'ok': False, 'error': str(e)[:200]}


# ─────────────────────────────────────────
#  EMAIL FETCHING
# ─────────────────────────────────────────

def _decode_header(value: str) -> str:
    """Decode MIME encoded header."""
    if not value:
        return ''
    decoded_parts = email.header.decode_header(value)
    result = []
    for part, charset in decoded_parts:
        if isinstance(part, bytes):
            try:
                result.append(part.decode(charset or 'utf-8', errors='replace'))
            except Exception:
                result.append(part.decode('utf-8', errors='replace'))
        else:
            result.append(str(part))
    return ' '.join(result)


def _get_email_body(msg) -> str:
    """Extract plain text body from email message."""
    body = ''
    if msg.is_multipart():
        for part in msg.walk():
            content_type = part.get_content_type()
            disposition  = str(part.get('Content-Disposition', ''))
            if 'attachment' in disposition:
                continue
            if content_type == 'text/plain':
                try:
                    charset = part.get_content_charset() or 'utf-8'
                    body   += part.get_payload(decode=True).decode(charset, errors='replace')
                except Exception:
                    pass
            elif content_type == 'text/html' and not body:
                try:
                    charset  = part.get_content_charset() or 'utf-8'
                    html     = part.get_payload(decode=True).decode(charset, errors='replace')
                    # Strip HTML tags for basic text extraction
                    body    += re.sub(r'<[^>]+>', ' ', html)
                    body     = re.sub(r'\s+', ' ', body)
                except Exception:
                    pass
    else:
        try:
            charset = msg.get_content_charset() or 'utf-8'
            body    = msg.get_payload(decode=True).decode(charset, errors='replace')
            if msg.get_content_type() == 'text/html':
                body = re.sub(r'<[^>]+>', ' ', body)
                body = re.sub(r'\s+', ' ', body)
        except Exception:
            pass
    return body[:5000]  # Cap at 5k chars


def fetch_emails(lookback_days: int = 30) -> list[dict]:
    """
    Fetch financial transaction emails from Gmail.
    Returns list of parsed email dicts.
    """
    mail     = _connect()
    cutoff   = (datetime.now() - timedelta(days=lookback_days)).strftime('%d-%b-%Y')
    all_msgs: list[dict] = []
    seen_ids: set        = set()

    try:
        mail.select('INBOX')

        financial_domains = [
            'chase.com', 'bankofamerica.com', 'wellsfargo.com',
            'americanexpress.com', 'capitalone.com', 'citi.com',
            'discover.com', 'paypal.com', 'venmo.com', 'coinbase.com',
            'aexp.com', 'bofa.com', 'kraken.com'
        ]

        for domain in financial_domains:
            try:
                _, msg_ids = mail.search(
                    None, f'(FROM "@{domain}" SINCE "{cutoff}")'
                )
                _fetch_ids(mail, msg_ids[0].split(), seen_ids, all_msgs)
            except Exception:
                continue

        financial_subjects = [
            'you bought', 'you sold', 'transaction alert', 'direct deposit',
            'charge to your', 'payment received', 'you made a purchase',
            'debit card', 'large purchase', 'account alert',
        ]

        for keyword in financial_subjects:
            try:
                _, msg_ids = mail.search(
                    None, f'(SUBJECT "{keyword}" SINCE "{cutoff}")'
                )
                _fetch_ids(mail, msg_ids[0].split(), seen_ids, all_msgs)
            except Exception:
                continue

    finally:
        try:
            mail.logout()
        except Exception:
            pass

    return all_msgs


def _fetch_ids(mail, ids: list, seen_ids: set, all_msgs: list) -> None:
    """Fetch and append emails for a list of IMAP message IDs."""
    for msg_id in ids:
        if msg_id in seen_ids:
            continue
        seen_ids.add(msg_id)

        try:
            _, msg_data = mail.fetch(msg_id, '(RFC822)')
            if not msg_data:
                continue

            item = msg_data[0]
            if not isinstance(item, tuple):
                continue
            raw = item[1]
            if not isinstance(raw, bytes):
                continue

            parsed  = email.message_from_bytes(raw)
            sender  = _decode_header(parsed.get('From', ''))
            subject = _decode_header(parsed.get('Subject', ''))
            body    = _get_email_body(parsed)

            date_str = parsed.get('Date', '')
            try:
                dt   = parsedate_to_datetime(date_str)
                date = dt.strftime('%Y-%m-%d')
            except Exception:
                date = datetime.now().strftime('%Y-%m-%d')

            msg_id_str = msg_id.decode() if isinstance(msg_id, bytes) else str(msg_id)
            all_msgs.append({
                'id':      msg_id_str,
                'sender':  sender,
                'subject': subject,
                'body':    body,
                'date':    date,
            })
        except Exception:
            continue


# ─────────────────────────────────────────
#  PARSING
# ─────────────────────────────────────────

def parse_transaction(email_dict: dict) -> dict | None:
    """
    Parse a single email into a transaction dict.
    Returns None if email doesn't match any financial pattern.
    """
    sender  = email_dict.get('sender',  '')
    subject = email_dict.get('subject', '')
    body    = email_dict.get('body',    '')
    date    = email_dict.get('date',    datetime.now().strftime('%Y-%m-%d'))

    effective_sender = sender

    fwd_patterns = [
        r'From:\s+[^\n<]*<?([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})>?',
        r'Sender:\s+<?([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})>?',
        r'Reply-To:\s+<?([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})>?',
    ]

    original_sender = None  # None, not 'not found'
    for fwd_pat in fwd_patterns:
        m = re.search(fwd_pat, body, re.IGNORECASE | re.MULTILINE)
        if m:
            candidate = m.group(1).strip()
            if 'gmail.com' not in candidate:
                original_sender = candidate
                break

    if original_sender and 'gmail.com' in sender.lower():
        effective_sender = original_sender
    elif 'gmail.com' in sender.lower() and not original_sender:
        effective_sender = ''

    # Also check subject — strip "Fwd: " prefix
    clean_subject = re.sub(r'^(fwd?:\s*)+', '', subject, flags=re.IGNORECASE).strip()

    pattern = match_pattern(effective_sender, clean_subject)
    if not pattern:
        return None
    
    if not original_sender and 'gmail.com' in sender.lower():
        body_subject_match = re.search(
            r'^Subject:\s+(.+)$', body, re.IGNORECASE | re.MULTILINE
        )
        if body_subject_match:
            body_subject = body_subject_match.group(1).strip()
            # Try matching with just the body subject, no sender filtering
            for pattern in BANK_PATTERNS:
                if not pattern.subjects:
                    continue
                subject_ok = any(
                    re.search(pat, body_subject, re.IGNORECASE)
                    for pat in pattern.subjects
                )
                if subject_ok:
                    # Use body subject for parsing instead
                    clean_subject = body_subject
                    effective_sender = ''  # Force subject-only match
                    break

    full_text = f"{subject}\n{body}"

    amount = extract_amount(full_text, pattern.amount_re)
    if not amount or amount <= 0:
        return None

    description = extract_description(full_text, pattern.merchant_re)
    if not description:
        description = pattern.name

    # Determine income stream for income transactions
    income_stream = pattern.income_stream
    if pattern.tx_type == 'income' and not income_stream:
        income_stream = classify_income_stream(description, subject)

    # Generate stable external_id from email content
    # Using sender + date + amount to dedup across re-parses
    raw_id     = f"{sender}|{date}|{amount}|{description[:20]}"
    external_id = 'email_' + hashlib.sha256(raw_id.encode()).hexdigest()[:16]

    return {
        'external_id':    external_id,
        'type':           pattern.tx_type,
        'amount':         amount,
        'category':       _map_category(description, pattern.category),
        'description':    description,
        'date':           date,
        'source':         'email_parser',
        'income_stream':  income_stream,
        'institution':    pattern.name,
        'raw_subject':    subject[:100],
    }


def _map_category(description: str, default: str) -> str:
    """Map description to a spending category."""
    desc = description.lower()
    if any(w in desc for w in ['amazon', 'walmart', 'target', 'costco', 'grocery', 'whole foods',
                                'trader joe', 'kroger', 'safeway', 'aldi']):
        return 'Shopping'
    if any(w in desc for w in ['uber', 'lyft', 'doordash', 'grubhub', 'instacart', 'delivery']):
        return 'Food & Delivery'
    if any(w in desc for w in ['netflix', 'spotify', 'hulu', 'disney', 'apple', 'google play',
                                'youtube', 'twitch', 'xbox', 'playstation', 'steam']):
        return 'Subscriptions'
    if any(w in desc for w in ['shell', 'exxon', 'bp', 'chevron', 'gas', 'fuel', 'sunoco']):
        return 'Gas'
    if any(w in desc for w in ['restaurant', 'cafe', 'coffee', 'starbucks', 'mcdonald',
                                'chipotle', 'subway', 'pizza', 'sushi', 'bar', 'grill']):
        return 'Dining'
    if any(w in desc for w in ['uber', 'lyft', 'transit', 'metro', 'parking', 'toll']):
        return 'Transportation'
    if any(w in desc for w in ['cvs', 'walgreen', 'pharmacy', 'hospital', 'doctor',
                                'medical', 'dental', 'vision']):
        return 'Healthcare'
    if any(w in desc for w in ['electric', 'gas', 'water', 'internet', 'at&t', 'verizon',
                                't-mobile', 'comcast', 'xfinity', 'spectrum']):
        return 'Utilities'
    if any(w in desc for w in ['rent', 'mortgage', 'hoa', 'lease']):
        return 'Housing'
    return default


# ─────────────────────────────────────────
#  CREDIT CARD ACCOUNT MATCHING
# ─────────────────────────────────────────

def _find_credit_account(db, institution: str) -> dict | None:
    """Try to match email institution to a credit account in the DB."""
    institution_lower = institution.lower()
    accounts = db.execute('SELECT * FROM credit_accounts').fetchall()
    for acc in accounts:
        name = (acc['name'] or '').lower()
        # Match by known institution keywords
        if 'amex' in institution_lower or 'american express' in institution_lower:
            if 'amex' in name or 'american express' in name:
                return dict(acc)
        if 'chase' in institution_lower:
            if 'chase' in name:
                return dict(acc)
        if 'capital one' in institution_lower:
            if 'capital' in name:
                return dict(acc)
        if 'citi' in institution_lower:
            if 'citi' in name:
                return dict(acc)
        if 'discover' in institution_lower:
            if 'discover' in name:
                return dict(acc)
    return None


# ─────────────────────────────────────────
#  MAIN SYNC
# ─────────────────────────────────────────

def sync_emails():
    """
    Called by scheduler every 15 minutes.
    Fetches recent financial emails and imports transactions.
    """
    from backend.models.database import get_db
    from backend.services.ingestion.deduplicator import (
        upsert_checkbook, upsert_credit_transaction, log_ingestion
    )

    db       = get_db()
    imported = 0
    skipped  = 0
    errors   = 0

    try:
        emails = fetch_emails(lookback_days=30)
        print(f"[email] Fetched {len(emails)} financial emails")

        for email_dict in emails:
            tx = parse_transaction(email_dict)
            if not tx:
                skipped += 1
                continue

            # Decide: checkbook or credit transaction?
            # Credit card charges go to credit_transactions if we can match an account
            # Everything else goes to checkbook
            institution   = tx.get('institution', '')
            is_credit     = any(w in institution.lower()
                                for w in ['amex', 'american express', 'credit',
                                          'capital one', 'discover', 'citi'])

            credit_account = None
            if is_credit and tx['type'] == 'expense':
                credit_account = _find_credit_account(db, institution)

            if credit_account:
                # Import as credit transaction
                status, row_id = upsert_credit_transaction(db, {
                    'account_id':  credit_account['id'],
                    'type':        'charge',
                    'amount':      tx['amount'],
                    'category':    tx['category'],
                    'description': tx['description'],
                    'date':        tx['date'],
                    'source':      'email_parser',
                    'external_id': tx['external_id'],
                })
                log_ingestion(db, 'gmail', status, 'credit_transaction',
                              external_id=tx['external_id'],
                              message=f"{tx['description']} ${tx['amount']:.2f}")
            else:
                # Import as checkbook entry
                # Add income_stream to description for income categorization
                description = tx['description']
                if tx.get('income_stream') and tx['type'] == 'income':
                    description = f"[{tx['income_stream']}] {description}"

                status, row_id = upsert_checkbook(db, {
                    'type':        tx['type'],
                    'amount':      tx['amount'],
                    'category':    tx['category'],
                    'description': description,
                    'date':        tx['date'],
                    'source':      'email_parser',
                    'external_id': tx['external_id'],
                })
                log_ingestion(db, 'gmail', status, 'checkbook',
                              external_id=tx['external_id'],
                              message=f"{tx['type']} ${tx['amount']:.2f} — {tx['description']}")

            if status == 'inserted':
                imported += 1
            else:
                skipped += 1

        # Update connection record
        db.execute('''
            INSERT INTO connections
                (service, last_sync_at, last_sync_status, records_imported, updated_at)
            VALUES ('gmail', datetime('now'), 'success', ?, datetime('now'))
            ON CONFLICT(service) DO UPDATE SET
                last_sync_at     = datetime('now'),
                last_sync_status = 'success',
                records_imported = records_imported + ?,
                error_message    = NULL,
                updated_at       = datetime('now')
        ''', (imported, imported))
        db.commit()

        print(f"[email] Imported {imported} transactions, skipped {skipped}")

    except Exception as e:
        error_msg = str(e)[:500]
        db.execute('''
            INSERT INTO connections
                (service, last_sync_at, last_sync_status, error_message, updated_at)
            VALUES ('gmail', datetime('now'), 'error', ?, datetime('now'))
            ON CONFLICT(service) DO UPDATE SET
                last_sync_at     = datetime('now'),
                last_sync_status = 'error',
                error_message    = ?,
                updated_at       = datetime('now')
        ''', (error_msg, error_msg))
        db.commit()
        print(f"[email] Sync error: {error_msg}")
        raise

    finally:
        db.close()

    return {'imported': imported, 'skipped': skipped, 'errors': errors}
