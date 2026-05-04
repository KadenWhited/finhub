"""
backend/services/ingestion/bank_patterns.py
Regex patterns and sender domains for major US bank/credit transaction emails.

Each pattern entry:
  senders:   list of from-address substrings to match
  subjects:  list of subject line patterns (regex)
  parsers:   list of body regex patterns to extract transaction data
  tx_type:   'expense' | 'income' | 'payment' | 'transfer'
  source:    institution identifier
"""
import re
from dataclasses import dataclass, field


@dataclass
class BankPattern:
    name:        str
    senders:     list[str]      # Match if sender contains any of these
    subjects:    list[str]      # Regex patterns for subject line
    amount_re:   list[str]      # Regex to extract dollar amount
    merchant_re: list[str]      # Regex to extract merchant/description
    date_re:     list[str]      # Regex to extract date (optional)
    tx_type:     str            # 'expense', 'income', 'payment', 'credit'
    category:    str            # Default category
    income_stream: str | None   # e.g. 'direct_deposit', 'interest', None


BANK_PATTERNS: list[BankPattern] = [

    # ─────────────────────────────────────────────────────────────────────────
    #  CHASE
    # ─────────────────────────────────────────────────────────────────────────
    BankPattern(
        name='Chase Transaction',
        senders=['no.reply.alerts@chase.com', 'chase.com'],
        subjects=[
            r'transaction.*alert',
            r'charge.*to your.*chase',
            r'you made a.*purchase',
            r'debit card purchase',
        ],
        amount_re=[
            r'\$([0-9,]+\.[0-9]{2})',
            r'amount[:\s]+\$([0-9,]+\.[0-9]{2})',
            r'charged[:\s]+\$([0-9,]+\.[0-9]{2})',
        ],
        merchant_re=[
            r'at\s+([A-Z][^\n\r$]{2,50}?)(?:\s+on|\s+for|\n)',
            r'merchant[:\s]+([^\n\r]{2,60})',
            r'purchase\s+at\s+([^\n\r$]{2,50})',
        ],
        date_re=[
            r'on\s+(\w+\s+\d{1,2},?\s+\d{4})',
            r'date[:\s]+(\w+\s+\d{1,2},?\s+\d{4})',
        ],
        tx_type='expense',
        category='Banking',
        income_stream=None,
    ),

    BankPattern(
        name='Chase Direct Deposit',
        senders=['no.reply.alerts@chase.com', 'chase.com'],
        subjects=[
            r'direct deposit',
            r'deposit.*posted',
            r'payment received',
        ],
        amount_re=[r'\$([0-9,]+\.[0-9]{2})'],
        merchant_re=[
            r'from\s+([^\n\r$]{2,60})',
            r'deposited by\s+([^\n\r$]{2,60})',
        ],
        date_re=[r'on\s+(\w+\s+\d{1,2},?\s+\d{4})'],
        tx_type='income',
        category='Income',
        income_stream='direct_deposit',
    ),

    # ─────────────────────────────────────────────────────────────────────────
    #  BANK OF AMERICA
    # ─────────────────────────────────────────────────────────────────────────
    BankPattern(
        name='Bank of America Transaction',
        senders=['bankofamerica.com', 'bofa.com'],
        subjects=[
            r'transaction alert',
            r'debit card transaction',
            r'purchase.*posted',
            r'new transaction',
        ],
        amount_re=[
            r'\$([0-9,]+\.[0-9]{2})',
            r'amount[:\s]+\$([0-9,]+\.[0-9]{2})',
        ],
        merchant_re=[
            r'at\s+([A-Z][^\n\r$]{2,50}?)(?:\s+on|\n)',
            r'merchant[:\s]+([^\n\r]{2,60})',
        ],
        date_re=[r'(\w+\s+\d{1,2},?\s+\d{4})'],
        tx_type='expense',
        category='Banking',
        income_stream=None,
    ),

    BankPattern(
        name='Bank of America Deposit',
        senders=['bankofamerica.com', 'bofa.com'],
        subjects=[
            r'direct deposit',
            r'deposit posted',
            r'funds available',
        ],
        amount_re=[r'\$([0-9,]+\.[0-9]{2})'],
        merchant_re=[r'from\s+([^\n\r$]{2,60})'],
        date_re=[r'(\w+\s+\d{1,2},?\s+\d{4})'],
        tx_type='income',
        category='Income',
        income_stream='direct_deposit',
    ),

    # ─────────────────────────────────────────────────────────────────────────
    #  WELLS FARGO
    # ─────────────────────────────────────────────────────────────────────────
    BankPattern(
        name='Wells Fargo Transaction',
        senders=['wellsfargo.com', 'alerts.wellsfargo.com'],
        subjects=[
            r'transaction alert',
            r'debit card.*purchase',
            r'card transaction',
        ],
        amount_re=[r'\$([0-9,]+\.[0-9]{2})'],
        merchant_re=[
            r'at\s+([A-Z][^\n\r$]{2,50}?)(?:\s+on|\n)',
            r'merchant[:\s]+([^\n\r]{2,60})',
        ],
        date_re=[r'(\w+\s+\d{1,2},?\s+\d{4})'],
        tx_type='expense',
        category='Banking',
        income_stream=None,
    ),

    # ─────────────────────────────────────────────────────────────────────────
    #  AMERICAN EXPRESS
    # ─────────────────────────────────────────────────────────────────────────
    BankPattern(
        name='Amex Charge',
        senders=['americanexpress.com', 'aexp.com', 'welcome.aexp.com'],
        subjects=[
            r'large purchase',
            r'charge to your.*card',
            r'transaction alert',
            r'new charge',
        ],
        amount_re=[
            r'\$([0-9,]+\.[0-9]{2})',
            r'amount[:\s]+\$([0-9,]+\.[0-9]{2})',
        ],
        merchant_re=[
            r'at\s+([A-Z][^\n\r$]{2,50}?)(?:\s+on|\n)',
            r'merchant[:\s]+([^\n\r]{2,60})',
        ],
        date_re=[r'(\w+\s+\d{1,2},?\s+\d{4})'],
        tx_type='expense',
        category='Credit Card',
        income_stream=None,
    ),

    BankPattern(
        name='Amex Payment',
        senders=['americanexpress.com', 'aexp.com'],
        subjects=[r'payment received', r'payment posted'],
        amount_re=[r'\$([0-9,]+\.[0-9]{2})'],
        merchant_re=[],
        date_re=[r'(\w+\s+\d{1,2},?\s+\d{4})'],
        tx_type='payment',
        category='Credit Card Payment',
        income_stream=None,
    ),

    # ─────────────────────────────────────────────────────────────────────────
    #  CAPITAL ONE
    # ─────────────────────────────────────────────────────────────────────────
    BankPattern(
        name='Capital One Transaction',
        senders=['capitalone.com', 'info.capitalone.com'],
        subjects=[
            r'transaction alert',
            r'new purchase',
            r'you made a.*purchase',
        ],
        amount_re=[r'\$([0-9,]+\.[0-9]{2})'],
        merchant_re=[
            r'at\s+([A-Z][^\n\r$]{2,50}?)(?:\s+on|\n)',
            r'merchant[:\s]+([^\n\r]{2,60})',
        ],
        date_re=[r'(\w+\s+\d{1,2},?\s+\d{4})'],
        tx_type='expense',
        category='Credit Card',
        income_stream=None,
    ),

    # ─────────────────────────────────────────────────────────────────────────
    #  CITI
    # ─────────────────────────────────────────────────────────────────────────
    BankPattern(
        name='Citi Transaction',
        senders=['citi.com', 'citibank.com', 'accountonline.com'],
        subjects=[
            r'transaction alert',
            r'large purchase',
            r'new transaction',
        ],
        amount_re=[r'\$([0-9,]+\.[0-9]{2})'],
        merchant_re=[
            r'at\s+([A-Z][^\n\r$]{2,50}?)(?:\s+on|\n)',
            r'merchant[:\s]+([^\n\r]{2,60})',
        ],
        date_re=[r'(\w+\s+\d{1,2},?\s+\d{4})'],
        tx_type='expense',
        category='Credit Card',
        income_stream=None,
    ),

    # ─────────────────────────────────────────────────────────────────────────
    #  DISCOVER
    # ─────────────────────────────────────────────────────────────────────────
    BankPattern(
        name='Discover Transaction',
        senders=['discover.com', 'info.discover.com'],
        subjects=[
            r'new purchase',
            r'transaction alert',
            r'account alert',
        ],
        amount_re=[r'\$([0-9,]+\.[0-9]{2})'],
        merchant_re=[
            r'at\s+([A-Z][^\n\r$]{2,50}?)(?:\s+on|\n)',
            r'merchant[:\s]+([^\n\r]{2,60})',
        ],
        date_re=[r'(\w+\s+\d{1,2},?\s+\d{4})'],
        tx_type='expense',
        category='Credit Card',
        income_stream=None,
    ),

    # ─────────────────────────────────────────────────────────────────────────
    #  PAYPAL (income / transfers)
    # ─────────────────────────────────────────────────────────────────────────
    BankPattern(
        name='PayPal Received',
        senders=['paypal.com', 'intl.paypal.com'],
        subjects=[
            r'you.ve received',
            r'payment received',
            r'money received',
        ],
        amount_re=[r'\$([0-9,]+\.[0-9]{2})'],
        merchant_re=[r'from\s+([^\n\r$]{2,60})'],
        date_re=[r'(\w+\s+\d{1,2},?\s+\d{4})'],
        tx_type='income',
        category='Transfer',
        income_stream='transfer_in',
    ),

    BankPattern(
        name='PayPal Sent',
        senders=['paypal.com', 'intl.paypal.com'],
        subjects=[
            r'you sent',
            r'payment sent',
            r'money sent',
        ],
        amount_re=[r'\$([0-9,]+\.[0-9]{2})'],
        merchant_re=[r'to\s+([^\n\r$]{2,60})'],
        date_re=[r'(\w+\s+\d{1,2},?\s+\d{4})'],
        tx_type='expense',
        category='Transfer',
        income_stream=None,
    ),

    # ─────────────────────────────────────────────────────────────────────────
    #  VENMO
    # ─────────────────────────────────────────────────────────────────────────
    BankPattern(
        name='Venmo Received',
        senders=['venmo.com'],
        subjects=[r'paid you', r'charged you', r'you received'],
        amount_re=[r'\$([0-9,]+\.[0-9]{2})'],
        merchant_re=[r'([A-Za-z\s]+)\s+paid you'],
        date_re=[],
        tx_type='income',
        category='Transfer',
        income_stream='transfer_in',
    ),

    # ─────────────────────────────────────────────────────────────────────────
    #  COINBASE (crypto purchases / sales)
    # ─────────────────────────────────────────────────────────────────────────
    BankPattern(
        name='Coinbase Purchase',
        senders=['coinbase.com'],
        subjects=[r'you bought', r'purchase.*confirmed', r'buy.*confirmed'],
        amount_re=[r'\$([0-9,]+\.[0-9]{2})'],
        merchant_re=[r'You bought ([^\n\r$]+)'],
        date_re=[],
        tx_type='expense',
        category='Crypto',
        income_stream=None,
    ),

    BankPattern(
        name='Coinbase Sale',
        senders=['coinbase.com'],
        subjects=[r'you sold', r'sale.*confirmed', r'sell.*confirmed'],
        amount_re=[r'\$([0-9,]+\.[0-9]{2})'],
        merchant_re=[r'You sold ([^\n\r$]+)'],
        date_re=[],
        tx_type='income',
        category='Crypto',
        income_stream='trading_profit',
    ),

    BankPattern(
        name='Kraken Purchase',
        senders=['kraken.com', 'noreply@kraken.com'],
        subjects=[
            r'you bought',
            r'purchase.*confirmed',
            r'order.*filled',
            r'buy.*confirmed',
        ],
        amount_re=[
            r'\$([0-9,]+\.[0-9]{2})',
            r'Total[:\s]+\$([0-9,]+\.[0-9]{2})',
            r'spent[:\s]+\$([0-9,]+\.[0-9]{2})',
        ],
        merchant_re=[
            r'You bought ([A-Z]{2,10})',
            r'purchased ([A-Z]{2,10})',
            r'([A-Z]{2,10})\s+purchase confirmed',
        ],
        date_re=[r'(\w+\s+\d{1,2},?\s+\d{4})'],
        tx_type='expense',
        category='Crypto',
        income_stream=None,
    ),

    BankPattern(
        name='Kraken Sale',
        senders=['kraken.com', 'noreply@kraken.com'],
        subjects=[
            r'you sold',
            r'sale.*confirmed',
            r'sell.*confirmed',
            r'order.*filled',
        ],
        amount_re=[
            r'\$([0-9,]+\.[0-9]{2})',
            r'Total[:\s]+\$([0-9,]+\.[0-9]{2})',
            r'received[:\s]+\$([0-9,]+\.[0-9]{2})',
        ],
        merchant_re=[
            r'You sold ([A-Z]{2,10})',
            r'sold ([A-Z]{2,10})',
        ],
        date_re=[r'(\w+\s+\d{1,2},?\s+\d{4})'],
        tx_type='income',
        category='Crypto',
        income_stream='trading_profit',
    ),

    # ─────────────────────────────────────────────────────────────────────────
    #  GENERIC FALLBACK — catches anything with "transaction" + dollar amount
    # ─────────────────────────────────────────────────────────────────────────
    BankPattern(
        name='Generic Transaction',
        senders=[],  # Matches any sender as last resort
        subjects=[
            r'transaction',
            r'purchase',
            r'charge',
            r'payment',
        ],
        amount_re=[r'\$([0-9,]+\.[0-9]{2})'],
        merchant_re=[
            r'at\s+([A-Z][^\n\r$]{2,40})',
            r'merchant[:\s]+([^\n\r]{2,40})',
            r'from\s+([^\n\r$]{2,40})',
        ],
        date_re=[r'(\w+\s+\d{1,2},?\s+\d{4})'],
        tx_type='expense',
        category='Other',
        income_stream=None,
    ),
]


def match_pattern(sender: str, subject: str) -> BankPattern | None:
    sender_lower    = sender.lower()
    subject_lower   = subject.lower()
    sender_is_gmail = 'gmail.com' in sender_lower or sender_lower == '' or not sender

    subject_only_match = None
    generic_match      = None

    for pattern in BANK_PATTERNS:
        if not pattern.senders:
            generic_match = pattern
            continue

        sender_ok = any(s in sender_lower for s in pattern.senders)
        subject_ok = any(
            re.search(pat, subject_lower, re.IGNORECASE)
            for pat in pattern.subjects
        )

        if sender_ok and subject_ok:
            return pattern

        if sender_is_gmail and subject_ok and subject_only_match is None:
            subject_only_match = pattern


    if subject_only_match:
        return subject_only_match

    if generic_match:
        subject_ok = any(
            re.search(pat, subject_lower, re.IGNORECASE)
            for pat in generic_match.subjects
        )
        if subject_ok:
            return generic_match

    return None


def extract_amount(text: str, patterns: list[str]) -> float | None:
    """Extract dollar amount from email body."""
    for pat in patterns:
        match = re.search(pat, text, re.IGNORECASE)
        if match:
            try:
                return float(match.group(1).replace(',', ''))
            except (ValueError, IndexError):
                continue
    return None


def extract_description(text: str, patterns: list[str]) -> str:
    """Extract merchant or description from email body."""
    for pat in patterns:
        match = re.search(pat, text, re.IGNORECASE | re.MULTILINE)
        if match:
            desc = match.group(1).strip()
            # Clean up common artifacts
            desc = re.sub(r'\s+', ' ', desc)
            desc = desc.rstrip('.,;:')
            if len(desc) >= 2:
                return desc[:80]
    return ''


def classify_income_stream(description: str, subject: str) -> str:
    """Classify income by type based on description and subject keywords."""
    text = (description + ' ' + subject).lower()
    if any(w in text for w in ['payroll', 'direct deposit', 'salary', 'wages', 'employer']):
        return 'W2'
    if any(w in text for w in ['interest', 'apy', 'dividend', 'yield']):
        return 'interest'
    if any(w in text for w in ['coinbase', 'kraken', 'sold', 'trading', 'crypto']):
        return 'trading_profit'
    if any(w in text for w in ['staking', 'reward', 'earn']):
        return 'staking_reward'
    if any(w in text for w in ['refund', 'return', 'credit back']):
        return 'refund'
    if any(w in text for w in ['venmo', 'paypal', 'zelle', 'cashapp', 'transfer']):
        return 'transfer_in'
    if any(w in text for w in ['freelance', 'invoice', 'consulting', '1099']):
        return 'freelance'
    return 'other_income'
