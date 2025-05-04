// Remove this file if you are not using it for any visible overlay rendering.
// All rendering is now handled in overlay.html's <script> section.

const settingsKey = 'latest_swaps';

function renderSuggestions() {
  const container = document.getElementById('suggestions');
  const raw = localStorage.getItem(settingsKey) || '[]';
  const recs = JSON.parse(raw);
  if (!recs.length) return container.textContent = 'No suggestions';

  container.innerHTML = recs.map(r => `
    <div class="hero">
      <strong>${r.hero}</strong>: ${r.score}%
      <details>
        <summary>breakdown</summary>
        Base vs enemies: ${r.avg_vs_enemy}%<br>
        Baseline bonus: ${r.baseline_bonus}%<br>
        Synergy: ${r.synergy}%<br>
        Comp bonus: ${r.comp_bonus}%<br>
        Enemy threat: -${r.enemy_threat}%
      </details>
    </div>
  `).join('');
}

overwolf.windows.getCurrentWindow(win=>{
  overwolf.windows.onMessageReceived.addListener(msg=>{
    if (msg.window_id===win.id && msg.messageId==='refresh_recs') renderSuggestions();
  });
});

window.addEventListener('DOMContentLoaded', renderSuggestions);