/* Truth or Dare setup UI - isolated from the main wallet/call logic */
(function () {
  const MODES = [
    { id: 'normal', title: 'Normal', desc: 'Classic fun, friendly challenges', icon: '✨' },
    { id: 'advanced', title: 'Advanced', desc: 'More daring and challenging prompts', icon: '⚡' },
    { id: 'dark', title: 'Dark Humour', desc: 'Edgy humour prompts (within safety rules)', icon: '🌑' }
  ];
  let selectedMode = 'normal';
  let selectedPlayers = 2;
  function close() { document.getElementById('td-setup-overlay')?.remove(); }
  function open() {
    if (document.getElementById('td-setup-overlay')) return;
    const overlay = document.createElement('div');
    overlay.id = 'td-setup-overlay';
    overlay.className = 'td-overlay';
    overlay.innerHTML = `<div class="td-sheet" role="dialog" aria-modal="true" aria-label="Truth or Dare game setup">
      <button class="td-close" type="button" aria-label="Close">×</button>
      <div class="td-kicker">FUN ZONE · MULTIPLAYER</div><div class="td-title">Truth <span>or</span> Dare</div>
      <p class="td-subtitle">Set up your game room</p>
      <section class="td-section"><div class="td-label">PLAYERS</div><div class="td-player-grid">${[2,3,4,5].map(n=>`<button class="td-player ${n===selectedPlayers?'selected':''}" data-players="${n}" type="button"><b>${n}</b><small>Players</small></button>`).join('')}</div></section>
      <section class="td-section"><div class="td-label">GAME MODE</div><div class="td-mode-list">${MODES.map(m=>`<button class="td-mode ${m.id===selectedMode?'selected':''}" data-mode="${m.id}" type="button"><span class="td-mode-icon">${m.icon}</span><span class="td-mode-copy"><b>${m.title}</b><small>${m.desc}</small></span><span class="td-check">✓</span></button>`).join('')}</div></section>
      <section class="td-points"><div class="td-label">GAME POINTS · WALLET COINS ARE NOT USED</div><div class="td-point-row"><span>Truth verified</span><b>+25 pts</b></div><div class="td-point-row"><span>Dare verified</span><b>+50 pts</b></div><div class="td-point-row"><span>Skip Truth</span><b class="minus">−25 pts</b></div><div class="td-point-row"><span>Skip Dare</span><b class="minus">−50 pts</b></div></section>
      <button class="td-primary" type="button" id="td-confirm-setup">Continue <span>→</span></button>
      <p class="td-footnote">Only real players · Points stay inside the game</p>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('.td-close').onclick = close;
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    overlay.querySelectorAll('[data-players]').forEach(btn => btn.onclick = () => { selectedPlayers = Number(btn.dataset.players); overlay.querySelectorAll('[data-players]').forEach(x=>x.classList.toggle('selected',x===btn)); });
    overlay.querySelectorAll('[data-mode]').forEach(btn => btn.onclick = () => { selectedMode = btn.dataset.mode; overlay.querySelectorAll('[data-mode]').forEach(x=>x.classList.toggle('selected',x===btn)); });
    overlay.querySelector('#td-confirm-setup').onclick = () => {
      const mode = MODES.find(m=>m.id===selectedMode)?.title || 'Normal';
      const notice = overlay.querySelector('.td-notice') || document.createElement('div');
      notice.className='td-notice';
      notice.textContent = `Setup saved: ${selectedPlayers} players · ${mode}. Live matchmaking is not connected yet; server implementation is the next step.`;
      overlay.querySelector('.td-primary').insertAdjacentElement('beforebegin', notice);
      overlay.querySelector('.td-primary').textContent='Got it';
      overlay.querySelector('.td-primary').onclick=close;
    };
  }
  window.openTruthDareSetup = open;
})();
