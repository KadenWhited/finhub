// modules/credit.js

let creditAccounts = [];
let creditTxns = [];
let selectedAccountId = null;

const CREDIT_CATEGORIES = [
  'Food & Dining', 'Shopping', 'Gas', 'Travel', 'Entertainment',
  'Healthcare', 'Utilities', 'Subscriptions', 'Trading', 'Other'
];

async function renderCredit() {
  const el = document.getElementById('page-credit');
  el.innerHTML = loadingHtml('Loading credit');
  try {
    const [accounts, stats, txns] = await Promise.all([
      api.get('/credit/accounts'),
      api.get('/credit/stats'),
      api.get('/credit/transactions')
    ]);
    creditAccounts = accounts;
    creditTxns = txns;
    renderCreditView(el, accounts, stats, txns);
  } catch (e) {
    el.innerHTML = `<p style="color:var(--red);padding:20px">Error: ${e.message}</p>`;
  }
}

function renderCreditView(el, accounts, stats, txns) {
  const accountCards = accounts.length === 0
    ? `<div style="color:var(--text-3);font-size:0.8rem;padding:20px 0">No credit accounts yet — add one to get started.</div>`
    : accounts.map(a => {
        const utilColor = !a.utilization_pct ? 'var(--text-3)'
          : a.utilization_pct > 80 ? 'var(--red)'
          : a.utilization_pct > 50 ? 'var(--yellow)'
          : 'var(--green)';
        const isSelected = selectedAccountId === a.id;
        return `
          <div class="credit-card ${isSelected ? 'selected' : ''}" onclick="selectAccount(${a.id})">
            <div style="display:flex;justify-content:space-between;align-items:flex-start">
              <div>
                <div style="font-family:var(--font-display);font-weight:700;font-size:1rem">${a.name}</div>
                ${a.last_four ? `<div style="font-size:0.7rem;color:var(--text-3);letter-spacing:0.1em">•••• ${a.last_four}</div>` : ''}
              </div>
              <button class="btn btn-sm btn-danger btn-icon" onclick="event.stopPropagation();deleteAccount(${a.id})">✕</button>
            </div>
            <div style="margin-top:14px">
              <div style="font-family:var(--font-display);font-size:1.6rem;font-weight:800;color:${a.computed_balance > 0 ? 'var(--red)' : 'var(--green)'}">
                $${Math.abs(a.computed_balance).toFixed(2)}
              </div>
              <div style="font-size:0.7rem;color:var(--text-3);margin-top:2px">current balance</div>
            </div>
            ${a.credit_limit ? `
            <div style="margin-top:10px">
              <div style="display:flex;justify-content:space-between;font-size:0.7rem;color:var(--text-3);margin-bottom:4px">
                <span>Utilization</span><span style="color:${utilColor}">${a.utilization_pct}%</span>
              </div>
              <div style="height:4px;background:var(--bg-4);border-radius:2px;overflow:hidden">
                <div style="height:100%;width:${Math.min(a.utilization_pct, 100)}%;background:${utilColor};border-radius:2px;transition:width 0.4s"></div>
              </div>
              <div style="font-size:0.68rem;color:var(--text-3);margin-top:4px">Limit: $${a.credit_limit.toLocaleString()}</div>
            </div>` : ''}
          </div>
        `;
      }).join('');

  const filteredTxns = selectedAccountId
    ? txns.filter(t => t.account_id === selectedAccountId)
    : txns;

  const tableRows = filteredTxns.length === 0
    ? `<tr class="empty-row"><td colspan="6">${emptyStateHtml('▣', 'No transactions yet')}</td></tr>`
    : filteredTxns.map(t => `
        <tr>
          <td>${fmtDate(t.date)}</td>
          <td><span style="font-size:0.75rem;color:var(--text-2)">${t.account_name}</span></td>
          <td><span class="badge ${t.type === 'charge' ? 'badge-red' : 'badge-green'}">${t.type}</span></td>
          <td>${t.category}</td>
          <td>${t.description || '<span class="zero">—</span>'}</td>
          <td class="${t.type === 'charge' ? 'neg' : 'pos'}">${t.type === 'charge' ? '-' : '+'}$${parseFloat(t.amount).toFixed(2)}</td>
          <td>
            <button class="btn btn-sm btn-danger btn-icon" onclick="deleteCreditTxn(${t.id})">✕</button>
          </td>
        </tr>
      `).join('');

  el.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">Credit</div>
        <div class="page-subtitle">Cards & balances</div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-ghost" onclick="openNewAccountModal()">+ Add Card</button>
        <button class="btn btn-primary" onclick="openNewCreditTxnModal()">+ Log Charge</button>
      </div>
    </div>

    ${stats.total_limit ? `
    <div class="stat-grid" style="margin-bottom:20px">
      <div class="stat-card red">
        <div class="stat-label">Total Owed</div>
        <div class="stat-value neg">$${stats.total_balance.toFixed(2)}</div>
        <div class="stat-sub">across ${accounts.length} card${accounts.length !== 1 ? 's' : ''}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Total Limit</div>
        <div class="stat-value">$${stats.total_limit.toLocaleString()}</div>
      </div>
      <div class="stat-card ${(stats.overall_utilization || 0) > 50 ? 'red' : ''}">
        <div class="stat-label">Overall Utilization</div>
        <div class="stat-value ${(stats.overall_utilization || 0) > 50 ? 'neg' : 'pos'}">${stats.overall_utilization ?? '—'}%</div>
        <div class="stat-sub">${(stats.overall_utilization || 0) > 30 ? '⚠ Consider paying down' : '✓ Healthy'}</div>
      </div>
    </div>` : ''}

    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:14px;margin-bottom:24px">
      ${accountCards}
    </div>

    <div class="action-row">
      <div style="font-size:0.75rem;color:var(--text-2)">
        ${selectedAccountId
          ? `Showing: <strong>${accounts.find(a => a.id === selectedAccountId)?.name}</strong> <button class="btn btn-sm btn-ghost" onclick="selectAccount(null)" style="margin-left:8px">Clear filter</button>`
          : 'All transactions'}
      </div>
      <span style="font-size:0.72rem;color:var(--text-3)">${filteredTxns.length} transaction${filteredTxns.length !== 1 ? 's' : ''}</span>
    </div>

    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Card</th>
            <th>Type</th>
            <th>Category</th>
            <th>Description</th>
            <th>Amount</th>
            <th></th>
          </tr>
        </thead>
        <tbody>${tableRows}</tbody>
      </table>
    </div>
  `;
}

function selectAccount(id) {
  selectedAccountId = id;
  renderCredit();
}

function openNewAccountModal() {
  openModal(`
    <div class="modal-title">Add Credit Card</div>
    <div class="form-grid">
      <div class="form-group">
        <label class="form-label">Card Name</label>
        <input id="ca-name" class="form-input" placeholder="Chase Sapphire, Discover…">
      </div>
      <div class="form-group">
        <label class="form-label">Last 4 Digits (optional)</label>
        <input id="ca-four" class="form-input" maxlength="4" placeholder="1234">
      </div>
      <div class="form-group">
        <label class="form-label">Credit Limit ($, optional)</label>
        <input id="ca-limit" class="form-input" type="number" step="any" placeholder="500">
      </div>
    </div>
    <button class="btn btn-primary" onclick="submitNewAccount()" style="width:100%">Add Card</button>
  `);
}

async function submitNewAccount() {
  const name = document.getElementById('ca-name').value.trim();
  if (!name) { showToast('Card name required', 'error'); return; }
  try {
    await api.post('/credit/accounts', {
      name,
      last_four: document.getElementById('ca-four').value,
      credit_limit: document.getElementById('ca-limit').value || null
    });
    closeModal();
    showToast('Card added ✓', 'success');
    renderCredit();
  } catch (e) {
    showToast(e.message, 'error');
  }
}

async function deleteAccount(id) {
  confirmAction('Delete this card and ALL its transactions?', async () => {
    try {
      await api.del(`/credit/accounts/${id}`);
      if (selectedAccountId === id) selectedAccountId = null;
      showToast('Card deleted', 'success');
      renderCredit();
    } catch (e) {
      showToast(e.message, 'error');
    }
  });
}

function openNewCreditTxnModal() {
  if (creditAccounts.length === 0) {
    showToast('Add a credit card first', 'error');
    openNewAccountModal();
    return;
  }
  window._creditTxnType = 'charge';
  openModal(`
    <div class="modal-title">Log Credit Transaction</div>
    <div class="form-group" style="margin-bottom:14px">
      <label class="form-label">Type</label>
      <div class="radio-group">
        <div id="ct-charge" class="radio-btn active-expense" onclick="setCreditTxnType('charge')">Charge</div>
        <div id="ct-payment" class="radio-btn" onclick="setCreditTxnType('payment')">Payment</div>
      </div>
    </div>
    <div class="form-grid">
      <div class="form-group">
        <label class="form-label">Card</label>
        <select id="ct-acct" class="form-select">
          ${creditAccounts.map(a => `<option value="${a.id}">${a.name}${a.last_four ? ' ••'+a.last_four : ''}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Amount ($)</label>
        <input id="ct-amount" class="form-input" type="number" step="any" placeholder="0.00">
      </div>
      <div class="form-group">
        <label class="form-label">Date</label>
        <input id="ct-date" class="form-input" type="date" value="${todayISO()}">
      </div>
      <div class="form-group">
        <label class="form-label">Category</label>
        <select id="ct-cat" class="form-select">
          ${CREDIT_CATEGORIES.map(c => `<option>${c}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="form-group" style="margin-bottom:18px">
      <label class="form-label">Description (optional)</label>
      <input id="ct-desc" class="form-input" placeholder="Merchant, notes…">
    </div>
    <button class="btn btn-primary" onclick="submitNewCreditTxn()" style="width:100%">Log Transaction</button>
  `);
}

function setCreditTxnType(type) {
  window._creditTxnType = type;
  document.getElementById('ct-charge').className = `radio-btn ${type === 'charge' ? 'active-expense' : ''}`;
  document.getElementById('ct-payment').className = `radio-btn ${type === 'payment' ? 'active-income' : ''}`;
}

async function submitNewCreditTxn() {
  const amount = document.getElementById('ct-amount').value;
  const date = document.getElementById('ct-date').value;
  if (!amount || !date) { showToast('Fill in required fields', 'error'); return; }
  try {
    await api.post('/credit/transactions', {
      account_id: parseInt(document.getElementById('ct-acct').value),
      type: window._creditTxnType,
      amount, date,
      category: document.getElementById('ct-cat').value,
      description: document.getElementById('ct-desc').value
    });
    closeModal();
    showToast('Transaction logged ✓', 'success');
    renderCredit();
  } catch (e) {
    showToast(e.message, 'error');
  }
}

async function deleteCreditTxn(id) {
  confirmAction('Delete this transaction?', async () => {
    try {
      await api.del(`/credit/transactions/${id}`);
      showToast('Deleted', 'success');
      renderCredit();
    } catch (e) {
      showToast(e.message, 'error');
    }
  });
}