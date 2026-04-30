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
      <div class="stat-card" style="cursor:pointer" onclick="openTradePnlLineChart()">
        <div class="stat-label">Total P&L ↗</div>
        <div class="stat-value ${pnlClass(stats.total_pnl)}">${stats.total_pnl >= 0 ? '+' : ''}$${Math.abs(stats.total_pnl).toFixed(2)}</div>
        <div class="stat-sub">${stats.total_trades} closed trades</div>
      </div>
      <div class="stat-card ${stats.win_rate>=50?'':'red'}" style="cursor:pointer" onclick="openTradeWinLossBar()">
        <div class="stat-label">Win Rate ↗</div>
        <div class="stat-value ${stats.win_rate >= 50 ? 'pos' : 'neg'}">${stats.win_rate}%</div>
        <div class="stat-sub">${stats.total_wins}W / ${stats.total_losses}L</div>
      </div>
      <div class="stat-card" style="cursor:pointer" onclick="openTradeAvgBar()">
        <div class="stat-label">Avg Win ↗</div>
        <div class="stat-value pos">+$${Math.abs(stats.avg_win).toFixed(2)}</div>
        <div class="stat-sub">per winning trade</div>
      </div>
      <div class="stat-card red" style="cursor:pointer" onclick="openTradeAvgBar()">
        <div class="stat-label">Avg Loss ↗</div>
        <div class="stat-value neg">-$${Math.abs(stats.avg_loss).toFixed(2)}</div>
        <div class="stat-sub">per losing trade</div>
      </div>
      ${stats.profit_factor !== null ? `
      <div class="stat-card cyan" style="cursor:pointer" onclick="openTradePnlLineChart()">
        <div class="stat-label">Profit Factor ↗</div>
        <div class="stat-value neutral">${stats.profit_factor}x</div>
        <div class="stat-sub">gross win / gross loss</div>
      </div>` : ''}
      <div class="stat-card yellow" style="cursor:pointer" onclick="openOpenPositionsBar()">
        <div class="stat-label">Open Trades ↗</div>
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

  const TRADES_CHART_BLOCK = `
    <!-- Trade P&L Chart -->
    <div class="chart-card trades-chart-section">
      <div class="chart-card-header">
        <div>
          <div class="chart-title">Cumulative P&L</div>
          <div class="chart-subtitle">Closed trades only</div>
        </div>
        <div class="range-bar" style="gap:2px">
          ${['1w','1m','3m','6m','1y','all'].map(r =>
            `<button class="range-btn trades-range-btn ${r === '1m' ? 'active' : ''}"
              data-range="${r}" onclick="loadTradesPnlChart('${r}')">${r.toUpperCase()}</button>`
          ).join('')}
        </div>
      </div>
      <div id="trades-chart-canvas-wrap" class="chart-wrap" style="height:200px">
        <div class="loading dot-anim" style="padding:20px;text-align:center">Loading chart</div>
      </div>
    </div>
  `;

  loadTradesPnlChart(_tradesChartRange);
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

let _tradesChartRange = '1m';
let _tradesChartInst = null;

async function loadTradesPnlChart(range) {
  _tradesChartRange = range;

  // Update range buttons
  document.querySelectorAll('.trades-range-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.range === range);
  });

  const wrap = document.getElementById('trades-chart-canvas-wrap');
  if (!wrap) return;
  wrap.innerHTML = '<div class="loading dot-anim" style="padding:20px;text-align:center">Loading chart</div>';

  try {
    const data = await api.get(`/charts/trades?range=${range}`);
    const pts = data.cumulative_pnl || [];

    if (pts.length < 2) {
      wrap.innerHTML = `<div style="color:var(--text-3);font-size:0.78rem;padding:24px;text-align:center">
        Not enough closed trades for this range yet</div>`;
      return;
    }

    wrap.innerHTML = `<canvas id="trades-pnl-canvas"></canvas>`;

    if (_tradesChartInst) { _tradesChartInst.destroy(); _tradesChartInst = null; }
    const canvas = document.getElementById('trades-pnl-canvas');
    canvas.dataset.height = '200';

    _tradesChartInst = new LineChart(canvas, {
      formatTooltipValue: v => (v >= 0 ? '+' : '') + '$' + Math.abs(parseFloat(v)).toFixed(2),
      formatTooltipDate: (t, r) => {
        const d = new Date(t.includes('T') ? t : t + 'T00:00:00');
        return d.toLocaleDateString('en-US', { weekday:'short', month:'short', day:'numeric' });
      },
      rangeKey: range,
    });
    _tradesChartInst.setData([{ label: 'Cumulative P&L', points: pts }], range);

  } catch (e) {
    if (wrap) wrap.innerHTML = `<div style="color:var(--red);font-size:0.78rem;padding:20px">${e.message}</div>`;
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

async function openTradePnlLineChart() {
  openChartModal('Cumulative P&L', 'All closed trades',
    `${rangeBar('1m','_tradeLineRange')}${lineCanvasBlock('modal-trade-line', 240)}`);
  window._tradeLineRangeKey = '1m';
  await _loadTradeLineChart('1m');
}

window._tradeLineRange = async function(range) {
  window._tradeLineRangeKey = range;
  document.querySelectorAll('#modal-content .range-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.range === range));
  await _loadTradeLineChart(range);
};

async function _loadTradeLineChart(range) {
  try {
    const data = await api.get(`/charts/trades?range=${range}`);
    _mountModalLine('modal-trade-line', [{ label: 'P&L', points: data.cumulative_pnl || [] }], range, 240);
  } catch(e) { showToast(e.message,'error'); }
}

async function openTradeWinLossBar() {
  openChartModal('Win / Loss by Coin', 'Net P&L per coin',
    barCanvasBlock('modal-wl-bar', 240));
  try {
    const trades = await api.get('/trades/');
    const closed = trades.filter(t => t.status === 'closed' && t.pnl !== null);
    const byCoins = {};
    for (const t of closed) byCoins[t.coin] = (byCoins[t.coin] || 0) + (t.pnl || 0);
    const data = Object.entries(byCoins)
      .sort((a,b) => b[1]-a[1])
      .map(([label, value]) => ({ label, value: parseFloat(value.toFixed(2)) }));
    _mountModalBar('modal-wl-bar', data);
  } catch(e) { showToast(e.message,'error'); }
}

async function openTradeAvgBar() {
  openChartModal('Avg Win vs Avg Loss', 'Per-coin average',
    barCanvasBlock('modal-avg-bar', 240));
  try {
    const trades = await api.get('/trades/');
    const closed = trades.filter(t => t.status === 'closed' && t.pnl !== null);
    const byCoins = {};
    for (const t of closed) {
      if (!byCoins[t.coin]) byCoins[t.coin] = { wins: [], losses: [] };
      if (t.pnl > 0) byCoins[t.coin].wins.push(t.pnl);
      else byCoins[t.coin].losses.push(t.pnl);
    }
    const data = Object.entries(byCoins).flatMap(([coin, { wins, losses }]) => [
      { label: `${coin} W`, value: wins.length ? +(wins.reduce((a,b)=>a+b,0)/wins.length).toFixed(2) : 0, color: '#00e676' },
      { label: `${coin} L`, value: losses.length ? +(losses.reduce((a,b)=>a+b,0)/losses.length).toFixed(2) : 0, color: '#ff4757' },
    ]);
    _mountModalBar('modal-avg-bar', data);
  } catch(e) { showToast(e.message,'error'); }
}

async function openOpenPositionsBar() {
  openChartModal('Open Positions', 'Current unrealized exposure by coin',
    barCanvasBlock('modal-open-bar', 220));
  try {
    const trades = await api.get('/trades/');
    const open = trades.filter(t => t.status === 'open');
    const data = open.map(t => ({
      label: t.coin,
      value: parseFloat((t.position_size * t.entry_price).toFixed(2)),
      color: '#ffd32a'
    }));
    if (!data.length) {
      document.getElementById('modal-content').innerHTML += 
        `<div style="color:var(--text-3);padding:20px;text-align:center">No open trades</div>`;
      return;
    }
    _mountModalBar('modal-open-bar', data, {
      formatValue: v => '$' + Math.abs(v).toFixed(0),
      formatTooltipValue: v => '$' + parseFloat(v).toFixed(2) + ' exposure'
    });
  } catch(e) { showToast(e.message,'error'); }
}