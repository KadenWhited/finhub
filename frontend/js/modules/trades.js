// modules/trades.js

let tradesData = [];
let tradesFilter = 'all';

async function renderTrades() {
  const el = document.getElementById('page-trades');
  el.innerHTML = loadingHtml('Loading trades');

  try {
    const [trades, stats] = await Promise.all([
      api.get('/trades/'),
      api.get('/trades/stats')
    ]);
    tradesData = trades;
    renderTradesView(el, trades, stats);
  } catch (e) {
    el.innerHTML = `<p style="color:var(--red);padding:20px">Error: ${e.message}</p>`;
  }
}

function renderTradesView(el, trades, stats) {
  const revengeAlert = stats.revenge_trading_alert
    ? `<div class="alert-banner alert-revenge"><span class="alert-icon">⚠</span><strong>REVENGE TRADING ALERT</strong> — 3 consecutive losses detected. Cool down before your next trade.</div>`
    : '';

  const filtered = tradesFilter === 'all' ? trades
    : tradesFilter === 'open' ? trades.filter(t => t.status === 'open')
    : trades.filter(t => t.status === 'closed');

  const tableRows = filtered.length === 0
    ? `<tr class="empty-row"><td colspan="9">${emptyStateHtml('◇', 'No trades yet — log your first trade')}</td></tr>`
    : filtered.map(t => `
        <tr>
          <td><strong>${t.coin}</strong></td>
          <td><span class="badge ${t.direction === 'long' ? 'badge-green' : 'badge-red'}">${t.direction}</span></td>
          <td>$${parseFloat(t.entry_price).toFixed(4)}</td>
          <td>${t.exit_price ? '$' + parseFloat(t.exit_price).toFixed(4) : '<span class="zero">—</span>'}</td>
          <td>${t.position_size}</td>
          <td>${fmtPnl(t.pnl)}</td>
          <td>${t.pnl_pct !== null ? fmtPct(t.pnl_pct) : '—'}</td>
          <td><span class="badge ${t.status === 'open' ? 'badge-yellow' : t.pnl > 0 ? 'badge-green' : 'badge-red'}">${t.status}</span></td>
          <td>
            <div class="row-actions">
              ${t.status === 'open' ? `<button class="btn btn-sm btn-primary" onclick="openCloseTradeModal(${t.id})">Close</button>` : ''}
              <button class="btn btn-sm btn-ghost btn-icon" onclick="openEditTradeModal(${t.id})" title="Edit">✎</button>
              <button class="btn btn-sm btn-danger btn-icon" onclick="deleteTrade(${t.id})" title="Delete">✕</button>
            </div>
          </td>
        </tr>
      `).join('');

  el.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">Trade Journal</div>
        <div class="page-subtitle">Crypto swing trades</div>
      </div>
      <button class="btn btn-primary" onclick="openNewTradeModal()">+ New Trade</button>
    </div>

    ${revengeAlert}

    <div class="stat-grid">
      <div class="stat-card">
        <div class="stat-label">Total P&L</div>
        <div class="stat-value ${pnlClass(stats.total_pnl)}">${stats.total_pnl >= 0 ? '+' : ''}$${Math.abs(stats.total_pnl).toFixed(2)}</div>
        <div class="stat-sub">${stats.total_trades} closed trades</div>
      </div>
      <div class="stat-card ${stats.win_rate >= 50 ? '' : 'red'}">
        <div class="stat-label">Win Rate</div>
        <div class="stat-value ${stats.win_rate >= 50 ? 'pos' : 'neg'}">${stats.win_rate}%</div>
        <div class="stat-sub">${stats.total_wins}W / ${stats.total_losses}L</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Avg Win</div>
        <div class="stat-value pos">+$${Math.abs(stats.avg_win).toFixed(2)}</div>
        <div class="stat-sub">per winning trade</div>
      </div>
      <div class="stat-card red">
        <div class="stat-label">Avg Loss</div>
        <div class="stat-value neg">-$${Math.abs(stats.avg_loss).toFixed(2)}</div>
        <div class="stat-sub">per losing trade</div>
      </div>
      ${stats.profit_factor !== null ? `
      <div class="stat-card cyan">
        <div class="stat-label">Profit Factor</div>
        <div class="stat-value neutral">${stats.profit_factor}x</div>
        <div class="stat-sub">gross win / gross loss</div>
      </div>` : ''}
      <div class="stat-card yellow">
        <div class="stat-label">Open Trades</div>
        <div class="stat-value" style="color:var(--yellow)">${stats.open_trades}</div>
        <div class="stat-sub">active positions</div>
      </div>
    </div>

    <div class="action-row">
      <div class="action-filters">
        <button class="btn btn-sm ${tradesFilter === 'all' ? 'btn-primary' : 'btn-ghost'}" onclick="setTradesFilter('all')">All</button>
        <button class="btn btn-sm ${tradesFilter === 'open' ? 'btn-primary' : 'btn-ghost'}" onclick="setTradesFilter('open')">Open</button>
        <button class="btn btn-sm ${tradesFilter === 'closed' ? 'btn-primary' : 'btn-ghost'}" onclick="setTradesFilter('closed')">Closed</button>
      </div>
      <span style="font-size:0.72rem;color:var(--text-3)">${filtered.length} trade${filtered.length !== 1 ? 's' : ''}</span>
    </div>

    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Coin</th>
            <th>Dir</th>
            <th>Entry</th>
            <th>Exit</th>
            <th>Size</th>
            <th>P&L</th>
            <th>%</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>${tableRows}</tbody>
      </table>
    </div>
  `;
}

function setTradesFilter(f) {
  tradesFilter = f;
  renderTrades();
}

function openNewTradeModal() {
  openModal(`
    <div class="modal-title">Log New Trade</div>
    <div class="form-grid">
      <div class="form-group">
        <label class="form-label">Coin</label>
        <input id="t-coin" class="form-input" placeholder="BTC, ETH…" autocomplete="off">
      </div>
      <div class="form-group">
        <label class="form-label">Direction</label>
        <div class="radio-group">
          <div id="dir-long" class="radio-btn active-long" onclick="setDir('long')">Long</div>
          <div id="dir-short" class="radio-btn" onclick="setDir('short')">Short</div>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Entry Price ($)</label>
        <input id="t-entry" class="form-input" type="number" step="any" placeholder="0.00">
      </div>
      <div class="form-group">
        <label class="form-label">Position Size (coins)</label>
        <input id="t-size" class="form-input" type="number" step="any" placeholder="0.00">
      </div>
      <div class="form-group">
        <label class="form-label">Exit Price ($) — optional</label>
        <input id="t-exit" class="form-input" type="number" step="any" placeholder="Leave blank if open">
      </div>
      <div class="form-group">
        <label class="form-label">Entry Date</label>
        <input id="t-date" class="form-input" type="date" value="${todayISO()}">
      </div>
      <div class="form-group">
        <label class="form-label">Exit Date</label>
        <input id="t-exit-date" class="form-input" type="date">
      </div>
    </div>
    <div class="form-group" style="margin-bottom:12px">
      <label class="form-label">Reason for Trade</label>
      <input id="t-reason" class="form-input" placeholder="Setup, indicator signal, thesis…">
    </div>
    <div class="form-group" style="margin-bottom:18px">
      <label class="form-label">Notes</label>
      <textarea id="t-notes" class="form-textarea" placeholder="Lessons, observations…"></textarea>
    </div>
    <button class="btn btn-primary" onclick="submitNewTrade()" style="width:100%">Log Trade</button>
  `);
  window._tradeDir = 'long';
}

function setDir(dir) {
  window._tradeDir = dir;
  document.getElementById('dir-long').className = `radio-btn ${dir === 'long' ? 'active-long' : ''}`;
  document.getElementById('dir-short').className = `radio-btn ${dir === 'short' ? 'active-short' : ''}`;
}

async function submitNewTrade() {
  const coin = document.getElementById('t-coin').value.trim();
  const entry = document.getElementById('t-entry').value;
  const size = document.getElementById('t-size').value;
  const date = document.getElementById('t-date').value;
  if (!coin || !entry || !size || !date) { showToast('Fill in required fields', 'error'); return; }

  const body = {
    coin, entry_price: entry, position_size: size, entry_date: date,
    direction: window._tradeDir || 'long',
    exit_price: document.getElementById('t-exit').value || null,
    exit_date: document.getElementById('t-exit-date').value || null,
    reason: document.getElementById('t-reason').value,
    notes: document.getElementById('t-notes').value,
  };

  try {
    await api.post('/trades/', body);
    closeModal();
    showToast('Trade logged ✓', 'success');
    renderTrades();
    if (document.querySelector('.nav-link[data-page="dashboard"]')?.classList.contains('active')) renderDashboard();
  } catch (e) {
    showToast(e.message, 'error');
  }
}

function openCloseTradeModal(id) {
  const trade = tradesData.find(t => t.id === id);
  if (!trade) return;
  openModal(`
    <div class="modal-title">Close Trade — ${trade.coin}</div>
    <div style="margin-bottom:14px;font-size:0.8rem;color:var(--text-2)">
      Entry: $${trade.entry_price} · Size: ${trade.position_size} · Direction: ${trade.direction}
    </div>
    <div class="form-grid">
      <div class="form-group">
        <label class="form-label">Exit Price ($)</label>
        <input id="close-exit" class="form-input" type="number" step="any" placeholder="Exit price">
      </div>
      <div class="form-group">
        <label class="form-label">Exit Date</label>
        <input id="close-date" class="form-input" type="date" value="${todayISO()}">
      </div>
    </div>
    <div class="form-group" style="margin-bottom:18px">
      <label class="form-label">Notes</label>
      <textarea id="close-notes" class="form-textarea" placeholder="Exit reason, lessons…"></textarea>
    </div>
    <button class="btn btn-primary" onclick="submitCloseTrade(${id})" style="width:100%">Close Trade</button>
  `);
}

async function submitCloseTrade(id) {
  const exit = document.getElementById('close-exit').value;
  if (!exit) { showToast('Enter exit price', 'error'); return; }
  try {
    await api.put(`/trades/${id}`, {
      exit_price: exit,
      exit_date: document.getElementById('close-date').value,
      notes: document.getElementById('close-notes').value,
      status: 'closed'
    });
    closeModal();
    showToast('Trade closed ✓', 'success');
    renderTrades();
  } catch (e) {
    showToast(e.message, 'error');
  }
}

function openEditTradeModal(id) {
  const t = tradesData.find(x => x.id === id);
  if (!t) return;
  openModal(`
    <div class="modal-title">Edit Trade — ${t.coin}</div>
    <div class="form-grid">
      <div class="form-group">
        <label class="form-label">Coin</label>
        <input id="et-coin" class="form-input" value="${t.coin}">
      </div>
      <div class="form-group">
        <label class="form-label">Entry Price</label>
        <input id="et-entry" class="form-input" type="number" step="any" value="${t.entry_price}">
      </div>
      <div class="form-group">
        <label class="form-label">Exit Price</label>
        <input id="et-exit" class="form-input" type="number" step="any" value="${t.exit_price || ''}">
      </div>
      <div class="form-group">
        <label class="form-label">Position Size</label>
        <input id="et-size" class="form-input" type="number" step="any" value="${t.position_size}">
      </div>
      <div class="form-group">
        <label class="form-label">Entry Date</label>
        <input id="et-date" class="form-input" type="date" value="${t.entry_date}">
      </div>
      <div class="form-group">
        <label class="form-label">Exit Date</label>
        <input id="et-exit-date" class="form-input" type="date" value="${t.exit_date || ''}">
      </div>
    </div>
    <div class="form-group" style="margin-bottom:12px">
      <label class="form-label">Reason</label>
      <input id="et-reason" class="form-input" value="${t.reason || ''}">
    </div>
    <div class="form-group" style="margin-bottom:18px">
      <label class="form-label">Notes</label>
      <textarea id="et-notes" class="form-textarea">${t.notes || ''}</textarea>
    </div>
    <button class="btn btn-primary" onclick="submitEditTrade(${id})" style="width:100%">Save Changes</button>
  `);
}

async function submitEditTrade(id) {
  try {
    await api.put(`/trades/${id}`, {
      coin: document.getElementById('et-coin').value,
      entry_price: document.getElementById('et-entry').value,
      exit_price: document.getElementById('et-exit').value || null,
      position_size: document.getElementById('et-size').value,
      entry_date: document.getElementById('et-date').value,
      exit_date: document.getElementById('et-exit-date').value || null,
      reason: document.getElementById('et-reason').value,
      notes: document.getElementById('et-notes').value,
    });
    closeModal();
    showToast('Trade updated ✓', 'success');
    renderTrades();
  } catch (e) {
    showToast(e.message, 'error');
  }
}

async function deleteTrade(id) {
  confirmAction('Delete this trade?', async () => {
    try {
      await api.del(`/trades/${id}`);
      showToast('Trade deleted', 'success');
      renderTrades();
    } catch (e) {
      showToast(e.message, 'error');
    }
  });
}
