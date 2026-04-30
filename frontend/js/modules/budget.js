// modules/budget.js
// Monthly budget tracker + recurring payment detection

let _budgetMonthly   = [];
let _budgetRecurring = [];
let _budgetView      = 'overview'; // 'overview' | 'monthly' | 'recurring'
let _selectedMonth   = null;
let _budgetChartInst = null;

// ── Entry point ───────────────────────────────────────────────────────────────

async function renderBudget() {
  const el = document.getElementById('page-budget');
  el.innerHTML = loadingHtml('Loading budget');

  try {
    const [summary, recurring] = await Promise.all([
      api.get('/budget/summary'),
      api.get('/budget/recurring'),
    ]);
    _budgetMonthly   = summary.all_months || [];
    _budgetRecurring = recurring.groups   || [];
    renderBudgetView(el, summary, recurring);
  } catch (e) {
    el.innerHTML = `<p style="color:var(--red);padding:20px">Error: ${e.message}</p>`;
  }
}

function renderBudgetView(el, summary, recurring) {
  const cur      = summary.current_month || {};
  const netPos   = (cur.net || 0) >= 0;
  const srPos    = (cur.savings_rate || 0) >= 0;

  // Month-over-month trend
  const recent3 = _budgetMonthly.slice(0, 3);
  const avgInc  = summary.avg_income_3m  || 0;
  const avgExp  = summary.avg_expense_3m || 0;

  // Subscription cost
  const subCost = recurring.subscription_monthly_est || 0;
  const recCost = recurring.recurring_monthly_est    || 0;

  el.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">Budget</div>
        <div class="page-subtitle">${cur.label || 'Current Month'} · monthly tracking</div>
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn btn-ghost btn-sm" onclick="setBudgetView('recurring')">
          ${recurring.total_subscriptions} subscriptions detected
        </button>
        <button class="btn btn-primary" onclick="navigateTo('checkbook')">+ Add Transaction</button>
      </div>
    </div>

    <!-- Tab nav -->
    <div class="market-tabs" style="margin-bottom:20px">
      <button class="market-tab ${_budgetView==='overview'  ?'active':''}" onclick="setBudgetView('overview')">Overview</button>
      <button class="market-tab ${_budgetView==='monthly'   ?'active':''}" onclick="setBudgetView('monthly')">Month History</button>
      <button class="market-tab ${_budgetView==='recurring' ?'active':''}" onclick="setBudgetView('recurring')">
        Recurring & Subs
        ${recurring.total_recurring > 0 ? `<span class="badge badge-yellow" style="margin-left:4px;font-size:0.58rem">${recurring.total_recurring}</span>` : ''}
      </button>
    </div>

    <!-- Tab content -->
    <div id="budget-tab-content"></div>
  `;

  _renderBudgetTab(summary, recurring);
}

function setBudgetView(view) {
  _budgetView = view;
  document.querySelectorAll('.market-tab').forEach(t => {
    t.classList.toggle('active', t.textContent.trim().startsWith(
      view === 'overview' ? 'Overview' : view === 'monthly' ? 'Month' : 'Recurring'
    ));
  });
  const container = document.getElementById('budget-tab-content');
  if (!container) return;
  container.innerHTML = loadingHtml('Loading');

  // Re-fetch and render
  Promise.all([api.get('/budget/summary'), api.get('/budget/recurring')])
    .then(([summary, recurring]) => {
      _budgetMonthly   = summary.all_months || [];
      _budgetRecurring = recurring.groups   || [];
      _renderBudgetTab(summary, recurring);
    })
    .catch(e => {
      const c = document.getElementById('budget-tab-content');
      if (c) c.innerHTML = `<div style="color:var(--red)">${e.message}</div>`;
    });
}

function _renderBudgetTab(summary, recurring) {
  const container = document.getElementById('budget-tab-content');
  if (!container) return;

  if (_budgetView === 'overview')   _renderOverview(container, summary, recurring);
  else if (_budgetView === 'monthly')    _renderMonthHistory(container);
  else if (_budgetView === 'recurring')  _renderRecurring(container, recurring);
}

// ── OVERVIEW TAB ──────────────────────────────────────────────────────────────

function _renderOverview(container, summary, recurring) {
  const cur    = summary.current_month || {};
  const netPos = (cur.net || 0) >= 0;
  const subCost= recurring.subscription_monthly_est || 0;
  const recCost= recurring.recurring_monthly_est    || 0;

  // Top categories this month
  const cats = Object.entries(cur.categories || {}).slice(0, 6);

  container.innerHTML = `
    <!-- Current month stats -->
    <div class="stat-grid" style="margin-bottom:20px">
      <div class="stat-card ${netPos?'':'red'}">
        <div class="stat-label">Net This Month</div>
        <div class="stat-value ${netPos?'pos':'neg'}">${netPos?'+':''}$${Math.abs(cur.net||0).toFixed(2)}</div>
        <div class="stat-sub">${cur.label}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Income</div>
        <div class="stat-value pos">+$${(cur.income||0).toFixed(2)}</div>
        <div class="stat-sub">vs avg $${summary.avg_income_3m.toFixed(0)}/mo</div>
      </div>
      <div class="stat-card red">
        <div class="stat-label">Expenses</div>
        <div class="stat-value neg">-$${(cur.expense||0).toFixed(2)}</div>
        <div class="stat-sub">vs avg $${summary.avg_expense_3m.toFixed(0)}/mo</div>
      </div>
      <div class="stat-card ${(cur.savings_rate||0)>=0?'':'red'}">
        <div class="stat-label">Savings Rate</div>
        <div class="stat-value ${(cur.savings_rate||0)>=0?'pos':'neg'}">${cur.savings_rate||0}%</div>
        <div class="stat-sub">of income retained</div>
      </div>
      <div class="stat-card red">
        <div class="stat-label">Fixed Costs (est.)</div>
        <div class="stat-value" style="color:var(--yellow)">$${recCost.toFixed(2)}</div>
        <div class="stat-sub">recurring/mo · ${recurring.total_recurring} items</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Subscriptions (est.)</div>
        <div class="stat-value" style="color:var(--purple)">$${subCost.toFixed(2)}</div>
        <div class="stat-sub">${recurring.total_subscriptions} detected</div>
      </div>
    </div>

    <!-- Spending vs income chart -->
    <div class="chart-card" style="margin-bottom:20px">
      <div class="chart-card-header">
        <div>
          <div class="chart-title">Income vs Expenses — Last 6 Months</div>
          <div class="chart-subtitle">Bar chart · click a bar to drill into that month</div>
        </div>
      </div>
      <div class="chart-wrap" style="height:240px">
        <canvas id="budget-bar-canvas" data-height="240"></canvas>
      </div>
    </div>

    <!-- Category breakdown this month -->
    ${cats.length > 0 ? `
    <div class="chart-card" style="margin-bottom:20px">
      <div class="chart-card-header">
        <div class="chart-title">Spending by Category — ${cur.label}</div>
      </div>
      <div style="display:flex;flex-direction:column;gap:0;margin-top:4px">
        ${cats.map(([cat, amt]) => {
          const pct = cur.expense > 0 ? Math.min(100, (amt / cur.expense * 100)) : 0;
          return `
            <div style="padding:10px 0;border-bottom:1px solid var(--border)">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px">
                <span style="font-size:0.8rem;color:var(--text)">${cat}</span>
                <span style="font-size:0.8rem;font-weight:600;color:var(--red)">-$${amt.toFixed(2)}</span>
              </div>
              <div style="height:4px;background:var(--bg-4);border-radius:2px;overflow:hidden">
                <div style="height:100%;width:${pct.toFixed(1)}%;background:var(--red);opacity:0.7;border-radius:2px;transition:width 0.4s"></div>
              </div>
              <div style="font-size:0.65rem;color:var(--text-3);margin-top:3px">${pct.toFixed(1)}% of expenses</div>
            </div>`;
        }).join('')}
      </div>
    </div>` : ''}

    <!-- Fixed vs variable breakdown -->
    ${recCost > 0 ? `
    <div class="chart-card">
      <div class="chart-card-header">
        <div class="chart-title">Fixed vs Variable Spending (est.)</div>
        <div class="chart-subtitle">Based on detected recurring payments</div>
      </div>
      <div style="display:flex;gap:16px;margin-top:10px;flex-wrap:wrap">
        <div style="flex:1;min-width:140px;background:var(--bg-3);border-radius:var(--radius);padding:14px;border-left:3px solid var(--yellow)">
          <div style="font-size:0.68rem;color:var(--text-3);text-transform:uppercase;letter-spacing:0.08em">Fixed (Recurring)</div>
          <div style="font-size:1.4rem;font-weight:700;color:var(--yellow);margin:4px 0">$${recCost.toFixed(2)}</div>
          <div style="font-size:0.7rem;color:var(--text-3)">per month (estimated)</div>
        </div>
        <div style="flex:1;min-width:140px;background:var(--bg-3);border-radius:var(--radius);padding:14px;border-left:3px solid var(--red)">
          <div style="font-size:0.68rem;color:var(--text-3);text-transform:uppercase;letter-spacing:0.08em">Variable</div>
          <div style="font-size:1.4rem;font-weight:700;color:var(--red);margin:4px 0">$${Math.max(0, (cur.expense||0) - recCost).toFixed(2)}</div>
          <div style="font-size:0.7rem;color:var(--text-3)">this month</div>
        </div>
        <div style="flex:1;min-width:140px;background:var(--bg-3);border-radius:var(--radius);padding:14px;border-left:3px solid var(--purple)">
          <div style="font-size:0.68rem;color:var(--text-3);text-transform:uppercase;letter-spacing:0.08em">Subscriptions</div>
          <div style="font-size:1.4rem;font-weight:700;color:var(--purple);margin:4px 0">$${subCost.toFixed(2)}</div>
          <div style="font-size:0.7rem;color:var(--text-3)">${recurring.total_subscriptions} services/mo</div>
        </div>
      </div>
    </div>` : ''}
  `;

  // Mount bar chart
  requestAnimationFrame(() => _mountBudgetBarChart(summary.all_months));
}

function _mountBudgetBarChart(months) {
  if (_budgetChartInst) { _budgetChartInst.destroy(); _budgetChartInst = null; }
  const canvas = document.getElementById('budget-bar-canvas');
  if (!canvas || !months?.length) return;

  const recent = months.slice(0, 6).reverse(); // oldest first

  // Two series: income and expense as side-by-side concept
  // Use the bar chart for expenses, overlay income as a line
  const expenseData = recent.map(m => ({
    label: m.label.split(' ')[0], // 'Apr'
    value: m.expense,
    color: '#ff4757'
  }));

  _budgetChartInst = new BarChart(canvas, {
    formatValue: v => '$' + Math.abs(v).toFixed(0),
    formatTooltipValue: v => '$' + parseFloat(v).toFixed(2),
    formatLabel: l => l,
  });
  _budgetChartInst.setData(expenseData);
}

// ── MONTH HISTORY TAB ─────────────────────────────────────────────────────────

function _renderMonthHistory(container) {
  if (!_budgetMonthly.length) {
    container.innerHTML = emptyStateHtml('◻', 'No monthly data yet');
    return;
  }

  container.innerHTML = `
    <!-- Month-over-month chart -->
    <div class="chart-card" style="margin-bottom:20px">
      <div class="chart-card-header">
        <div>
          <div class="chart-title">Net Income by Month</div>
          <div class="chart-subtitle">Positive = saved money, negative = overspent</div>
        </div>
      </div>
      <div class="chart-wrap" style="height:220px">
        <canvas id="budget-net-canvas" data-height="220"></canvas>
      </div>
    </div>

    <!-- Month cards -->
    <div style="display:flex;flex-direction:column;gap:8px">
      ${_budgetMonthly.map(m => {
        const netPos = m.net >= 0;
        const topCat = Object.entries(m.categories || {}).sort((a,b)=>b[1]-a[1])[0];
        return `
          <div class="budget-month-row" onclick="openMonthDetail('${m.month}')">
            <div style="display:flex;justify-content:space-between;align-items:center">
              <div>
                <div style="font-family:var(--font-display);font-weight:600;font-size:0.95rem">${m.label}</div>
                <div style="font-size:0.7rem;color:var(--text-3);margin-top:2px">
                  ${m.transaction_count} transactions
                  ${topCat ? ` · most spent: ${topCat[0]} ($${topCat[1].toFixed(0)})` : ''}
                </div>
              </div>
              <div style="text-align:right">
                <div class="${netPos?'pos':'neg'}" style="font-weight:700;font-size:1rem">
                  ${netPos?'+':''}$${Math.abs(m.net).toFixed(2)}
                </div>
                <div style="font-size:0.68rem;color:var(--text-3)">
                  <span class="pos">+$${m.income.toFixed(0)}</span>
                  &nbsp;·&nbsp;
                  <span class="neg">-$${m.expense.toFixed(0)}</span>
                </div>
              </div>
              <div style="font-size:0.65rem;color:var(--cyan);margin-left:12px">↗</div>
            </div>

            <!-- Mini category bar -->
            ${Object.entries(m.categories||{}).length > 0 ? `
            <div style="display:flex;height:3px;border-radius:2px;overflow:hidden;margin-top:8px;gap:1px">
              ${Object.entries(m.categories).slice(0,6).map(([cat, amt], i) => {
                const pct = m.expense > 0 ? (amt / m.expense * 100) : 0;
                const colors = ['#ff4757','#a78bfa','#00d2ff','#ffd32a','#00e676','#ff9f43'];
                return `<div style="flex:${pct};background:${colors[i%colors.length]};opacity:0.8" title="${cat}: $${amt.toFixed(0)}"></div>`;
              }).join('')}
            </div>` : ''}
          </div>`;
      }).join('')}
    </div>
  `;

  // Mount net line chart
  requestAnimationFrame(() => {
    const canvas = document.getElementById('budget-net-canvas');
    if (!canvas || !_budgetMonthly.length) return;
    const pts = _budgetMonthly.slice(0, 12).reverse().map(m => ({
      t: m.month + '-01',
      v: m.net
    }));
    const chart = new LineChart(canvas, {
      splitFill: true,
      formatValue: v => '$' + (Math.abs(v) >= 1000 ? (v/1000).toFixed(1)+'k' : Math.abs(v).toFixed(0)),
      formatTooltipValue: v => (v>=0?'+':'') + '$' + Math.abs(v).toFixed(2),
      formatTooltipDate: t => {
        try { return new Date(t+'T00:00:00').toLocaleDateString('en-US',{month:'long',year:'numeric'}); }
        catch { return t; }
      },
      rangeKey: 'all',
    });
    chart.setData([{ label: 'Net', points: pts }], 'all');
  });
}

async function openMonthDetail(month) {
  openModal(`
    <div class="modal-title">${_budgetMonthly.find(m=>m.month===month)?.label || month}</div>
    <div id="month-detail-content">${loadingHtml('Loading transactions')}</div>
  `);

  try {
    const data = await api.get(`/budget/monthly/${month}`);
    const txns = data.transactions || [];

    if (!txns.length) {
      document.getElementById('month-detail-content').innerHTML =
        `<div style="color:var(--text-3);padding:20px;text-align:center">No transactions this month</div>`;
      return;
    }

    document.getElementById('month-detail-content').innerHTML = `
      <div class="table-wrap" style="max-height:400px;overflow-y:auto">
        <table>
          <thead>
            <tr><th>Date</th><th>Type</th><th>Category</th><th>Description</th><th>Amount</th><th>Source</th></tr>
          </thead>
          <tbody>
            ${txns.map(t => `
              <tr>
                <td>${fmtDate(t.date)}</td>
                <td><span class="badge ${t.type==='income'?'badge-green':t.type==='payment'?'badge-cyan':'badge-red'}">${t.type}</span></td>
                <td>${t.category||'—'}</td>
                <td style="color:var(--text-2);font-size:0.78rem">${t.description||'—'}</td>
                <td class="${(t.signed_amount||0)>=0?'pos':'neg'}">
                  ${(t.signed_amount||0)>=0?'+':''}$${Math.abs(t.signed_amount||t.amount||0).toFixed(2)}
                </td>
                <td style="font-size:0.68rem;color:var(--text-3)">${t.source_table||'—'}${t.account_name?' · '+t.account_name:''}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    `;
  } catch (e) {
    document.getElementById('month-detail-content').innerHTML =
      `<div style="color:var(--red)">${e.message}</div>`;
  }
}

// ── RECURRING TAB ─────────────────────────────────────────────────────────────

function _renderRecurring(container, recurring) {
  const groups = recurring.groups || [];

  if (!groups.length) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">↺</div>
        <div class="empty-state-text">No recurring payments detected yet</div>
        <div style="font-size:0.75rem;color:var(--text-3);margin-top:8px;max-width:340px;text-align:center">
          Add more transactions over multiple months and recurring detection will automatically identify patterns.
        </div>
      </div>`;
    return;
  }

  const subs   = groups.filter(g => g.is_subscription);
  const others = groups.filter(g => !g.is_subscription);

  container.innerHTML = `
    <!-- Summary strip -->
    <div class="stat-grid" style="margin-bottom:20px">
      <div class="stat-card" style="border-left:3px solid var(--purple)">
        <div class="stat-label">Subscriptions/mo (est.)</div>
        <div class="stat-value" style="color:var(--purple)">$${(recurring.subscription_monthly_est||0).toFixed(2)}</div>
        <div class="stat-sub">${subs.length} detected services</div>
      </div>
      <div class="stat-card" style="border-left:3px solid var(--yellow)">
        <div class="stat-label">All Recurring/mo (est.)</div>
        <div class="stat-value" style="color:var(--yellow)">$${(recurring.recurring_monthly_est||0).toFixed(2)}</div>
        <div class="stat-sub">${groups.length} total recurring items</div>
      </div>
    </div>

    ${subs.length > 0 ? `
    <div style="font-size:0.68rem;color:var(--text-3);text-transform:uppercase;letter-spacing:0.1em;margin-bottom:10px">
      🔄 Subscriptions
    </div>
    <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:20px">
      ${subs.map(g => _recurringCard(g)).join('')}
    </div>` : ''}

    ${others.length > 0 ? `
    <div style="font-size:0.68rem;color:var(--text-3);text-transform:uppercase;letter-spacing:0.1em;margin-bottom:10px">
      ↺ Other Recurring
    </div>
    <div style="display:flex;flex-direction:column;gap:6px">
      ${others.map(g => _recurringCard(g)).join('')}
    </div>` : ''}
  `;
}

function _recurringCard(g) {
  const confPct  = Math.round(g.confidence * 100);
  const confColor= confPct >= 80 ? 'var(--green)' : confPct >= 60 ? 'var(--yellow)' : 'var(--text-3)';
  const freqBadge= {
    monthly:   '<span class="badge badge-cyan"  style="font-size:0.6rem">Monthly</span>',
    weekly:    '<span class="badge badge-green" style="font-size:0.6rem">Weekly</span>',
    quarterly: '<span class="badge badge-gray"  style="font-size:0.6rem">Quarterly</span>',
    annual:    '<span class="badge badge-gray"  style="font-size:0.6rem">Annual</span>',
  }[g.frequency] || '';

  const statusBadge = g.user_status === 'confirmed'
    ? '<span class="badge badge-green" style="font-size:0.6rem">✓ Confirmed</span>'
    : g.user_status === 'dismissed'
    ? '<span class="badge badge-gray"  style="font-size:0.6rem">Dismissed</span>'
    : `<span class="badge badge-yellow" style="font-size:0.6rem">${confPct}% confident</span>`;

  return `
    <div class="recurring-card">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px">
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:4px">
            <span style="font-weight:600;font-size:0.88rem">${g.description || g.label}</span>
            ${g.is_subscription ? '<span style="font-size:0.65rem">📱</span>' : ''}
            ${freqBadge}
            ${statusBadge}
          </div>
          <div style="font-size:0.72rem;color:var(--text-3)">
            ${g.category}
            · ${g.occurrences} payments detected
            · first: ${fmtDate(g.first_seen)}
            ${g.next_expected ? ` · next est: <span style="color:var(--yellow)">${fmtDate(g.next_expected)}</span>` : ''}
          </div>
        </div>
        <div style="text-align:right;flex-shrink:0">
          <div style="font-family:var(--font-display);font-size:1.1rem;font-weight:700;color:var(--red)">
            -$${g.amount.toFixed(2)}
          </div>
          <div style="font-size:0.68rem;color:var(--text-3)">
            ${g.frequency === 'monthly' ? 'per month' : g.frequency === 'weekly' ? 'per week' : 'per period'}
          </div>
        </div>
      </div>
      ${g.user_status !== 'confirmed' && g.user_status !== 'dismissed' ? `
      <div style="display:flex;gap:6px;margin-top:10px">
        <button class="btn btn-sm btn-ghost" style="font-size:0.7rem"
          onclick="confirmRecurring('${g.group_id}')">✓ Confirm</button>
        <button class="btn btn-sm btn-ghost" style="font-size:0.7rem;color:var(--text-3)"
          onclick="dismissRecurring('${g.group_id}')">✕ Not recurring</button>
      </div>` : ''}
    </div>
  `;
}

async function confirmRecurring(groupId) {
  try {
    await api.post(`/budget/recurring/${groupId}/confirm`, {});
    showToast('Confirmed ✓', 'success');
    setBudgetView('recurring');
  } catch (e) { showToast(e.message, 'error'); }
}

async function dismissRecurring(groupId) {
  try {
    await api.post(`/budget/recurring/${groupId}/dismiss`, {});
    showToast('Dismissed', 'success');
    setBudgetView('recurring');
  } catch (e) { showToast(e.message, 'error'); }
}
