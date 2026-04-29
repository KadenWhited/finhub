// modules/checkbook.js

let checkbookData = [];
const CB_CATEGORIES = ['Housing', 'Food', 'Transport', 'Utilities', 'Entertainment', 'Healthcare', 'Clothing', 'Trading Capital', 'Income', 'Other'];

async function renderCheckbook() {
  const el = document.getElementById('page-checkbook');
  el.innerHTML = loadingHtml('Loading checkbook');
  try {
    const [entries, stats] = await Promise.all([
      api.get('/checkbook/'),
      api.get('/checkbook/stats')
    ]);
    checkbookData = entries;
    renderCheckbookView(el, entries, stats);
  } catch (e) {
    el.innerHTML = `<p style="color:var(--red);padding:20px">Error: ${e.message}</p>`;
  }
}

function renderCheckbookView(el, entries, stats) {
  // Build running balance
  const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
  let running = 0;
  const withBalance = sorted.map(e => {
    running += e.type === 'income' ? e.amount : -e.amount;
    return { ...e, running_balance: running };
  }).reverse();

  const tableRows = withBalance.length === 0
    ? `<tr class="empty-row"><td colspan="6">${emptyStateHtml('◻', 'No entries yet — log your first transaction')}</td></tr>`
    : withBalance.map(e => `
        <tr>
          <td>${fmtDate(e.date)}</td>
          <td><span class="badge ${e.type === 'income' ? 'badge-green' : 'badge-red'}">${e.type}</span></td>
          <td>${e.category}</td>
          <td>${e.description || '<span class="zero">—</span>'}</td>
          <td class="${e.type === 'income' ? 'pos' : 'neg'}">${e.type === 'income' ? '+' : '-'}$${parseFloat(e.amount).toFixed(2)}</td>
          <td class="${e.running_balance >= 0 ? 'pos' : 'neg'}">$${e.running_balance.toFixed(2)}</td>
          <td>
            <div class="row-actions">
              <button class="btn btn-sm btn-ghost btn-icon" onclick="openEditCbModal(${e.id})">✎</button>
              <button class="btn btn-sm btn-danger btn-icon" onclick="deleteCbEntry(${e.id})">✕</button>
            </div>
          </td>
        </tr>
      `).join('');

  el.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">Checkbook</div>
        <div class="page-subtitle">Income & expense tracker</div>
      </div>
      <button class="btn btn-primary" onclick="openNewCbModal()">+ Add Entry</button>
    </div>

    <div class="stat-grid">
      <div class="stat-card cyan">
        <div class="stat-label">Current Balance</div>
        <div class="stat-value ${stats.balance >= 0 ? 'neutral' : 'neg'}">$${stats.balance.toFixed(2)}</div>
        <div class="stat-sub">${stats.entry_count} entries</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Total Income</div>
        <div class="stat-value pos">+$${stats.total_income.toFixed(2)}</div>
      </div>
      <div class="stat-card red">
        <div class="stat-label">Total Expenses</div>
        <div class="stat-value neg">-$${stats.total_expenses.toFixed(2)}</div>
      </div>
    </div>

    <div class="action-row">
      <span style="font-size:0.72rem;color:var(--text-3)">${withBalance.length} entries</span>
    </div>

    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Type</th>
            <th>Category</th>
            <th>Description</th>
            <th>Amount</th>
            <th>Balance</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>${tableRows}</tbody>
      </table>
    </div>
  `;
}

function openNewCbModal() {
  window._cbType = 'income';
  openModal(`
    <div class="modal-title">Add Transaction</div>
    <div class="form-group" style="margin-bottom:14px">
      <label class="form-label">Type</label>
      <div class="radio-group">
        <div id="cb-income" class="radio-btn active-income" onclick="setCbType('income')">Income</div>
        <div id="cb-expense" class="radio-btn" onclick="setCbType('expense')">Expense</div>
      </div>
    </div>
    <div class="form-grid">
      <div class="form-group">
        <label class="form-label">Amount ($)</label>
        <input id="cb-amount" class="form-input" type="number" step="any" placeholder="0.00">
      </div>
      <div class="form-group">
        <label class="form-label">Date</label>
        <input id="cb-date" class="form-input" type="date" value="${todayISO()}">
      </div>
      <div class="form-group">
        <label class="form-label">Category</label>
        <select id="cb-cat" class="form-select">
          ${CB_CATEGORIES.map(c => `<option>${c}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Description</label>
        <input id="cb-desc" class="form-input" placeholder="Optional detail">
      </div>
    </div>
    <button class="btn btn-primary" onclick="submitNewCb()" style="width:100%">Add Entry</button>
  `);
}

function setCbType(type) {
  window._cbType = type;
  document.getElementById('cb-income').className = `radio-btn ${type === 'income' ? 'active-income' : ''}`;
  document.getElementById('cb-expense').className = `radio-btn ${type === 'expense' ? 'active-expense' : ''}`;
}

async function submitNewCb() {
  const amount = document.getElementById('cb-amount').value;
  const date = document.getElementById('cb-date').value;
  const category = document.getElementById('cb-cat').value;
  if (!amount || !date) { showToast('Fill in required fields', 'error'); return; }
  try {
    await api.post('/checkbook/', {
      type: window._cbType,
      amount, date, category,
      description: document.getElementById('cb-desc').value
    });
    closeModal();
    showToast('Entry added ✓', 'success');
    renderCheckbook();
  } catch (e) {
    showToast(e.message, 'error');
  }
}

function openEditCbModal(id) {
  const e = checkbookData.find(x => x.id === id);
  if (!e) return;
  window._cbEditType = e.type;
  openModal(`
    <div class="modal-title">Edit Entry</div>
    <div class="form-group" style="margin-bottom:14px">
      <label class="form-label">Type</label>
      <div class="radio-group">
        <div id="cbe-income" class="radio-btn ${e.type === 'income' ? 'active-income' : ''}" onclick="setCbEditType('income')">Income</div>
        <div id="cbe-expense" class="radio-btn ${e.type === 'expense' ? 'active-expense' : ''}" onclick="setCbEditType('expense')">Expense</div>
      </div>
    </div>
    <div class="form-grid">
      <div class="form-group">
        <label class="form-label">Amount</label>
        <input id="cbe-amount" class="form-input" type="number" step="any" value="${e.amount}">
      </div>
      <div class="form-group">
        <label class="form-label">Date</label>
        <input id="cbe-date" class="form-input" type="date" value="${e.date}">
      </div>
      <div class="form-group">
        <label class="form-label">Category</label>
        <select id="cbe-cat" class="form-select">
          ${CB_CATEGORIES.map(c => `<option ${c === e.category ? 'selected' : ''}>${c}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Description</label>
        <input id="cbe-desc" class="form-input" value="${e.description || ''}">
      </div>
    </div>
    <button class="btn btn-primary" onclick="submitEditCb(${id})" style="width:100%">Save Changes</button>
  `);
}

function setCbEditType(type) {
  window._cbEditType = type;
  document.getElementById('cbe-income').className = `radio-btn ${type === 'income' ? 'active-income' : ''}`;
  document.getElementById('cbe-expense').className = `radio-btn ${type === 'expense' ? 'active-expense' : ''}`;
}

async function submitEditCb(id) {
  try {
    await api.put(`/checkbook/${id}`, {
      type: window._cbEditType,
      amount: document.getElementById('cbe-amount').value,
      date: document.getElementById('cbe-date').value,
      category: document.getElementById('cbe-cat').value,
      description: document.getElementById('cbe-desc').value
    });
    closeModal();
    showToast('Entry updated ✓', 'success');
    renderCheckbook();
  } catch (e) {
    showToast(e.message, 'error');
  }
}

async function deleteCbEntry(id) {
  confirmAction('Delete this entry?', async () => {
    try {
      await api.del(`/checkbook/${id}`);
      showToast('Entry deleted', 'success');
      renderCheckbook();
    } catch (e) {
      showToast(e.message, 'error');
    }
  });
}
