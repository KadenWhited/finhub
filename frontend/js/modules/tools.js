// modules/tools.js

async function renderTools() {
  const el = document.getElementById('page-tools');
  let settings = {};
  try {
    settings = await api.get('/settings/');
  } catch (e) { /* use defaults */ }

  el.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">Tools</div>
        <div class="page-subtitle">Position sizing & calculators</div>
      </div>
    </div>

    <div style="max-width:600px;display:flex;flex-direction:column;gap:20px;">

      <!-- Position Size Calculator -->
      <div class="card">
        <div class="card-title" style="margin-bottom:14px">Position Size Calculator</div>
        <div style="font-size:0.75rem;color:var(--text-3);margin-bottom:16px;line-height:1.6">
          Enter your entry and stop loss to calculate the right position size based on your risk tolerance.
          Risking more than 1–2% per trade at your account size will blow up the account fast.
        </div>
        <div class="form-grid">
          <div class="form-group">
            <label class="form-label">Account Size ($)</label>
            <input id="ps-account" class="form-input" type="number" step="any" value="${settings.starting_capital || 350}">
          </div>
          <div class="form-group">
            <label class="form-label">Risk Per Trade (%)</label>
            <input id="ps-risk" class="form-input" type="number" step="0.1" value="${settings.risk_per_trade_pct || 2}">
          </div>
          <div class="form-group">
            <label class="form-label">Entry Price ($)</label>
            <input id="ps-entry" class="form-input" type="number" step="any" placeholder="e.g. 65000">
          </div>
          <div class="form-group">
            <label class="form-label">Stop Loss Price ($)</label>
            <input id="ps-stop" class="form-input" type="number" step="any" placeholder="e.g. 63000">
          </div>
          <div class="form-group">
            <label class="form-label">Target Price ($) — optional</label>
            <input id="ps-target" class="form-input" type="number" step="any" placeholder="e.g. 70000">
          </div>
        </div>
        <button class="btn btn-primary" onclick="calcPositionSize()" style="width:100%;margin-top:4px">Calculate</button>

        <div id="ps-result" style="margin-top:16px"></div>
      </div>

      <!-- R:R Quick Calculator -->
      <div class="card">
        <div class="card-title" style="margin-bottom:14px">Risk/Reward Quick Check</div>
        <div class="form-grid">
          <div class="form-group">
            <label class="form-label">Risk Amount ($)</label>
            <input id="rr-risk" class="form-input" type="number" step="any" placeholder="e.g. 7">
          </div>
          <div class="form-group">
            <label class="form-label">Reward Amount ($)</label>
            <input id="rr-reward" class="form-input" type="number" step="any" placeholder="e.g. 21">
          </div>
        </div>
        <button class="btn btn-ghost" onclick="calcRR()" style="width:100%;margin-top:4px">Check R:R</button>
        <div id="rr-result" style="margin-top:12px"></div>
      </div>

    </div>
  `;
}

async function calcPositionSize() {
  const entry = document.getElementById('ps-entry').value;
  const stop = document.getElementById('ps-stop').value;
  if (!entry || !stop) { showToast('Entry and stop loss required', 'error'); return; }

  try {
    const result = await api.post('/tools/position-size', {
      account_size: document.getElementById('ps-account').value,
      risk_pct: document.getElementById('ps-risk').value,
      entry_price: entry,
      stop_loss_price: stop,
      target_price: document.getElementById('ps-target').value || undefined
    });

    const rrLine = result.risk_reward_ratio
      ? `<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border)">
           <span style="color:var(--text-3)">Risk/Reward</span>
           <span class="${result.risk_reward_ratio >= 2 ? 'pos' : 'neg'}" style="font-weight:600">1 : ${result.risk_reward_ratio}</span>
         </div>
         <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border)">
           <span style="color:var(--text-3)">Potential Reward</span>
           <span class="pos">+$${result.potential_reward.toFixed(2)}</span>
         </div>` : '';

    const verdict = result.risk_reward_ratio
      ? result.risk_reward_ratio >= 2
        ? `<div style="margin-top:12px;padding:10px 14px;border-radius:6px;background:var(--green-glow);border:1px solid rgba(0,230,118,0.25);color:var(--green);font-size:0.78rem">✓ Good setup — R:R is ${result.risk_reward_ratio}:1</div>`
        : `<div style="margin-top:12px;padding:10px 14px;border-radius:6px;background:var(--red-glow);border:1px solid rgba(255,71,87,0.25);color:var(--red);font-size:0.78rem">⚠ Weak setup — aim for at least 2:1 R:R before entering</div>`
      : '';

    document.getElementById('ps-result').innerHTML = `
      <div style="border-top:1px solid var(--border);padding-top:14px">
        <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border)">
          <span style="color:var(--text-3)">Risk Amount</span>
          <span class="neg">-$${result.risk_amount.toFixed(2)}</span>
        </div>
        <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border)">
          <span style="color:var(--text-3)">Position Size</span>
          <span style="color:var(--cyan);font-weight:700;font-size:1.1rem">${result.position_size} coins</span>
        </div>
        <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border)">
          <span style="color:var(--text-3)">Position Value</span>
          <span>$${result.position_value.toFixed(2)}</span>
        </div>
        <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border)">
          <span style="color:var(--text-3)">Price Diff to Stop</span>
          <span>$${result.price_diff.toFixed(4)}</span>
        </div>
        ${rrLine}
        ${verdict}
      </div>
    `;
  } catch (e) {
    showToast(e.message, 'error');
  }
}

function calcRR() {
  const risk = parseFloat(document.getElementById('rr-risk').value);
  const reward = parseFloat(document.getElementById('rr-reward').value);
  if (!risk || !reward) { showToast('Enter both values', 'error'); return; }
  const ratio = (reward / risk).toFixed(2);
  const isGood = ratio >= 2;
  document.getElementById('rr-result').innerHTML = `
    <div style="padding:12px 16px;border-radius:6px;background:${isGood ? 'var(--green-glow)' : 'var(--red-glow)'};border:1px solid ${isGood ? 'rgba(0,230,118,0.3)' : 'rgba(255,71,87,0.3)'};color:${isGood ? 'var(--green)' : 'var(--red)'}">
      <strong>1 : ${ratio} R:R</strong> — ${isGood ? '✓ Worth considering' : '⚠ Below 2:1 — probably skip this one'}
    </div>
  `;
}