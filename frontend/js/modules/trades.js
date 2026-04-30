let tradesData = [];
let tradesFilter = 'all';
let _safeguardState = null;

const STRATEGY_OPTIONS = [
  { id: 'general',      label: 'General',        cls: '' },
  { id: 'breakout',     label: 'Breakout',        cls: 'tag-breakout' },
  { id: 'bounce',       label: 'Support Bounce',  cls: 'tag-bounce' },
  { id: 'trend',        label: 'Trend Follow',    cls: 'tag-trend' },
  { id: 'reversal',     label: 'Reversal',        cls: 'tag-reversal' },
  { id: 'scalp',        label: 'Scalp',           cls: 'tag-scalp' },
  { id: 'news',         label: 'News Play',       cls: 'tag-news' },
];

function _strategyTag(strategy) {
  const s = STRATEGY_OPTIONS.find(x => x.id === strategy) || STRATEGY_OPTIONS[0];
  if (!s.id || s.id === 'general') return '';
  return `<span class="strategy-tag ${s.cls}">${s.label}</span>`;
}

async function renderTrades() {
  const el = document.getElementById('page-trades');
  el.innerHTML = loadingHtml('Loading trades');

  try {
    const [trades, stats, safeguard] = await Promise.all([
      api.get('/trades/'),
      api.get('/trades/stats'),
      api.get('/safeguards/state').catch(() => null),
    ]);
    tradesData = trades;
    _safeguardState = safeguard;
    renderTradesView(el, trades, stats, safeguard);
  } catch (e) {
    el.innerHTML = `<p style="color:var(--red);padding:20px">Error: ${e.message}</p>`;
  }
}

function renderTradesView(el, trades, stats, safeguard) {
  const revengeAlert = (stats.revenge_trading_alert || safeguard?.active) ? `
    <div class="alert-banner alert-revenge">
      <span class="alert-icon">⚠</span>
      <div>
        <strong>${safeguard?.active ? 'COOLDOWN ACTIVE' : 'REVENGE TRADING ALERT'}</strong>
        — ${safeguard?.message || '3 consecutive losses detected. Step back before your next trade.'}
        ${safeguard?.active ? `
          <div style="margin-top:6px;font-size:0.75rem;opacity:0.85">
            Cooldown ends: ${safeguard.cooldown_ends ? new Date(safeguard.cooldown_ends).toLocaleString() : 'unknown'}
            <button class="btn btn-sm btn-ghost" style="margin-left:12px;padding:3px 10px;font-size:0.7rem"
              onclick="overrideSafeguard()">Override (I understand the risk)</button>
          </div>` : ''}
      </div>
    </div>` : '';

  // Per-strategy breakdown
  const strategyStats = _calcStrategyStats(trades.filter(t => t.status === 'closed' && t.pnl !== null));

  const filtered = tradesFilter === 'all' ? trades
    : tradesFilter === 'open' ? trades.filter(t => t.status === 'open')
    : trades.filter(t => t.status === 'closed');

  const tableRows = filtered.length === 0
    ? `<tr class="empty-row"><td colspan="10">${emptyStateHtml('◇', 'No trades yet')}</td></tr>`
    : filtered.map(t => `
        <tr>
          <td>
            <strong>${t.coin}</strong>
            ${t.strategy && t.strategy !== 'general' ? `<br>${_strategyTag(t.strategy)}` : ''}
          </td>
          <td><span class="badge ${t.direction==='long'?'badge-green':'badge-red'}">${t.direction}</span></td>
          <td>$${parseFloat(t.entry_price).toFixed(4)}</td>
          <td>${t.exit_price ? '$' + parseFloat(t.exit_price).toFixed(4) : '<span class="zero">—</span>'}</td>
          <td>${t.position_size}</td>
          <td>${fmtPnl(t.pnl)}</td>
          <td>${t.pnl_pct !== null ? fmtPct(t.pnl_pct) : '—'}</td>
          <td><span class="badge ${t.status==='open'?'badge-yellow':t.pnl>0?'badge-green':'badge-red'}">${t.status}</span></td>
          <td style="color:var(--text-3);font-size:0.72rem;max-width:120px;overflow:hidden;text-overflow:ellipsis">${t.reason||'—'}</td>
          <td>
            <div class="row-actions">
              ${t.status==='open'?`<button class="btn btn-sm btn-primary" onclick="openCloseTradeModal(${t.id})">Close</button>`:''}
              <button class="btn btn-sm btn-ghost btn-icon" onclick="openEditTradeModal(${t.id})">✎</button>
              <button class="btn btn-sm btn-danger btn-icon" onclick="deleteTrade(${t.id})">✕</button>
            </div>
          </td>
        </tr>`).join('');

  el.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">Trade Journal</div>
        <div class="page-subtitle">Crypto swing trades</div>
      </div>
      <button class="btn btn-primary" onclick="openNewTradeModal()"
        ${safeguard?.active ? 'style="opacity:0.5"' : ''}>+ New Trade</button>
    </div>

    ${revengeAlert}

    <div class="stat-grid">
      <div class="stat-card" style="cursor:pointer" onclick="openTradePnlLineChart()">
        <div class="stat-label">Total P&L ↗</div>
        <div class="stat-value ${pnlClass(stats.total_pnl)}">${stats.total_pnl>=0?'+':''}$${Math.abs(stats.total_pnl).toFixed(2)}</div>
        <div class="stat-sub">${stats.total_trades} closed trades</div>
      </div>
      <div class="stat-card ${stats.win_rate>=50?'':'red'}" style="cursor:pointer" onclick="openTradeWinLossBar()">
        <div class="stat-label">Win Rate ↗</div>
        <div class="stat-value ${stats.win_rate>=50?'pos':'neg'}">${stats.win_rate}%</div>
        <div class="stat-sub">${stats.total_wins}W / ${stats.total_losses}L</div>
      </div>
      <div class="stat-card" style="cursor:pointer" onclick="openTradeAvgBar()">
        <div class="stat-label">Avg Win ↗</div>
        <div class="stat-value pos">+$${Math.abs(stats.avg_win).toFixed(2)}</div>
      </div>
      <div class="stat-card red" style="cursor:pointer" onclick="openTradeAvgBar()">
        <div class="stat-label">Avg Loss ↗</div>
        <div class="stat-value neg">-$${Math.abs(stats.avg_loss).toFixed(2)}</div>
      </div>
      ${stats.profit_factor !== null ? `
      <div class="stat-card cyan" style="cursor:pointer" onclick="openTradePnlLineChart()">
        <div class="stat-label">Profit Factor ↗</div>
        <div class="stat-value neutral">${stats.profit_factor}x</div>
      </div>` : ''}
      <div class="stat-card yellow" style="cursor:pointer" onclick="openOpenPositionsBar()">
        <div class="stat-label">Open Trades ↗</div>
        <div class="stat-value" style="color:var(--yellow)">${stats.open_trades}</div>
      </div>
    </div>

    <!-- P&L chart -->
    <div class="chart-card trades-chart-section">
      <div class="chart-card-header">
        <div><div class="chart-title">Cumulative P&L</div><div class="chart-subtitle">Closed trades only</div></div>
        <div class="range-bar">
          ${['1w','1m','3m','6m','1y','all'].map(r =>
            `<button class="range-btn trades-range-btn ${r==='1m'?'active':''}" data-range="${r}"
              onclick="loadTradesPnlChart('${r}')">${r.toUpperCase()}</button>`
          ).join('')}
        </div>
      </div>
      <div id="trades-chart-canvas-wrap" class="chart-wrap" style="height:200px">
        <div class="loading dot-anim" style="padding:20px;text-align:center">Loading chart</div>
      </div>
    </div>

    <!-- Strategy breakdown -->
    ${strategyStats.length > 1 ? `
    <div class="chart-card" style="margin-bottom:20px">
      <div class="chart-card-header">
        <div class="chart-title">P&L by Strategy</div>
        <div class="chart-subtitle">Which setups are actually working</div>
      </div>
      <div style="display:flex;flex-direction:column;gap:8px;margin-top:4px">
        ${strategyStats.map(s => `
          <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border)">
            <div style="display:flex;align-items:center;gap:10px">
              ${_strategyTag(s.strategy) || `<span style="font-size:0.78rem;color:var(--text-2)">${s.strategy}</span>`}
              <span style="font-size:0.7rem;color:var(--text-3)">${s.count} trades · ${s.win_rate}% WR</span>
            </div>
            <span class="${s.total_pnl>=0?'pos':'neg'}" style="font-weight:600">
              ${s.total_pnl>=0?'+':''}$${Math.abs(s.total_pnl).toFixed(2)}
            </span>
          </div>`).join('')}
      </div>
    </div>` : ''}

    <div class="action-row">
      <div class="action-filters">
        <button class="btn btn-sm ${tradesFilter==='all'?'btn-primary':'btn-ghost'}" onclick="setTradesFilter('all')">All</button>
        <button class="btn btn-sm ${tradesFilter==='open'?'btn-primary':'btn-ghost'}" onclick="setTradesFilter('open')">Open</button>
        <button class="btn btn-sm ${tradesFilter==='closed'?'btn-primary':'btn-ghost'}" onclick="setTradesFilter('closed')">Closed</button>
      </div>
      <span style="font-size:0.72rem;color:var(--text-3)">${filtered.length} trade${filtered.length!==1?'s':''}</span>
    </div>

    <div class="table-wrap">
      <table>
        <thead>
          <tr><th>Coin</th><th>Dir</th><th>Entry</th><th>Exit</th><th>Size</th>
          <th>P&L</th><th>%</th><th>Status</th><th>Reason</th><th>Actions</th></tr>
        </thead>
        <tbody>${tableRows}</tbody>
      </table>
    </div>
  `;

  loadTradesPnlChart('1m');
}

function _calcStrategyStats(closedTrades) {
  const byStrategy = {};
  for (const t of closedTrades) {
    const s = t.strategy || 'general';
    if (!byStrategy[s]) byStrategy[s] = { count: 0, wins: 0, total_pnl: 0 };
    byStrategy[s].count++;
    byStrategy[s].total_pnl += t.pnl || 0;
    if ((t.pnl || 0) > 0) byStrategy[s].wins++;
  }
  return Object.entries(byStrategy)
    .map(([strategy, d]) => ({
      strategy,
      count: d.count,
      total_pnl: parseFloat(d.total_pnl.toFixed(2)),
      win_rate: d.count ? Math.round(d.wins / d.count * 100) : 0,
    }))
    .sort((a,b) => b.total_pnl - a.total_pnl);
}

function setTradesFilter(f) {
  tradesFilter = f;
  renderTrades();
}

// ── Safeguard override ───────────────────────────────────────────────────────
async function overrideSafeguard() {
  try {
    await api.post('/safeguards/override', {});
    showToast('Override recorded. Trade carefully.', 'success');
    _safeguardState = null;
    renderTrades();
  } catch (e) {
    showToast(e.message, 'error');
  }
}

// ── P&L chart ────────────────────────────────────────────────────────────────
let _tradesChartRange = '1m';
let _tradesChartInst = null;

async function loadTradesPnlChart(range) {
  _tradesChartRange = range;
  document.querySelectorAll('.trades-range-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.range === range));
  const wrap = document.getElementById('trades-chart-canvas-wrap');
  if (!wrap) return;
  wrap.innerHTML = '<div class="loading dot-anim" style="padding:20px;text-align:center">Loading</div>';
  try {
    const data = await api.get(`/charts/trades?range=${range}`);
    const pts  = data.cumulative_pnl || [];
    if (pts.length < 2) {
      wrap.innerHTML = `<div style="color:var(--text-3);font-size:0.78rem;padding:20px;text-align:center">Not enough closed trades</div>`;
      return;
    }
    wrap.innerHTML = `<canvas id="trades-pnl-canvas" data-height="200"></canvas>`;
    if (_tradesChartInst) { _tradesChartInst.destroy(); _tradesChartInst = null; }
    const canvas = document.getElementById('trades-pnl-canvas');
    _tradesChartInst = new LineChart(canvas, {
      formatTooltipValue: v => (v>=0?'+':'') + '$' + Math.abs(parseFloat(v)).toFixed(2),
      formatTooltipDate: t => {
        const d = new Date(t.includes('T') ? t : t+'T00:00:00');
        return d.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'});
      },
      splitFill: true, rangeKey: range,
    });
    _tradesChartInst.setData([{ label: 'Cumulative P&L', points: pts }], range);
  } catch(e) {
    if (wrap) wrap.innerHTML = `<div style="color:var(--red);font-size:0.78rem;padding:20px">${e.message}</div>`;
  }
}

// ── New trade modal with strategy tags ───────────────────────────────────────
function openNewTradeModal() {
  if (_safeguardState?.active) {
    if (!confirm(`⚠ SAFEGUARD ACTIVE: ${_safeguardState.message}\n\nAre you sure you want to open a new trade?`)) return;
  }
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
      <div class="form-group">
        <label class="form-label">Strategy</label>
        <select id="t-strategy" class="form-select">
          ${STRATEGY_OPTIONS.map(s => `<option value="${s.id}">${s.label}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="form-group" style="margin-bottom:12px">
      <label class="form-label">Reason for Trade</label>
      <input id="t-reason" class="form-input" placeholder="Setup, signal, thesis…">
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
  document.getElementById('dir-long').className = `radio-btn ${dir==='long'?'active-long':''}`;
  document.getElementById('dir-short').className = `radio-btn ${dir==='short'?'active-short':''}`;
}

async function submitNewTrade() {
  const coin  = document.getElementById('t-coin').value.trim();
  const entry = document.getElementById('t-entry').value;
  const size  = document.getElementById('t-size').value;
  const date  = document.getElementById('t-date').value;
  if (!coin || !entry || !size || !date) { showToast('Fill in required fields','error'); return; }
  try {
    await api.post('/trades/', {
      coin, entry_price: entry, position_size: size, entry_date: date,
      direction: window._tradeDir || 'long',
      exit_price:    document.getElementById('t-exit').value || null,
      exit_date:     document.getElementById('t-exit-date').value || null,
      reason:        document.getElementById('t-reason').value,
      notes:         document.getElementById('t-notes').value,
      strategy:      document.getElementById('t-strategy').value,
    });
    closeModal();
    showToast('Trade logged ✓','success');
    renderTrades();
  } catch(e) { showToast(e.message,'error'); }
}

// ── Close / Edit / Delete (unchanged from before) ───────────────────────────
function openCloseTradeModal(id) {
  const trade = tradesData.find(t => t.id === id);
  if (!trade) return;
  openModal(`
    <div class="modal-title">Close Trade — ${trade.coin}</div>
    <div style="margin-bottom:14px;font-size:0.8rem;color:var(--text-2)">
      Entry: $${trade.entry_price} · Size: ${trade.position_size} · ${trade.direction}
    </div>
    <div class="form-grid">
      <div class="form-group">
        <label class="form-label">Exit Price ($)</label>
        <input id="close-exit" class="form-input" type="number" step="any">
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
  if (!exit) { showToast('Enter exit price','error'); return; }
  try {
    await api.put(`/trades/${id}`, {
      exit_price: exit, exit_date: document.getElementById('close-date').value,
      notes: document.getElementById('close-notes').value, status: 'closed'
    });
    closeModal(); showToast('Trade closed ✓','success'); renderTrades();
  } catch(e) { showToast(e.message,'error'); }
}

function openEditTradeModal(id) {
  const t = tradesData.find(x => x.id === id);
  if (!t) return;
  openModal(`
    <div class="modal-title">Edit Trade — ${t.coin}</div>
    <div class="form-grid">
      <div class="form-group"><label class="form-label">Coin</label><input id="et-coin" class="form-input" value="${t.coin}"></div>
      <div class="form-group"><label class="form-label">Entry Price</label><input id="et-entry" class="form-input" type="number" step="any" value="${t.entry_price}"></div>
      <div class="form-group"><label class="form-label">Exit Price</label><input id="et-exit" class="form-input" type="number" step="any" value="${t.exit_price||''}"></div>
      <div class="form-group"><label class="form-label">Position Size</label><input id="et-size" class="form-input" type="number" step="any" value="${t.position_size}"></div>
      <div class="form-group"><label class="form-label">Entry Date</label><input id="et-date" class="form-input" type="date" value="${t.entry_date}"></div>
      <div class="form-group"><label class="form-label">Exit Date</label><input id="et-exit-date" class="form-input" type="date" value="${t.exit_date||''}"></div>
      <div class="form-group">
        <label class="form-label">Strategy</label>
        <select id="et-strategy" class="form-select">
          ${STRATEGY_OPTIONS.map(s => `<option value="${s.id}" ${t.strategy===s.id?'selected':''}>${s.label}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="form-group" style="margin-bottom:12px"><label class="form-label">Reason</label><input id="et-reason" class="form-input" value="${t.reason||''}"></div>
    <div class="form-group" style="margin-bottom:18px"><label class="form-label">Notes</label><textarea id="et-notes" class="form-textarea">${t.notes||''}</textarea></div>
    <button class="btn btn-primary" onclick="submitEditTrade(${id})" style="width:100%">Save Changes</button>
  `);
}

async function submitEditTrade(id) {
  try {
    await api.put(`/trades/${id}`, {
      coin:         document.getElementById('et-coin').value,
      entry_price:  document.getElementById('et-entry').value,
      exit_price:   document.getElementById('et-exit').value || null,
      position_size:document.getElementById('et-size').value,
      entry_date:   document.getElementById('et-date').value,
      exit_date:    document.getElementById('et-exit-date').value || null,
      reason:       document.getElementById('et-reason').value,
      notes:        document.getElementById('et-notes').value,
      strategy:     document.getElementById('et-strategy').value,
    });
    closeModal(); showToast('Trade updated ✓','success'); renderTrades();
  } catch(e) { showToast(e.message,'error'); }
}

async function deleteTrade(id) {
  confirmAction('Delete this trade?', async () => {
    try {
      await api.del(`/trades/${id}`);
      showToast('Trade deleted','success');
      renderTrades();
    } catch(e) { showToast(e.message,'error'); }
  });
}

// ── Chart openers (from stage 2d) ────────────────────────────────────────────
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
    _mountModalLine('modal-trade-line',[{label:'P&L',points:data.cumulative_pnl||[]}],range,240);
  } catch(e) { showToast(e.message,'error'); }
}

async function openTradeWinLossBar() {
  openChartModal('Win / Loss by Coin', 'Net P&L per coin', barCanvasBlock('modal-wl-bar', 240));
  try {
    const trades = await api.get('/trades/');
    const closed = trades.filter(t => t.status==='closed' && t.pnl!==null);
    const byCoins = {};
    for (const t of closed) byCoins[t.coin] = (byCoins[t.coin]||0) + (t.pnl||0);
    const data = Object.entries(byCoins).sort((a,b)=>b[1]-a[1])
      .map(([label,value])=>({label,value:parseFloat(value.toFixed(2))}));
    _mountModalBar('modal-wl-bar', data);
  } catch(e) { showToast(e.message,'error'); }
}

async function openTradeAvgBar() {
  openChartModal('Avg Win vs Avg Loss', 'Per-coin average', barCanvasBlock('modal-avg-bar', 240));
  try {
    const trades = await api.get('/trades/');
    const closed = trades.filter(t => t.status==='closed' && t.pnl!==null);
    const byCoins = {};
    for (const t of closed) {
      if (!byCoins[t.coin]) byCoins[t.coin] = {wins:[],losses:[]};
      if (t.pnl > 0) byCoins[t.coin].wins.push(t.pnl);
      else byCoins[t.coin].losses.push(t.pnl);
    }
    const data = Object.entries(byCoins).flatMap(([coin,{wins,losses}]) => [
      {label:`${coin} W`,value:wins.length?+(wins.reduce((a,b)=>a+b,0)/wins.length).toFixed(2):0,color:'#00e676'},
      {label:`${coin} L`,value:losses.length?+(losses.reduce((a,b)=>a+b,0)/losses.length).toFixed(2):0,color:'#ff4757'},
    ]);
    _mountModalBar('modal-avg-bar', data);
  } catch(e) { showToast(e.message,'error'); }
}

async function openOpenPositionsBar() {
  openChartModal('Open Positions', 'Exposure by coin', barCanvasBlock('modal-open-bar', 220));
  try {
    const trades = await api.get('/trades/');
    const open = trades.filter(t => t.status==='open');
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
      formatValue: v => '$'+Math.abs(v).toFixed(0),
      formatTooltipValue: v => '$'+parseFloat(v).toFixed(2)+' exposure'
    });
  } catch(e) { showToast(e.message,'error'); }
}