const _dashCharts = {};

async function renderDashboard() {
  const el = document.getElementById('page-dashboard');
  el.innerHTML = loadingHtml('Loading dashboard');

  let data;
  try {
    data = await api.get('/dashboard/summary');
  } catch (e) {
    el.innerHTML = `<div class="empty-state"><div class="empty-state-text">⚠ Could not connect to backend.</div></div>`;
    return;
  }

  const trades    = data.trades;
  const checkbook = data.checkbook;
  const gambling  = data.gambling;
  const credit    = data.credit   || { total_balance: 0, utilization_pct: null };
  const settings  = data.settings || { starting_capital: 350, current_capital: 350, capital_growth_pct: 0 };
  const portfolio = data.portfolio || { total_value: 0, total_pnl: 0, total_pnl_pct: 0, position_count: 0 };

  const revengeAlert = trades.revenge_alert ? `
    <div class="alert-banner alert-revenge">
      <span class="alert-icon">⚠</span>
      <div><strong>REVENGE TRADING ALERT</strong> — Last 3 closed trades were losses. Step back before your next entry.</div>
    </div>` : '';

  el.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">Dashboard</div>
        <div class="page-subtitle">${new Date().toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'})}</div>
      </div>
      <button class="btn btn-ghost btn-sm" onclick="navigateTo('charts')">Full Analytics →</button>
    </div>

    ${revengeAlert}

    <!-- Net Worth Hero -->
    <div id="nw-hero-container" style="margin-bottom:20px"></div>

    <!-- Stat row -->
    <div class="stat-grid" style="margin-bottom:20px">
      <div class="stat-card ${settings.capital_growth_pct>=0?'':'red'}" style="cursor:pointer"
        onclick="openCapitalChart()">
        <div class="stat-label">Capital Growth ↗</div>
        <div class="stat-value ${settings.capital_growth_pct>=0?'pos':'neg'}">
          ${settings.capital_growth_pct>=0?'+':''}${settings.capital_growth_pct}%
        </div>
        <div class="stat-sub">$${settings.starting_capital} → $${settings.current_capital}</div>
      </div>
      <div class="stat-card ${trades.win_rate>=50?'':'red'}" style="cursor:pointer"
        onclick="openWinRateChart()">
        <div class="stat-label">Win Rate ↗</div>
        <div class="stat-value ${trades.win_rate>=50?'pos':'neg'}">${trades.win_rate}%</div>
        <div class="stat-sub">${trades.total_wins||0}W / ${trades.total_losses||0}L · ${trades.open_trades} open</div>
      </div>
      <div class="stat-card cyan" style="cursor:pointer" onclick="openCashFlowChart()">
        <div class="stat-label">Cash Balance ↗</div>
        <div class="stat-value neutral">$${checkbook.balance.toFixed(2)}</div>
        <div class="stat-sub">+$${checkbook.total_income.toFixed(0)} in · -$${checkbook.total_expenses.toFixed(0)} out</div>
      </div>
      <div class="stat-card ${credit.total_balance>0?'red':''}" style="cursor:pointer"
        onclick="openCreditTrendChart()">
        <div class="stat-label">Credit Owed ↗</div>
        <div class="stat-value ${credit.total_balance>0?'neg':'pos'}">$${(credit.total_balance||0).toFixed(2)}</div>
        <div class="stat-sub">${credit.utilization_pct!==null?credit.utilization_pct+'% utilized':'No limit set'}</div>
      </div>
    </div>

    <!-- Top news strip -->
    <div id="dash-news-strip" style="margin-bottom:20px"></div>

    <!-- Module cards with sparklines -->
    <div class="dash-modules">

      <div class="dash-module" onclick="navigateTo('trades')">
        <div class="module-header">
          <div class="module-title">Trade Journal</div>
          <span class="module-icon">◇</span>
        </div>
        <div class="module-pnl ${trades.total_pnl>=0?'pos':'neg'}">
          ${trades.total_pnl>=0?'+':''}$${Math.abs(trades.total_pnl).toFixed(2)}
        </div>
        <div class="spark-wrap"><canvas id="dash-spark-trades" data-height="55"></canvas></div>
        <div class="module-meta">
          <div class="meta-item">Win rate <span>${trades.win_rate}%</span></div>
          <div class="meta-item">P.Factor <span>${trades.profit_factor||'—'}</span></div>
        </div>
      </div>

      <div class="dash-module" onclick="navigateTo('checkbook')">
        <div class="module-header">
          <div class="module-title">Checkbook</div>
          <span class="module-icon" style="color:var(--cyan)">◻</span>
        </div>
        <div class="module-pnl ${checkbook.balance>=0?'neutral':'neg'}">$${checkbook.balance.toFixed(2)}</div>
        <div class="spark-wrap"><canvas id="dash-spark-cash" data-height="55"></canvas></div>
        <div class="module-meta">
          <div class="meta-item">In <span style="color:var(--green)">+$${checkbook.total_income.toFixed(0)}</span></div>
          <div class="meta-item">Out <span style="color:var(--red)">-$${checkbook.total_expenses.toFixed(0)}</span></div>
        </div>
      </div>

      <div class="dash-module" onclick="navigateTo('stocks')">
        <div class="module-header">
          <div class="module-title">Stocks</div>
          <span class="module-icon" style="color:var(--purple)">◈</span>
        </div>
        <div class="module-pnl ${portfolio.total_pnl>=0?'pos':'neg'}">
          ${portfolio.total_pnl>=0?'+':''}$${Math.abs(portfolio.total_pnl||0).toFixed(2)}
        </div>
        <div class="module-meta">
          <div class="meta-item">Value <span>$${(portfolio.total_value||0).toFixed(2)}</span></div>
          <div class="meta-item">Return <span class="${portfolio.total_pnl_pct>=0?'pos':'neg'}">${portfolio.total_pnl_pct>=0?'+':''}${(portfolio.total_pnl_pct||0).toFixed(1)}%</span></div>
        </div>
      </div>

      <div class="dash-module" onclick="navigateTo('gambling')">
        <div class="module-header">
          <div class="module-title">Gambling</div>
          <span class="module-icon" style="color:var(--yellow)">◈</span>
        </div>
        <div class="module-pnl ${gambling.net_pnl>=0?'pos':'neg'}">
          ${gambling.net_pnl>=0?'+':''}$${Math.abs(gambling.net_pnl).toFixed(2)}
        </div>
        <div class="spark-wrap"><canvas id="dash-spark-gamble" data-height="55"></canvas></div>
        <div class="module-meta">
          <div class="meta-item">Wagered <span>$${gambling.total_wagered.toFixed(0)}</span></div>
          <div class="meta-item">ROI <span>${gambling.roi_pct}%</span></div>
        </div>
      </div>

      <div class="dash-module" onclick="navigateTo('market')">
        <div class="module-header">
          <div class="module-title">Market</div>
          <span class="module-icon" style="color:var(--cyan)">◉</span>
        </div>
        <div style="font-size:0.8rem;color:var(--text-2);margin:8px 0 12px">Live crypto prices</div>
        <div class="module-meta">
          <div class="meta-item">Watched <span id="dash-wl-count">—</span></div>
          <div class="meta-item">Alerts <span id="dash-alert-count">—</span></div>
        </div>
      </div>

      <div class="dash-module" onclick="navigateTo('charts')">
        <div class="module-header">
          <div class="module-title">Analytics</div>
          <span class="module-icon" style="color:var(--accent)">╱</span>
        </div>
        <div style="font-size:0.8rem;color:var(--text-2);margin:8px 0 12px">Charts & trends</div>
        <div class="module-meta">
          <div class="meta-item">Risk/trade <span>$${settings.risk_per_trade||'—'}</span></div>
          <div class="meta-item">Max pos <span>${settings.max_open_positions||3}</span></div>
        </div>
      </div>

    </div>
  `;

  // Net worth hero
  renderNetWorthHero('nw-hero-container');

  // Sparklines
  requestAnimationFrame(() => _mountDashSparklines());

  // Watchlist pill
  _loadDashWatchlistCount();
}

async function _mountDashSparklines() {
  try {
    const [tradeChart, cashChart, gambChart] = await Promise.all([
      api.get('/charts/trades?range=1m').catch(() => null),
      api.get('/charts/spending?range=1m').catch(() => null),
      api.get('/charts/gambling?range=1m').catch(() => null),
    ]);

    if (tradeChart?.cumulative_pnl?.length > 1)
      _spark('dash-spark-trades', tradeChart.cumulative_pnl);
    if (cashChart?.balance?.length > 1)
      _spark('dash-spark-cash', cashChart.balance, '#00d2ff');
    if (gambChart?.cumulative_pnl?.length > 1)
      _spark('dash-spark-gamble', gambChart.cumulative_pnl);
  } catch (e) { /* sparklines optional */ }
  loadDashNewsStrip()
}

function _spark(id, points, color) {
  if (_dashCharts[id]) { _dashCharts[id].destroy(); delete _dashCharts[id]; }
  const canvas = document.getElementById(id);
  if (!canvas) return;
  const chart = new LineChart(canvas, {
    sparkline: true,
    splitFill: true,
    animate: true,
    animDuration: 700,
    zeroLine: false,
  });
  const last = points[points.length - 1]?.v ?? 0;
  chart.setData([{ color: color || (last >= 0 ? '#00e676' : '#ff4757'), points }], '1m');
  _dashCharts[id] = chart;
}

async function _loadDashWatchlistCount() {
  try {
    const wl = await api.get('/market/watchlist');
    const ce = document.getElementById('dash-wl-count');
    const ae = document.getElementById('dash-alert-count');
    if (ce) ce.textContent = wl.length;
    if (ae) {
      const alerts = wl.filter(w => w.market?.alert_24h).length;
      ae.innerHTML = alerts > 0
        ? `<span class="pos">${alerts} moving</span>`
        : `<span style="color:var(--text-3)">None</span>`;
    }
  } catch (e) { /* ignore */ }
}

async function openCapitalChart() {
  openChartModal('Capital Growth', 'Trade P&L vs starting capital over time',
    lineCanvasBlock('modal-capital', 240));
  try {
    const data = await api.get('/charts/trades?range=all');
    const pts  = data.cumulative_pnl || [];
    _mountModalLine('modal-capital', [{ label: 'Cumulative P&L', points: pts }], 'all', 240);
  } catch(e) { showToast(e.message, 'error'); }
}

async function openWinRateChart() {
  openChartModal('Win / Loss by Coin', 'Net P&L per coin traded (bar = net result)',
    barCanvasBlock('modal-winrate', 240));
  try {
    const trades = await api.get('/trades/');
    const closed = trades.filter(t => t.status === 'closed' && t.pnl !== null);
    const byCoins = {};
    for (const t of closed) {
      byCoins[t.coin] = (byCoins[t.coin] || 0) + (t.pnl || 0);
    }
    const data = Object.entries(byCoins)
      .sort((a,b) => b[1] - a[1])
      .map(([label, value]) => ({ label, value: parseFloat(value.toFixed(2)) }));
    _mountModalBar('modal-winrate', data);
  } catch(e) { showToast(e.message, 'error'); }
}

async function openCashFlowChart() {
  openChartModal('Cash Flow', 'Running balance over time',
    lineCanvasBlock('modal-cashflow', 240));
  try {
    const data = await api.get('/charts/spending?range=all');
    _mountModalLine('modal-cashflow', [
      { label: 'Balance',  color: '#00d2ff', points: data.balance  || [] },
      { label: 'Income',   color: '#00e676', points: data.income   || [] },
      { label: 'Expenses', color: '#ff4757', points: data.expenses || [] },
    ], 'all', 240);
  } catch(e) { showToast(e.message, 'error'); }
}

async function openCreditTrendChart() {
  openChartModal('Credit Balance', 'Charges vs payments over time',
    lineCanvasBlock('modal-credit', 240));
  try {
    const data = await api.get('/charts/spending?range=all');
    _mountModalLine('modal-credit', [
      { label: 'Balance', color: '#ff4757', points: data.balance || [] }
    ], 'all', 240);
  } catch(e) { showToast(e.message, 'error'); }
}

async function loadDashNewsStrip() {
  const el = document.getElementById('dash-news-strip');
  if (!el) return;
  try {
    const data = await api.get('/news/?limit=4');
    const articles = (data.articles || []).slice(0, 4);
    if (!articles.length) { el.innerHTML = ''; return; }

    el.innerHTML = `
      <div class="card" style="padding:14px 16px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
          <div class="card-title" style="margin:0">Top Headlines</div>
          <button class="btn btn-ghost btn-sm" onclick="navigateTo('news')" style="font-size:0.7rem">View all →</button>
        </div>
        <div style="display:flex;flex-direction:column;gap:6px">
          ${articles.map(a => `
            <a href="${a.link}" target="_blank" rel="noopener noreferrer"
              style="display:flex;justify-content:space-between;align-items:center;gap:12px;
                     padding:6px 0;border-bottom:1px solid var(--border);text-decoration:none;
                     color:var(--text);transition:color 0.15s"
              onmouseover="this.style.color='var(--accent)'"
              onmouseout="this.style.color='var(--text)'">
              <div style="display:flex;align-items:center;gap:8px;flex:1;min-width:0">
                <div class="sentiment-dot sentiment-dot-${a.sentiment}"></div>
                <span style="font-size:0.78rem;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
                  ${a.title}
                </span>
              </div>
              <div style="display:flex;align-items:center;gap:8px;flex-shrink:0">
                <span style="font-size:0.65rem;color:var(--text-3)">${a.source}</span>
                <span style="font-size:0.65rem;color:var(--text-3)">${_dashFmtAge(a.age_hours)}</span>
              </div>
            </a>
          `).join('')}
        </div>
      </div>
    `;
  } catch (e) { el.innerHTML = ''; }
}

function _dashFmtAge(h) {
  if (!h && h !== 0) return '';
  h = parseFloat(h);
  if (h < 1)  return `${Math.round(h*60)}m`;
  if (h < 24) return `${Math.round(h)}h`;
  return `${Math.round(h/24)}d`;
}