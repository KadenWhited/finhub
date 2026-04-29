// modules/gambling.js

let gamblingData = [];
const GAME_TYPES = ['Poker', 'Blackjack', 'Slots', 'Sports Betting', 'Roulette', 'Craps', 'Baccarat', 'Lottery', 'Online Casino', 'Other'];

async function renderGambling() {
  const el = document.getElementById('page-gambling');
  el.innerHTML = loadingHtml('Loading sessions');
  try {
    const [sessions, stats] = await Promise.all([
      api.get('/gambling/'),
      api.get('/gambling/stats')
    ]);
    gamblingData = sessions;
    renderGamblingView(el, sessions, stats);
  } catch (e) {
    el.innerHTML = `<p style="color:var(--red);padding:20px">Error: ${e.message}</p>`;
  }
}

function renderGamblingView(el, sessions, stats) {
  const tableRows = sessions.length === 0
    ? `<tr class="empty-row"><td colspan="8">${emptyStateHtml('◈', 'No sessions logged yet')}</td></tr>`
    : sessions.map(s => {
        const net = s.net_result;
        return `
          <tr>
            <td>${fmtDate(s.date)}</td>
            <td><span class="badge badge-cyan">${s.game_type}</span></td>
            <td>${s.venue || '<span class="zero">—</span>'}</td>
            <td>$${parseFloat(s.buy_in).toFixed(2)}</td>
            <td>$${parseFloat(s.cash_out).toFixed(2)}</td>
            <td class="${net > 0 ? 'pos' : net < 0 ? 'neg' : 'zero'}">${net > 0 ? '+' : ''}$${Math.abs(net).toFixed(2)}</td>
            <td>${fmtPct(s.roi_pct)}</td>
            <td>
              <div class="row-actions">
                <button class="btn btn-sm btn-ghost btn-icon" onclick="openEditGambModal(${s.id})">✎</button>
                <button class="btn btn-sm btn-danger btn-icon" onclick="deleteGambSession(${s.id})">✕</button>
              </div>
            </td>
          </tr>
        `;
      }).join('');

  // Game breakdown
  const gameBreakdown = Object.entries(stats.by_game || {}).map(([game, g]) => `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border)">
      <div>
        <span class="badge badge-cyan">${game}</span>
        <span style="font-size:0.72rem;color:var(--text-3);margin-left:8px">${g.sessions} session${g.sessions !== 1 ? 's' : ''}</span>
      </div>
      <div style="text-align:right">
        <div style="font-size:0.78rem;color:var(--text-2)">$${g.wagered.toFixed(2)} wagered</div>
        <div class="${g.net >= 0 ? 'pos' : 'neg'}" style="font-size:0.8rem;font-weight:600">${g.net >= 0 ? '+' : ''}$${g.net.toFixed(2)}</div>
      </div>
    </div>
  `).join('');

  el.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">Gambling Tracker</div>
        <div class="page-subtitle">Session-by-session tracking</div>
      </div>
      <button class="btn btn-primary" onclick="openNewGambModal()">+ Log Session</button>
    </div>

    <div class="stat-grid">
      <div class="stat-card ${stats.net_pnl >= 0 ? '' : 'red'}">
        <div class="stat-label">Lifetime P&L</div>
        <div class="stat-value ${pnlClass(stats.net_pnl)}">${stats.net_pnl >= 0 ? '+' : ''}$${Math.abs(stats.net_pnl).toFixed(2)}</div>
        <div class="stat-sub">${stats.total_sessions} sessions</div>
      </div>
      <div class="stat-card cyan">
        <div class="stat-label">Total Wagered</div>
        <div class="stat-value neutral">$${stats.total_wagered.toFixed(2)}</div>
      </div>
      <div class="stat-card ${stats.roi_pct >= 0 ? '' : 'red'}">
        <div class="stat-label">Lifetime ROI</div>
        <div class="stat-value ${pnlClass(stats.roi_pct)}">${stats.roi_pct}%</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Win Rate</div>
        <div class="stat-value ${stats.win_rate >= 50 ? 'pos' : 'neg'}">${stats.win_rate}%</div>
        <div class="stat-sub">${stats.winning_sessions}W / ${stats.losing_sessions}L${stats.push_sessions ? ` / ${stats.push_sessions}P` : ''}</div>
      </div>
    </div>

    ${Object.keys(stats.by_game || {}).length > 0 ? `
    <div class="card" style="margin-bottom:20px">
      <div class="card-title">By Game Type</div>
      ${gameBreakdown || '<div style="color:var(--text-3);font-size:0.78rem">No data</div>'}
    </div>` : ''}

    <div class="action-row">
      <span style="font-size:0.72rem;color:var(--text-3)">${sessions.length} session${sessions.length !== 1 ? 's' : ''}</span>
    </div>

    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Game</th>
            <th>Venue</th>
            <th>Buy-in</th>
            <th>Cash-out</th>
            <th>Net</th>
            <th>ROI</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>${tableRows}</tbody>
      </table>
    </div>
  `;
}

function openNewGambModal() {
  openModal(`
    <div class="modal-title">Log Gambling Session</div>
    <div class="form-grid">
      <div class="form-group">
        <label class="form-label">Game Type</label>
        <select id="g-game" class="form-select">
          ${GAME_TYPES.map(g => `<option>${g}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Venue (optional)</label>
        <input id="g-venue" class="form-input" placeholder="Casino, online platform…">
      </div>
      <div class="form-group">
        <label class="form-label">Buy-in ($)</label>
        <input id="g-buyin" class="form-input" type="number" step="any" placeholder="0.00">
      </div>
      <div class="form-group">
        <label class="form-label">Cash-out ($)</label>
        <input id="g-cashout" class="form-input" type="number" step="any" placeholder="0.00">
      </div>
      <div class="form-group">
        <label class="form-label">Date</label>
        <input id="g-date" class="form-input" type="date" value="${todayISO()}">
      </div>
      <div class="form-group">
        <label class="form-label">Duration (mins, optional)</label>
        <input id="g-dur" class="form-input" type="number" placeholder="0">
      </div>
    </div>
    <div class="form-group" style="margin-bottom:18px">
      <label class="form-label">Notes</label>
      <textarea id="g-notes" class="form-textarea" placeholder="How did the session go?"></textarea>
    </div>
    <button class="btn btn-primary" onclick="submitNewGamb()" style="width:100%">Log Session</button>
  `);
}

async function submitNewGamb() {
  const buyin = document.getElementById('g-buyin').value;
  const cashout = document.getElementById('g-cashout').value;
  const date = document.getElementById('g-date').value;
  if (!buyin || cashout === '' || !date) { showToast('Fill in required fields', 'error'); return; }
  try {
    await api.post('/gambling/', {
      game_type: document.getElementById('g-game').value,
      venue: document.getElementById('g-venue').value,
      buy_in: buyin,
      cash_out: cashout,
      date,
      duration_minutes: document.getElementById('g-dur').value || null,
      notes: document.getElementById('g-notes').value
    });
    closeModal();
    showToast('Session logged ✓', 'success');
    renderGambling();
  } catch (e) {
    showToast(e.message, 'error');
  }
}

function openEditGambModal(id) {
  const s = gamblingData.find(x => x.id === id);
  if (!s) return;
  openModal(`
    <div class="modal-title">Edit Session</div>
    <div class="form-grid">
      <div class="form-group">
        <label class="form-label">Game Type</label>
        <select id="ge-game" class="form-select">
          ${GAME_TYPES.map(g => `<option ${g === s.game_type ? 'selected' : ''}>${g}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Venue</label>
        <input id="ge-venue" class="form-input" value="${s.venue || ''}">
      </div>
      <div class="form-group">
        <label class="form-label">Buy-in ($)</label>
        <input id="ge-buyin" class="form-input" type="number" step="any" value="${s.buy_in}">
      </div>
      <div class="form-group">
        <label class="form-label">Cash-out ($)</label>
        <input id="ge-cashout" class="form-input" type="number" step="any" value="${s.cash_out}">
      </div>
      <div class="form-group">
        <label class="form-label">Date</label>
        <input id="ge-date" class="form-input" type="date" value="${s.date}">
      </div>
      <div class="form-group">
        <label class="form-label">Duration (mins)</label>
        <input id="ge-dur" class="form-input" type="number" value="${s.duration_minutes || ''}">
      </div>
    </div>
    <div class="form-group" style="margin-bottom:18px">
      <label class="form-label">Notes</label>
      <textarea id="ge-notes" class="form-textarea">${s.notes || ''}</textarea>
    </div>
    <button class="btn btn-primary" onclick="submitEditGamb(${id})" style="width:100%">Save Changes</button>
  `);
}

async function submitEditGamb(id) {
  try {
    await api.put(`/gambling/${id}`, {
      game_type: document.getElementById('ge-game').value,
      venue: document.getElementById('ge-venue').value,
      buy_in: document.getElementById('ge-buyin').value,
      cash_out: document.getElementById('ge-cashout').value,
      date: document.getElementById('ge-date').value,
      duration_minutes: document.getElementById('ge-dur').value || null,
      notes: document.getElementById('ge-notes').value
    });
    closeModal();
    showToast('Session updated ✓', 'success');
    renderGambling();
  } catch (e) {
    showToast(e.message, 'error');
  }
}

async function deleteGambSession(id) {
  confirmAction('Delete this session?', async () => {
    try {
      await api.del(`/gambling/${id}`);
      showToast('Session deleted', 'success');
      renderGambling();
    } catch (e) {
      showToast(e.message, 'error');
    }
  });
}
