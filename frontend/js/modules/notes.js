// modules/notes.js

let allNotes = [];

async function renderNotes() {
  const el = document.getElementById('page-notes');
  el.innerHTML = loadingHtml('Loading journal');
  try {
    allNotes = await api.get('/notes/');
    renderNotesView(el);
  } catch (e) {
    el.innerHTML = `<p style="color:var(--red);padding:20px">Error: ${e.message}</p>`;
  }
}

function renderNotesView(el) {
  const notesList = allNotes.length === 0
    ? `<div style="color:var(--text-3);font-size:0.8rem;padding:20px 0">No entries yet.</div>`
    : allNotes.map(n => `
        <div class="note-entry" onclick="loadNote('${n.date}')">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <div style="font-size:0.82rem;color:var(--text);font-weight:500">${n.date}</div>
            <div style="display:flex;align-items:center;gap:8px">
              ${n.mood ? `<span style="font-size:16px">${moodEmoji(n.mood)}</span>` : ''}
              <button class="btn btn-sm btn-danger btn-icon" onclick="event.stopPropagation();deleteNote(${n.id})">✕</button>
            </div>
          </div>
          <div style="font-size:0.75rem;color:var(--text-3);margin-top:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%">
            ${n.content.substring(0, 80)}${n.content.length > 80 ? '…' : ''}
          </div>
        </div>
      `).join('');

  el.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">Journal</div>
        <div class="page-subtitle">Daily trading notes</div>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:280px 1fr;gap:20px;align-items:start">

      <!-- Entry list -->
      <div>
        <div style="font-size:0.68rem;color:var(--text-3);text-transform:uppercase;letter-spacing:0.1em;margin-bottom:10px">Past Entries (${allNotes.length})</div>
        <div style="display:flex;flex-direction:column;gap:6px;max-height:70vh;overflow-y:auto">
          ${notesList}
        </div>
      </div>

      <!-- Editor -->
      <div class="card" style="position:sticky;top:20px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
          <div>
            <label class="form-label">Date</label>
            <input id="note-date" class="form-input" type="date" value="${todayISO()}" style="margin-top:4px;width:160px" onchange="loadNote(this.value)">
          </div>
          <div>
            <label class="form-label">Mood</label>
            <select id="note-mood" class="form-select" style="margin-top:4px;width:130px">
              <option value="">—</option>
              <option value="great">🟢 Great</option>
              <option value="good">🔵 Good</option>
              <option value="neutral">⚪ Neutral</option>
              <option value="bad">🟡 Cautious</option>
              <option value="terrible">🔴 Bad</option>
            </select>
          </div>
        </div>
        <textarea id="note-content" class="form-textarea" style="min-height:300px;font-size:0.84rem;line-height:1.7"
          placeholder="Market observations, trade rationale, lessons learned, emotional state, goals for tomorrow…"></textarea>
        <button class="btn btn-primary" onclick="saveNote()" style="width:100%;margin-top:12px">Save Entry</button>
      </div>

    </div>
  `;

  loadNote(todayISO());
}

function moodEmoji(mood) {
  return { great: '🟢', good: '🔵', neutral: '⚪', bad: '🟡', terrible: '🔴' }[mood] || '';
}

async function loadNote(date) {
  document.getElementById('note-date').value = date;
  try {
    const note = await api.get(`/notes/${date}`);
    document.getElementById('note-content').value = note.content || '';
    document.getElementById('note-mood').value = note.mood || '';
  } catch (e) {
    document.getElementById('note-content').value = '';
    document.getElementById('note-mood').value = '';
  }
}

async function saveNote() {
  const date = document.getElementById('note-date').value;
  const content = document.getElementById('note-content').value.trim();
  if (!date || !content) { showToast('Add a date and some content', 'error'); return; }
  try {
    await api.post('/notes/', {
      date,
      content,
      mood: document.getElementById('note-mood').value || null
    });
    showToast('Entry saved ✓', 'success');
    allNotes = await api.get('/notes/');
    renderNotesView(document.getElementById('page-notes'));
    // Re-load the note to keep the editor on the same date
    setTimeout(() => loadNote(date), 50);
  } catch (e) {
    showToast(e.message, 'error');
  }
}

async function deleteNote(id) {
  confirmAction('Delete this journal entry?', async () => {
    try {
      await api.del(`/notes/${id}`);
      showToast('Entry deleted', 'success');
      allNotes = await api.get('/notes/');
      renderNotesView(document.getElementById('page-notes'));
    } catch (e) {
      showToast(e.message, 'error');
    }
  });
}