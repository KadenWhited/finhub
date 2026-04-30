"""
backend/services/recurring.py
Detects recurring payments in checkbook and credit transactions.

Algorithm:
1. Group transactions by category + description similarity
2. Within each group, look for payments that occur within 25-35 days of each other
3. If a payment appears 2+ times with consistent interval and amount (±15%), flag as recurring
4. Assign a recurring_group label (e.g. "Netflix · $15.49 · monthly")
"""
import re
from datetime import datetime, timedelta
from collections import defaultdict


# ─────────────────────────────────────────
#  TEXT SIMILARITY
# ─────────────────────────────────────────

def _normalize(text: str) -> str:
    """Lowercase, remove special chars, collapse whitespace."""
    if not text:
        return ''
    t = text.lower().strip()
    t = re.sub(r'[^a-z0-9 ]', ' ', t)
    t = re.sub(r'\s+', ' ', t)
    return t


def _similarity(a: str, b: str) -> float:
    """Jaccard similarity between word sets."""
    wa = set(_normalize(a).split())
    wb = set(_normalize(b).split())
    if not wa or not wb:
        return 0.0
    return len(wa & wb) / len(wa | wb)


def _amount_similar(a: float, b: float, tolerance: float = 0.15) -> bool:
    """True if amounts are within ±tolerance of each other."""
    if a == 0 and b == 0:
        return True
    if a == 0 or b == 0:
        return False
    return abs(a - b) / max(a, b) <= tolerance


def _day_diff(d1: str, d2: str) -> int:
    """Days between two ISO date strings."""
    try:
        dt1 = datetime.fromisoformat(d1[:10])
        dt2 = datetime.fromisoformat(d2[:10])
        return abs((dt2 - dt1).days)
    except Exception:
        return 9999


# ─────────────────────────────────────────
#  KNOWN RECURRING KEYWORDS
# Boost confidence for well-known subscription services
# ─────────────────────────────────────────

SUBSCRIPTION_KEYWORDS = {
    # Streaming
    'netflix', 'spotify', 'hulu', 'disney', 'disney+', 'apple tv', 'hbo', 'paramount',
    'peacock', 'crunchyroll', 'youtube premium', 'amazon prime', 'prime video',
    # Software / cloud
    'adobe', 'microsoft', 'office 365', 'google', 'icloud', 'dropbox', 'notion',
    'github', 'chatgpt', 'openai', 'figma', 'slack', 'zoom', 'canva',
    # Finance / investing
    'robinhood', 'coinbase', 'webull', 'tradingview', 'seeking alpha',
    # Utilities / telecom
    'at&t', 'verizon', 't-mobile', 'comcast', 'xfinity', 'spectrum',
    'electric', 'gas company', 'water', 'internet', 'phone bill',
    # Health / fitness
    'gym', 'planet fitness', 'anytime fitness', 'peloton', 'headspace', 'calm',
    # Insurance
    'insurance', 'geico', 'state farm', 'allstate', 'progressive',
    # Other
    'patreon', 'substack', 'onlyfans', 'twitch',
}


def _is_known_subscription(text: str) -> bool:
    lower = (text or '').lower()
    return any(kw in lower for kw in SUBSCRIPTION_KEYWORDS)


# ─────────────────────────────────────────
#  CORE DETECTION
# ─────────────────────────────────────────

def detect_recurring(transactions: list, interval_days_min=25, interval_days_max=40) -> list:
    """
    Analyze a list of transactions and return detected recurring groups.

    transactions: list of dicts with keys:
        id, type, amount, category, description, date, source (table name)

    Returns list of recurring group dicts:
        {
          group_id: str,
          label: str,
          ids: [int],           # transaction IDs in this group
          amount: float,        # representative amount
          interval_days: int,   # estimated interval
          frequency: str,       # 'monthly', 'weekly', 'quarterly', 'annual'
          is_subscription: bool,
          confidence: float,    # 0-1
          category: str,
          next_expected: str,   # ISO date of next expected payment
        }
    """
    if not transactions:
        return []

    # Sort by date
    txns = sorted(transactions, key=lambda x: x.get('date', ''))

    # Group by (category, description_cluster)
    # Use a greedy clustering approach
    clusters = []  # list of lists of txns

    for txn in txns:
        matched = False
        for cluster in clusters:
            rep = cluster[0]
            # Same category AND description similar
            if (rep.get('category') == txn.get('category') and
                    _similarity(rep.get('description', ''), txn.get('description', '')) >= 0.5):
                cluster.append(txn)
                matched = True
                break
        if not matched:
            clusters.append([txn])

    recurring_groups = []

    for cluster in clusters:
        if len(cluster) < 2:
            continue

        # Check intervals between consecutive transactions
        intervals = []
        for i in range(1, len(cluster)):
            diff = _day_diff(cluster[i-1]['date'], cluster[i]['date'])
            intervals.append(diff)

        # Filter intervals within our target window
        valid_intervals = [d for d in intervals if interval_days_min <= d <= interval_days_max]

        # Also check weekly (5-9 days) and quarterly (80-100 days) and annual (350-380)
        weekly_intervals     = [d for d in intervals if 5 <= d <= 9]
        quarterly_intervals  = [d for d in intervals if 80 <= d <= 100]
        annual_intervals     = [d for d in intervals if 350 <= d <= 380]

        best_intervals  = None
        frequency       = None
        min_occurrences = 2

        if len(valid_intervals) >= min_occurrences - 1:
            best_intervals = valid_intervals
            frequency = 'monthly'
        elif len(weekly_intervals) >= min_occurrences - 1:
            best_intervals = weekly_intervals
            frequency = 'weekly'
        elif len(quarterly_intervals) >= min_occurrences - 1:
            best_intervals = quarterly_intervals
            frequency = 'quarterly'
        elif len(annual_intervals) >= min_occurrences - 1:
            best_intervals = annual_intervals
            frequency = 'annual'

        if not best_intervals:
            continue

        # Check amount consistency
        amounts = [t['amount'] for t in cluster]
        base_amount = amounts[0]
        consistent_amounts = sum(1 for a in amounts if _amount_similar(a, base_amount))
        amount_consistency = consistent_amounts / len(amounts)

        if amount_consistency < 0.6:
            continue

        # Representative amount (median)
        sorted_amounts = sorted(amounts)
        rep_amount = sorted_amounts[len(sorted_amounts) // 2]

        # Confidence score
        desc = cluster[0].get('description', '')
        cat  = cluster[0].get('category', '')
        is_sub = _is_known_subscription(desc) or _is_known_subscription(cat)
        confidence = min(1.0,
            0.4 * min(1.0, len(cluster) / 4) +      # more occurrences = higher confidence
            0.3 * amount_consistency +                # consistent amounts
            0.2 * (0.8 if frequency == 'monthly' else 0.5) +  # monthly is most common
            0.1 * (1.0 if is_sub else 0.3)           # known subscription keyword
        )

        if confidence < 0.4:
            continue

        # Estimate next payment date
        avg_interval = int(sum(best_intervals) / len(best_intervals))
        last_date    = cluster[-1].get('date', '')
        try:
            next_dt = datetime.fromisoformat(last_date[:10]) + timedelta(days=avg_interval)
            next_expected = next_dt.strftime('%Y-%m-%d')
        except Exception:
            next_expected = None

        # Build label
        clean_desc = desc.strip() or cat
        label = f"{clean_desc} · ${rep_amount:.2f} · {frequency}"

        group_id = re.sub(r'[^a-z0-9]', '_', _normalize(clean_desc + str(rep_amount)))[:40]

        recurring_groups.append({
            'group_id':       group_id,
            'label':          label,
            'description':    clean_desc,
            'ids':            [t['id'] for t in cluster],
            'amount':         round(rep_amount, 2),
            'interval_days':  avg_interval,
            'frequency':      frequency,
            'is_subscription':is_sub,
            'confidence':     round(confidence, 2),
            'category':       cat,
            'occurrences':    len(cluster),
            'first_seen':     cluster[0].get('date', ''),
            'last_seen':      cluster[-1].get('date', ''),
            'next_expected':  next_expected,
            'source':         cluster[0].get('source_table', 'checkbook'),
        })

    # Sort by confidence desc, then amount desc
    recurring_groups.sort(key=lambda x: (-x['confidence'], -x['amount']))
    return recurring_groups


# ─────────────────────────────────────────
#  MONTHLY STATS HELPER
# ─────────────────────────────────────────

def build_monthly_stats(checkbook_rows: list, credit_rows: list) -> list:
    """
    Build month-by-month income/expense breakdown.
    Returns list of monthly stat dicts sorted newest first.
    """
    monthly = defaultdict(lambda: {
        'income': 0.0, 'expense': 0.0,
        'credit_charges': 0.0, 'categories': defaultdict(float),
        'transactions': 0
    })

    for row in checkbook_rows:
        month = (row.get('date') or '')[:7]  # YYYY-MM
        if not month:
            continue
        if row['type'] == 'income':
            monthly[month]['income'] += row['amount']
        else:
            monthly[month]['expense'] += row['amount']
            monthly[month]['categories'][row.get('category','Other')] += row['amount']
        monthly[month]['transactions'] += 1

    for row in credit_rows:
        month = (row.get('date') or '')[:7]
        if not month:
            continue
        if row.get('type') == 'charge':
            monthly[month]['credit_charges'] += row['amount']
            monthly[month]['expense'] += row['amount']
            cat = row.get('category','Other') + ' (Credit)'
            monthly[month]['categories'][cat] += row['amount']
        monthly[month]['transactions'] += 1

    result = []
    for month, data in sorted(monthly.items(), reverse=True):
        net    = data['income'] - data['expense']
        result.append({
            'month':          month,
            'label':          _month_label(month),
            'income':         round(data['income'], 2),
            'expense':        round(data['expense'], 2),
            'credit_charges': round(data['credit_charges'], 2),
            'net':            round(net, 2),
            'savings_rate':   round((net / data['income'] * 100), 1) if data['income'] else 0,
            'categories':     {k: round(v, 2) for k, v in sorted(
                                  data['categories'].items(), key=lambda x: -x[1])},
            'transaction_count': data['transactions'],
        })

    return result


def _month_label(month_str: str) -> str:
    """'2026-04' -> 'Apr 2026'"""
    try:
        dt = datetime.strptime(month_str, '%Y-%m')
        return dt.strftime('%b %Y')
    except Exception:
        return month_str
