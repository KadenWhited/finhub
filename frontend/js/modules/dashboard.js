// modules/dashboard.js

async function renderDashboard() {
  const el = document.getElementById('page-dashboard');
  el.innerHTML = loadingHtml('Loading dashboard');

  let data;
  try {
    data = await api.get('/dashboard/summary');
  } catch (e) {
    el.innerHTML = `<div class="empty-state"><div class="empty-state-text">⚠ Could not connect to backend. Make sure the server is running.</div></div>`;
    return;
  }

  const trades = data.trades;
  const checkbook = data.checkbook;
  const credit = data.credit || { total_balance: 0, utilization_pct: null };
  const gambling = data.gambling;
  const settings = data.settings || { starting_capital: 350, current_capital: 350, capital_growth_pct: 0 };

  const revengeAlert = trades.revenge_alert
    ? `<div class="alert-banner alert-revenge">
        <span class="alert-icon">⚠</span>
        <div><strong>REVENGE TRADING ALERT</strong> — Your last 3 closed trades were losses. Step back and reassess before your next entry.</div>
      </div>`
    : '';

  const tradePnlClass = trades.total_pnl >= 0 ? 'pos' : 'neg';
  const cbClass = checkbook.balance >= 0 ? 'pos' : 'neg';
  const gambClass = gambling.net_pnl >= 0 ? 'pos' : 'neg';
  const creditClass = credit.total_balance > 0 ? 'neg' : 'pos';
  const growthClass = settings.capital_growth_pct >= 0 ? 'pos' : 'neg';

  el.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">Dashboard</div>
        <div class="page-subtitle">Overview — all modules</div>
      </div>
      <div style="font-size:0.72rem;color:var(--text-3)">${new Date().toLocaleDateString('en-US', {weekday:'long', month:'long', day:'numeric'})}</div>
    </div>

    ${revengeAlert}

    <div class="stat-grid">
      <div class="stat-card">
        <div class="stat-label">Trade P&L</div>
        <div class="stat-value ${tradePnlClass}">${trades.total_pnl >= 0 ? '+' : ''}$${Math.abs(trades.total_pnl).toFixed(2)}</div>
        <div class="stat-sub">${trades.total_closed} closed · ${trades.open_trades} open</div>
      </div>
      <div class="stat-card ${trades.win_rate >= 50 ? '' : 'red'}">
        <div class="stat-label">Win Rate</div>
        <div class="stat-value ${trades.win_rate >= 50 ? 'pos' : 'neg'}">${trades.win_rate}%</div>
        <div class="stat-sub">of closed trades</div>
      </div>
      <div class="stat-card cyan">
        <div class="stat-label">Cash Balance</div>
        <div class="stat-value neutral">$${Math.abs(checkbook.balance).toFixed(2)}</div>
        <div class="stat-sub">Income vs Expenses</div>
      </div>
      <div class="stat-card ${credit.total_balance > 0 ? 'red' : ''}">
        <div class="stat-label">Credit Owed</div>
        <div class="stat-value ${creditClass}">$${credit.total_balance.toFixed(2)}</div>
        <div class="stat-sub">${credit.utilization_pct !== null ? credit.utilization_pct + '% utilized' : 'No limit set'}</div>
      </div>
      <div class="stat-card ${gambling.net_pnl >= 0 ? '' : 'red'}">
        <div class="stat-label">Gambling P&L</div>
        <div class="stat-value ${gambClass}">${gambling.net_pnl >= 0 ? '+' : ''}$${Math.abs(gambling.net_pnl).toFixed(2)}</div>
        <div class="stat-sub">$${gambling.total_wagered.toFixed(2)} total wagered</div>
      </div>
      <div class="stat-card ${settings.capital_growth_pct >= 0 ? '' : 'red'}">
        <div class="stat-label">Capital Growth</div>
        <div class="stat-value ${growthClass}">${settings.capital_growth_pct >= 0 ? '+' : ''}${settings.capital_growth_pct}%</div>
        <div class="stat-sub">$${settings.starting_capital} → $${settings.current_capital}</div>
      </div>
    </div>

    <div class="dash-modules">
      <div class="dash-module" onclick="navigateTo('trades')">
        <div class="module-header">
          <div class="module-title">Trade Journal</div>
          <span class="module-icon">◇</span>
        </div>
        <div class="module-pnl ${tradePnlClass}">
          ${trades.total_pnl >= 0 ? '+' : ''}$${Math.abs(trades.total_pnl).toFixed(2)}
        </div>
        <div class="module-meta">
          <div class="meta-item">Win rate <span>${trades.win_rate}%</span></div>
          <div class="meta-item">Closed <span>${trades.total_closed}</span></div>
          <div class="meta-item">Open <span>${trades.open_trades}</span></div>
        </div>
      </div>

      <div class="dash-module" onclick="navigateTo('checkbook')">
        <div class="module-header">
          <div class="module-title">Checkbook</div>
          <span class="module-icon" style="color:var(--cyan)">◻</span>
        </div>
        <div class="module-pnl neutral">$${checkbook.balance.toFixed(2)}</div>
        <div class="module-meta">
          <div class="meta-item">Income <span style="color:var(--green)">+$${checkbook.total_income.toFixed(2)}</span></div>
          <div class="meta-item">Expenses <span style="color:var(--red)">-$${checkbook.total_expenses.toFixed(2)}</span></div>
        </div>
      </div>

      <div class="dash-module" onclick="navigateTo('gambling')">
        <div class="module-header">
          <div class="module-title">Gambling Tracker</div>
          <span class="module-icon" style="color:var(--yellow)">◈</span>
        </div>
        <div class="module-pnl ${gambClass}">
          ${gambling.net_pnl >= 0 ? '+' : ''}$${Math.abs(gambling.net_pnl).toFixed(2)}
        </div>
        <div class="module-meta">
          <div class="meta-item">Wagered <span>$${gambling.total_wagered.toFixed(2)}</span></div>
          <div class="meta-item">ROI <span>${gambling.roi_pct}%</span></div>
        </div>
      </div>

      <div class="dash-module" onclick="navigateTo('credit')">
        <div class="module-header">
          <div class="module-title">Credit</div>
          <span class="module-icon" style="color:var(--purple)">▣</span>
        </div>
        <div class="module-pnl ${creditClass}">$${credit.total_balance.toFixed(2)}</div>
        <div class="module-meta">
          <div class="meta-item">Owed <span style="color:var(--red)">$${credit.total_balance.toFixed(2)}</span></div>
          ${credit.utilization_pct !== null ? `<div class="meta-item">Utilization <span>${credit.utilization_pct}%</span></div>` : ''}
        </div>
      </div>
    </div>
  `;
}