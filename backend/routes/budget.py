"""
backend/routes/budget.py
Budget analysis: monthly stats, recurring detection, subscription summary.
"""
from flask import Blueprint, request, jsonify
from backend.models.database import get_db
from backend.services.recurring import detect_recurring, build_monthly_stats

budget_bp = Blueprint('budget', __name__)


# ─────────────────────────────────────────
#  MONTHLY STATS
# ─────────────────────────────────────────

@budget_bp.route('/monthly', methods=['GET'])
def get_monthly():
    """Monthly income/expense breakdown for all time or a specific year."""
    year = request.args.get('year')  # optional filter e.g. '2026'

    db = get_db()
    cb_query = 'SELECT * FROM checkbook ORDER BY date ASC'
    cr_query = '''
        SELECT ct.*, ca.name as account_name
        FROM credit_transactions ct
        JOIN credit_accounts ca ON ct.account_id = ca.id
        ORDER BY ct.date ASC
    '''
    cb_rows = [dict(r) for r in db.execute(cb_query).fetchall()]
    cr_rows = [dict(r) for r in db.execute(cr_query).fetchall()]
    db.close()

    if year:
        cb_rows = [r for r in cb_rows if (r.get('date') or '').startswith(year)]
        cr_rows = [r for r in cr_rows if (r.get('date') or '').startswith(year)]

    monthly = build_monthly_stats(cb_rows, cr_rows)
    return jsonify(monthly)


@budget_bp.route('/monthly/<month>', methods=['GET'])
def get_month_detail(month):
    """
    Detail for a specific month (YYYY-MM).
    Returns all transactions for that month.
    """
    db = get_db()
    cb = [dict(r) for r in db.execute(
        "SELECT * FROM checkbook WHERE date LIKE ? ORDER BY date ASC",
        (f'{month}%',)
    ).fetchall()]
    cr = [dict(r) for r in db.execute(
        """SELECT ct.*, ca.name as account_name
           FROM credit_transactions ct
           JOIN credit_accounts ca ON ct.account_id = ca.id
           WHERE ct.date LIKE ? ORDER BY ct.date ASC""",
        (f'{month}%',)
    ).fetchall()]
    db.close()

    # Combine and sort
    all_txns = []
    for r in cb:
        all_txns.append({**r, 'source_table': 'checkbook',
                         'signed_amount': r['amount'] if r['type']=='income' else -r['amount']})
    for r in cr:
        all_txns.append({**r, 'source_table': 'credit',
                         'type': r.get('type','charge'),
                         'signed_amount': -r['amount'] if r.get('type')=='charge' else r['amount']})

    all_txns.sort(key=lambda x: x.get('date',''))

    return jsonify({'month': month, 'transactions': all_txns})


# ─────────────────────────────────────────
#  RECURRING DETECTION
# ─────────────────────────────────────────

@budget_bp.route('/recurring', methods=['GET'])
def get_recurring():
    """Detect and return all recurring payments."""
    db = get_db()

    cb_rows = [dict(r) for r in db.execute(
        "SELECT id, type, amount, category, description, date FROM checkbook WHERE type='expense' ORDER BY date ASC"
    ).fetchall()]
    for r in cb_rows:
        r['source_table'] = 'checkbook'

    cr_rows = [dict(r) for r in db.execute(
        "SELECT id, type, amount, category, description, date FROM credit_transactions WHERE type='charge' ORDER BY date ASC"
    ).fetchall()]
    for r in cr_rows:
        r['source_table'] = 'credit'

    # Load confirmed/dismissed overrides from settings
    settings_rows = db.execute('SELECT * FROM settings WHERE key LIKE "recurring_%"').fetchall()
    overrides = {r['key']: r['value'] for r in settings_rows}

    db.close()

    all_txns = cb_rows + cr_rows
    groups   = detect_recurring(all_txns)

    # Apply overrides
    for g in groups:
        key = f"recurring_{g['group_id']}"
        if key in overrides:
            g['user_status'] = overrides[key]  # 'confirmed' | 'dismissed'
        else:
            g['user_status'] = 'detected'

    # Filter out dismissed unless ?include_dismissed=1
    if request.args.get('include_dismissed') != '1':
        groups = [g for g in groups if g.get('user_status') != 'dismissed']

    # Subscription summary
    subscriptions   = [g for g in groups if g.get('is_subscription')]
    sub_monthly_est = sum(
        g['amount'] if g['frequency'] == 'monthly'
        else g['amount'] / 3  if g['frequency'] == 'quarterly'
        else g['amount'] / 12 if g['frequency'] == 'annual'
        else g['amount'] * 4.33 if g['frequency'] == 'weekly'
        else g['amount']
        for g in subscriptions
    )

    non_sub_monthly_est = sum(
        g['amount'] if g['frequency'] == 'monthly'
        else g['amount'] / 3  if g['frequency'] == 'quarterly'
        else g['amount'] / 12 if g['frequency'] == 'annual'
        else g['amount']
        for g in groups if not g.get('is_subscription')
    )

    return jsonify({
        'groups':             groups,
        'total_recurring':    len(groups),
        'total_subscriptions':len(subscriptions),
        'subscription_monthly_est': round(sub_monthly_est, 2),
        'recurring_monthly_est':    round(sub_monthly_est + non_sub_monthly_est, 2),
    })


@budget_bp.route('/recurring/<group_id>/confirm', methods=['POST'])
def confirm_recurring(group_id):
    db = get_db()
    db.execute(
        'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)',
        (f'recurring_{group_id}', 'confirmed')
    )
    db.commit()
    db.close()
    return jsonify({'ok': True, 'status': 'confirmed'})


@budget_bp.route('/recurring/<group_id>/dismiss', methods=['POST'])
def dismiss_recurring(group_id):
    db = get_db()
    db.execute(
        'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)',
        (f'recurring_{group_id}', 'dismissed')
    )
    db.commit()
    db.close()
    return jsonify({'ok': True, 'status': 'dismissed'})


# ─────────────────────────────────────────
#  BUDGET SUMMARY  (current month snapshot)
# ─────────────────────────────────────────

@budget_bp.route('/summary', methods=['GET'])
def get_summary():
    """Current month snapshot + monthly averages."""
    from datetime import datetime
    current_month = datetime.utcnow().strftime('%Y-%m')

    db = get_db()
    cb_rows = [dict(r) for r in db.execute('SELECT * FROM checkbook ORDER BY date ASC').fetchall()]
    cr_rows = [dict(r) for r in db.execute(
        "SELECT ct.* FROM credit_transactions ct WHERE ct.type='charge' ORDER BY date ASC"
    ).fetchall()]
    db.close()

    all_monthly = build_monthly_stats(cb_rows, cr_rows)

    # Find current month
    current = next((m for m in all_monthly if m['month'] == current_month), None)
    if not current:
        from datetime import datetime as dt
        current = {
            'month': current_month,
            'label': dt.strptime(current_month, '%Y-%m').strftime('%b %Y'),
            'income': 0, 'expense': 0, 'net': 0,
            'credit_charges': 0, 'savings_rate': 0,
            'categories': {}, 'transaction_count': 0
        }

    # Monthly averages (last 3 months excluding current)
    past = [m for m in all_monthly if m['month'] < current_month][:3]
    avg_income  = sum(m['income']  for m in past) / len(past) if past else 0
    avg_expense = sum(m['expense'] for m in past) / len(past) if past else 0

    return jsonify({
        'current_month':   current,
        'avg_income_3m':   round(avg_income,  2),
        'avg_expense_3m':  round(avg_expense, 2),
        'month_count':     len(all_monthly),
        'all_months':      all_monthly,
    })
