// modules/backtester.js
// Stage 3 — Strategy backtester UI

let _btChart = null;
let _btLastResult = null;

async function renderBacktester() {
  const el = document.getElementById('page-backtester');

  let strategies = [], symbols = [], settings = {};
  try {
    [strategies, symbols, settings] = await Promise.all([
      api.get('/backtester/strategies'),
      api.get('/backtester/symbols'),
      api.get('/settings/'),
    ]);
  } catch (e) {
    el.innerHTML = `<p style="color:var(--red);padding:20px">Error loading backtester: ${e.message}</p>`;
    return;
  }

  const cap  = settings.starting_capital || 350;
  const risk = settings.risk_per_trade_pct || 2;

  el.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">Backtester</div>
        <div class="page-subtitle">Simulate strategies on historical OHLCV data</div>
      </div>
    </div>

    <div class="bt-layout">

      <!-- Config panel -->
      <div class="bt-config card">
        <div class="card-title" style="margin-bottom:16px">Configuration</div>

        <div class="form-group" style="margin-bottom:12px">
          <label class="form-label">Coin</label>
          <select id="bt-coin" class="form-select">
            ${symbols.map(s => `<option value="${s.coin_id}">${s.symbol}</option>`).join('')}
          </select>
        </div>

        <div class="form-group" style="margin-bottom:12px">
          <label class="form-label">Timeframe</label>
          <select id="bt-tf" class="form-select">
            <option value="1h">1 Hour</option>
            <option value="4h">4 Hour</option>
            <option value="1d" selected>1 Day</option>
            <option value="1w">1 Week</option>
          </select>
        </div>

        <div class="form-group" style="margin-bottom:12px">
          <label class="form-label">Lookback Period (days)</label>
          <input id="bt-days" class="form-input" type="number" value="365" min="30" max="1000">
        </div>

        <div class="form-group" style="margin-bottom:12px">
          <label class="form-label">Strategy</label>
          <select id="bt-strategy" class="form-select" onchange="updateStrategyDesc()">
            ${strategies.map(s =>
              `<option value="${s.id}">${s.label}</option>`
            ).join('')}
          </select>
          <div id="bt-strategy-desc" style="font-size:0.7rem;color:var(--text-3);margin-top:6px;line-height:1.5"></div>
        </div>

        <div class="form-group" style="margin-bottom:12px">
          <label class="form-label">Starting Capital ($)</label>
          <input id="bt-capital" class="form-input" type="number" step="any" value="${cap}">
        </div>

        <div class="form-group" style="margin-bottom:12px">
          <label class="form-label">Risk Per Trade (%)</label>
          <input id="bt-risk" class="form-input" type="number" step="0.1" value="${risk}">
        </div>

        <div class="form-group" style="margin-bottom:20px">
          <label class="form-label">Stop Loss (% from entry, optional)</label>
          <input id="bt-sl" class="form-input" type="number" step="0.5" placeholder="Leave blank for strategy exit">
        </div>

        <button class="btn btn-primary" onclick="runBacktest()" style="width:100%;padding:12px">
          ▶ Run Backtest
        </button>
        <button class="btn btn-ghost" onclick="compareStrategies()" style="width:100%;margin-top:8px">
          Compare All Strategies
        </button>
      </div>

      <!-- Results panel -->
      <div class="bt-results" id="bt-results">
        <div class="bt-placeholder">
          <div style="font-size:36px;margin-bottom:12px">◇</div>
          <div style="font-size:0.85rem;color:var(--text-3)">Configure and run a backtest to see results</div>
          <div style="font-size:0.72rem;color:var(--text-3);margin-top:8px;line-height:1.6;max-width:320px">
            Data fetched live from Binance via ccxt.<br>
            Results are simulated — past performance does not guarantee future results.
          </div>
        </div>
      </div>

    </div>
  `;

  // Set initial strategy description
  if (strategies.length) updateStrategyDesc(strategies);
}

function updateStrategyDesc(strategiesArg) {
  const sel = document.getElementById('bt-strategy');
  if (!sel) return;
  const desc = document.getElementById('bt-strategy-desc');
  if (!desc) return;
  // Find description from the options' data or re-fetch
  const id = sel.value;
  api.get('/backtester/strategies').then(list => {
    const s = list.find(x => x.id === id);
    if (s && desc) desc.textContent = s.description || '';
  }).catch(() => {});
}

async function runBacktest() {
  const results = document.getElementById('bt-results');
  results.innerHTML = `<div class="bt-running">
    <div class="loading dot-anim" style="font-size:0.9rem">Fetching candles & running simulation</div>
    <div style="font-size:0.72rem;color:var(--text-3);margin-top:8px">This can take 5–15 seconds on first run</div>
  </div>`;

  const body = {
    coin_id:         document.getElementById('bt-coin').value,
    timeframe:       document.getElementById('bt-tf').value,
    since_days:      parseInt(document.getElementById('bt-days').value),
    strategy_id:     document.getElementById('bt-strategy').value,
    initial_capital: parseFloat(document.getElementById('bt-capital').value),
    risk_pct:        parseFloat(document.getElementById('bt-risk').value),
    stop_loss_pct:   document.getElementById('bt-sl').value || null,
  };

  try {
    const data = await api.post('/backtester/run', body);
    _btLastResult = data;
    renderBacktestResults(results, data);
  } catch (e) {
    results.innerHTML = `<div class="card" style="border-color:rgba(255,71,87,0.3)">
      <div style="color:var(--red);font-size:0.85rem;margin-bottom:8px">⚠ Backtest failed</div>
      <div style="color:var(--text-3);font-size:0.78rem">${e.message}</div>
      <div style="color:var(--text-3);font-size:0.72rem;margin-top:8px">
        Check that ccxt is installed (<code>pip install ccxt</code>) and that Binance is reachable.
      </div>
    </div>`;
  }
}

function renderBacktestResults(container, data) {
  const m = data.metrics;
  const posReturn = m.total_return_pct >= 0;
  const posWr     = m.win_rate >= 50;

  // Grade the backtest
  const grade = _gradeBacktest(m);

  container.innerHTML = `

    <!-- Header -->
    <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px;margin-bottom:20px">
      <div>
        <div style="font-family:var(--font-display);font-size:1.3rem;font-weight:700">${m.strategy_label}</div>
        <div style="font-size:0.72rem;color:var(--text-3);margin-top:3px">
          ${data.symbol} · ${data.timeframe} · ${data.candle_count} candles · ${data.since_days}d lookback
        </div>
      </div>
      <div class="bt-grade bt-grade-${grade.letter.toLowerCase()}">${grade.letter}</div>
    </div>

    <!-- Key metrics -->
    <div class="stat-grid" style="margin-bottom:20px">
      <div class="stat-card ${posReturn ? '' : 'red'}">
        <div class="stat-label">Total Return</div>
        <div class="stat-value ${posReturn ? 'pos' : 'neg'}">${posReturn?'+':''}${m.total_return_pct}%</div>
        <div class="stat-sub">$${m.initial_capital} → $${m.final_capital}</div>
      </div>
      <div class="stat-card ${posWr ? '' : 'red'}">
        <div class="stat-label">Win Rate</div>
        <div class="stat-value ${posWr ? 'pos' : 'neg'}">${m.win_rate}%</div>
        <div class="stat-sub">${m.winning_trades}W / ${m.losing_trades}L of ${m.total_trades}</div>
      </div>
      <div class="stat-card red">
        <div class="stat-label">Max Drawdown</div>
        <div class="stat-value neg">-${m.max_drawdown_pct}%</div>
        <div class="stat-sub">Worst peak-to-trough</div>
      </div>
      <div class="stat-card ${m.sharpe_ratio >= 1 ? 'cyan' : m.sharpe_ratio >= 0 ? '' : 'red'}">
        <div class="stat-label">Sharpe Ratio</div>
        <div class="stat-value ${m.sharpe_ratio >= 1 ? 'neutral' : m.sharpe_ratio >= 0 ? '' : 'neg'}">${m.sharpe_ratio}</div>
        <div class="stat-sub">${m.sharpe_ratio >= 2 ? 'Excellent' : m.sharpe_ratio >= 1 ? 'Good' : m.sharpe_ratio >= 0 ? 'Marginal' : 'Poor'}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Profit Factor</div>
        <div class="stat-value ${m.profit_factor >= 1.5 ? 'pos' : 'neg'}">${m.profit_factor || '—'}</div>
        <div class="stat-sub">Gross wins / gross losses</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Avg Win / Loss</div>
        <div class="stat-value" style="font-size:1.1rem">
          <span class="pos">+$${Math.abs(m.avg_win).toFixed(2)}</span>
          <span style="color:var(--text-3);font-size:0.8rem"> / </span>
          <span class="neg">-$${Math.abs(m.avg_loss).toFixed(2)}</span>
        </div>
      </div>
    </div>

    <!-- Grade explanation -->
    <div class="bt-grade-card" style="margin-bottom:20px">
      <strong>${grade.letter} — ${grade.label}</strong>: ${grade.desc}
    </div>

    <!-- Equity curve chart -->
    <div class="chart-card" style="margin-bottom:20px">
      <div class="chart-card-header">
        <div>
          <div class="chart-title">Equity Curve</div>
          <div class="chart-subtitle">Portfolio value over backtest period</div>
        </div>
      </div>
      <div class="chart-wrap" style="height:220px">
        <canvas id="bt-equity-canvas" data-height="220"></canvas>
      </div>
    </div>

    <!-- Trade log -->
    <div class="chart-card">
      <div class="chart-card-header">
        <div class="chart-title">Trade Log <span style="font-size:0.72rem;color:var(--text-3);font-weight:400">(last ${data.trade_log.length} trades)</span></div>
      </div>
      <div class="table-wrap" style="max-height:320px;overflow-y:auto">
        <table>
          <thead>
            <tr>
              <th>Entry</th><th>Exit</th><th>Entry $</th>
              <th>Exit $</th><th>P&L</th><th>%</th><th>Capital</th>
            </tr>
          </thead>
          <tbody>
            ${data.trade_log.map(t => `
              <tr>
                <td>${t.entry_date}</td>
                <td>${t.exit_date}</td>
                <td>$${parseFloat(t.entry_price).toFixed(4)}</td>
                <td>$${parseFloat(t.exit_price).toFixed(4)}</td>
                <td class="${t.pnl>=0?'pos':'neg'}">${t.pnl>=0?'+':''}$${Math.abs(t.pnl).toFixed(2)}</td>
                <td class="${t.pnl_pct>=0?'pos':'neg'}">${t.pnl_pct>=0?'+':''}${t.pnl_pct}%</td>
                <td>$${t.capital_after}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;

  // Mount equity curve
  requestAnimationFrame(() => {
    if (_btChart) { _btChart.destroy(); _btChart = null; }
    const canvas = document.getElementById('bt-equity-canvas');
    if (canvas && data.equity_curve?.length > 1) {
      canvas.dataset.height = 220;
      _btChart = new LineChart(canvas, {
        formatValue: v => '$' + parseFloat(v).toFixed(0),
        formatTooltipValue: v => '$' + parseFloat(v).toLocaleString('en-US',{minimumFractionDigits:2}),
        formatTooltipDate: (t) => {
          const d = new Date(typeof t === 'number' ? t : t);
          return d.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
        },
        splitFill: true,
        rangeKey: 'all',
      });
      _btChart.setData([{
        label: 'Equity',
        points: data.equity_curve.map(p => ({
          t: typeof p.t === 'number' ? p.t : new Date(p.t).getTime(),
          v: p.v
        }))
      }], 'all');
    }
  });
}

async function compareStrategies() {
  const results = document.getElementById('bt-results');
  results.innerHTML = `<div class="bt-running">
    <div class="loading dot-anim">Running all strategies</div>
    <div style="font-size:0.72rem;color:var(--text-3);margin-top:8px">Comparing 5 strategies — may take 30–60 seconds</div>
  </div>`;

  try {
    const data = await api.post('/backtester/compare', {
      coin_id:         document.getElementById('bt-coin').value,
      timeframe:       document.getElementById('bt-tf').value,
      since_days:      parseInt(document.getElementById('bt-days').value),
      initial_capital: parseFloat(document.getElementById('bt-capital').value),
      risk_pct:        parseFloat(document.getElementById('bt-risk').value),
    });

    const rows = data.results.map((m, i) => {
      const pos = m.total_return_pct >= 0;
      return `
        <tr>
          <td><span class="badge badge-gray">#${i+1}</span></td>
          <td style="font-weight:600">${m.strategy_label}</td>
          <td class="${pos?'pos':'neg'}">${pos?'+':''}${m.total_return_pct}%</td>
          <td class="${m.win_rate>=50?'pos':'neg'}">${m.win_rate}%</td>
          <td class="neg">-${m.max_drawdown_pct}%</td>
          <td class="${m.sharpe_ratio>=1?'neutral':''}">${m.sharpe_ratio}</td>
          <td>${m.total_trades}</td>
          <td>${m.profit_factor || '—'}</td>
        </tr>
      `;
    }).join('');

    results.innerHTML = `
      <div style="font-family:var(--font-display);font-size:1.1rem;font-weight:700;margin-bottom:6px">
        Strategy Comparison — ${data.symbol} ${data.timeframe}
      </div>
      <div style="font-size:0.72rem;color:var(--text-3);margin-bottom:18px">
        Ranked by total return. ${data.since_days}d lookback.
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Rank</th><th>Strategy</th><th>Return</th><th>Win Rate</th>
              <th>Max DD</th><th>Sharpe</th><th>Trades</th><th>P.Factor</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
  } catch (e) {
    results.innerHTML = `<div style="color:var(--red);padding:20px">${e.message}</div>`;
  }
}

function _gradeBacktest(m) {
  let score = 0;
  if (m.total_return_pct > 20) score += 3;
  else if (m.total_return_pct > 5) score += 2;
  else if (m.total_return_pct > 0) score += 1;

  if (m.win_rate > 60) score += 2;
  else if (m.win_rate > 50) score += 1;

  if (m.sharpe_ratio > 2) score += 3;
  else if (m.sharpe_ratio > 1) score += 2;
  else if (m.sharpe_ratio > 0) score += 1;

  if (m.max_drawdown_pct < 10) score += 2;
  else if (m.max_drawdown_pct < 20) score += 1;

  if (m.profit_factor > 2) score += 2;
  else if (m.profit_factor > 1.5) score += 1;

  if (score >= 10) return { letter: 'A', label: 'Excellent',  desc: 'Strong returns, controlled drawdown, good Sharpe. Worth paper trading.' };
  if (score >= 7)  return { letter: 'B', label: 'Good',       desc: 'Solid performance with acceptable risk metrics.' };
  if (score >= 5)  return { letter: 'C', label: 'Marginal',   desc: 'Positive but not convincing. Needs refinement or different parameters.' };
  if (score >= 3)  return { letter: 'D', label: 'Weak',       desc: 'Below average returns or high drawdown. Caution advised.' };
  return           { letter: 'F', label: 'Poor',       desc: 'Negative returns or poor risk metrics. Avoid trading this setup.' };
}
