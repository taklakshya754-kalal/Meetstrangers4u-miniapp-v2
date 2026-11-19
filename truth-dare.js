/* Truth or Dare multiplayer client, isolated from calling and wallet code */
(function () {
  const MODES = [
    { id: "normal", title: "Normal", desc: "Classic fun, friendly challenges", icon: "✨" },
    { id: "advanced", title: "Advanced", desc: "More daring and challenging prompts", icon: "⚡" },
    { id: "dark", title: "Dark Humour", desc: "Edgy humour prompts (within safety rules)", icon: "🌑" }
  ];
  // Configure this hostname when the separate Truth or Dare service is deployed.
  const WS_ENDPOINT = window.TRUTH_DARE_WS_URL || "wss://truth-dare.lxreward.xyz/ws";
  let selectedMode = "normal", selectedPlayers = 2, socket = null, currentOverlay = null;
  let lobbyState = { status: "idle", players: [], roomId: null, ready: false, target: 1000, count: 2, mode: "normal" };
  let connectTimer = null;

  function close() {
    stopSocket(true);
    document.getElementById("td-setup-overlay")?.remove();
    currentOverlay = null;
  }
  function stopSocket(sendCancel) {
    if (connectTimer) { clearTimeout(connectTimer); connectTimer = null; }
    const old = socket; socket = null;
    if (old && old.readyState === WebSocket.OPEN && sendCancel) {
      try { old.send(JSON.stringify({ type: "cancel-queue" })); } catch (_) {}
      try { old.send(JSON.stringify({ type: "leave-room" })); } catch (_) {}
    }
    if (old && old.readyState < WebSocket.CLOSING) old.close();
  }
  function esc(value) {
    return String(value || "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
  }
  function open() {
    if (document.getElementById("td-setup-overlay")) return;
    const overlay = document.createElement("div");
    overlay.id = "td-setup-overlay"; overlay.className = "td-overlay"; currentOverlay = overlay;
    overlay.innerHTML = `<div class="td-sheet" role="dialog" aria-modal="true" aria-label="Truth or Dare setup">
      <button class="td-close" type="button" aria-label="Close">×</button>
      <div class="td-kicker">FUN ZONE · MULTIPLAYER</div><div class="td-title">Truth <span>or</span> Dare</div>
      <p class="td-subtitle">Set up your game room</p>
      <section class="td-section"><div class="td-label">PLAYERS</div><div class="td-player-grid">${[2,3,4,5].map(n=>`<button class="td-player ${n===selectedPlayers?'selected':''}" data-players="${n}" type="button"><b>${n}</b><small>Players</small></button>`).join("")}</div></section>
      <section class="td-section"><div class="td-label">GAME MODE</div><div class="td-mode-list">${MODES.map(m=>`<button class="td-mode ${m.id===selectedMode?'selected':''}" data-mode="${m.id}" type="button"><span class="td-mode-icon">${m.icon}</span><span class="td-mode-copy"><b>${m.title}</b><small>${m.desc}</small></span><span class="td-check">✓</span></button>`).join("")}</div></section>
      <section class="td-points"><div class="td-label">GAME SCORE · WALLET COINS NOT USED</div><div class="td-point-row"><span>Truth verified</span><b>+25 Score</b></div><div class="td-point-row"><span>Dare verified</span><b>+50 Score</b></div><div class="td-point-row"><span>Skip Truth</span><b class="minus">−25 Score</b></div><div class="td-point-row"><span>Skip Dare</span><b class="minus">−50 Score</b></div></section>
      <button class="td-primary" type="button" id="td-confirm-setup">Find Players <span>→</span></button>
      <p class="td-footnote">Real users only · Score stays inside the game</p></div>`;
    document.body.appendChild(overlay);
    overlay.querySelector(".td-close").onclick = close;
    overlay.addEventListener("click", e => { if (e.target === overlay) close(); });
    overlay.querySelectorAll("[data-players]").forEach(btn => btn.onclick = () => { selectedPlayers=Number(btn.dataset.players); overlay.querySelectorAll("[data-players]").forEach(x=>x.classList.toggle("selected",x===btn)); });
    overlay.querySelectorAll("[data-mode]").forEach(btn => btn.onclick = () => { selectedMode=btn.dataset.mode; overlay.querySelectorAll("[data-mode]").forEach(x=>x.classList.toggle("selected",x===btn)); });
    overlay.querySelector("#td-confirm-setup").onclick = () => startQueue(selectedPlayers, selectedMode);
  }
  function renderLobby() {
    const overlay = document.getElementById("td-setup-overlay");
    if (!overlay) return;
    const modeTitle = MODES.find(m=>m.id===lobbyState.mode)?.title || lobbyState.mode;
    let heading = "Finding Players";
    let message = "Connecting securely to matchmaking…";
    if (lobbyState.status === "waiting") { heading = "Finding Players"; message = "Waiting for real players with the same settings. Keep this screen open."; }
    if (lobbyState.status === "room") { heading = "Room Lobby"; message = "Players joined! Everyone must tap Ready to start."; }
    if (lobbyState.status === "starting") { heading = "Starting Game"; message = "All players are ready. Preparing the game…"; }
    if (lobbyState.status === "offline") { heading = "Matchmaking Offline"; message = "Game service is not reachable yet. Try again later."; }
    if (lobbyState.status === "closed" { heading = "Room Closed"; message = "A player left before the game began. You can search for a new room."; }
    const list = lobbyState.players || [];
    const slots = Array.from({length:lobbyState.count}, (_,i) => {
      const p=list[i];
      return `<div class="td-slot ${p?'td-filled':''}"><span class="td-slot-avatar">${p?(p.host?'👑':'👤'):'＋'}</span><b>${p?esc(p.name):'Waiting for player'}</b><small>${p?(p.host?'Host':p.ready?'Ready':'Not ready'):'Open slot'}</small></div>`;
    }).join("");
    overlay.innerHTML = `<div class="td-sheet td-lobby-sheet" role="dialog" aria-modal="true" aria-label="Truth or Dare live lobby">
      <button class="td-close" type="button" aria-label="Close">×</button>
      <div class="td-kicker">LIVE MULTIPLAYER</div><div class="td-title">${heading}</div>
      <p class="td-subtitle">${lobbyState.count} players · ${modeTitle}</p>
      <div class="td-lobby-status"><span class="td-status-dot ${lobbyState.status}"></span><span>${message}</span></div>
      <div class="td-room-preview"><div class="td-room-label">PLAYERS · ${list.length}/${lobbyState.count}</div><div class="td-slots">${slots}</div></div>
      <div class="td-lobby-summary"><span>Mode</span><b>${esc(modeTitle)}</b><span>Win target</span><b>1000 Score</b><span>Room</span><b>${lobbyState.roomId?esc(lobbyState.roomId.slice(0,8)):'Searching…'}</b></div>
      ${lobbyState.status==="room" ? `<button class="td-primary td-ready-btn" type="button">${lobbyState.ready?'✓ Ready — Tap to Unready':'I’m Ready'}</button>` : ""}
      ${(lobbyState.status==="offline" || lobbyState.status==="closed") ? `<button class="td-primary td-retry-btn" type="button">Retry Matchmaking</button>` : ""}
      <button class="td-secondary td-cancel-btn" type="button">${lobbyState.status==="room"?"Leave Room":"Cancel Search"}</button>
      <p class="td-footnote">No bots · No wallet coins · Server-authoritative room</p></div>`;
    overlay.querySelector(".td-close").onclick = close;
    overlay.querySelector(".td-cancel-btn").onclick = () => { stopSocket(true); close(); open(); };
    overlay.querySelector(".td-ready-btn")?.addEventListener("click", () => {
      if (!socket || socket.readyState !== WebSocket.OPEN) return;
      lobbyState.ready = !lobbyState.ready;
      socket.send(JSON.stringify({ type:"ready", ready:lobbyState.ready }));
      renderLobby();
    });
    overlay.querySelector(".td-retry-btn")?.addEventListener("click", () => startQueue(lobbyState.count, lobbyState.mode));
  }
  function startQueue(count, mode) {
    stopSocket(true);
    lobbyState = { status:"connecting", players:[], roomId:null, ready:false, target:1000, count, mode };
    renderLobby();
    if (!window.Telegram?.WebApp?.initData) {
      lobbyState.status="offline"; renderLobby(); return;
    }
    let ws;
    try { ws = new WebSocket(WS_ENDPOINT + "?initData=" + encodeURIComponent(window.Telegram.WebApp.initData)); }
    catch (_) { lobbyState.status="offline"; renderLobby(); return; }
    socket=ws;
    connectTimer=setTimeout(()=>{ if(socket===ws && ws.readyState!==WebSocket.OPEN){ lobbyState.status="offline"; renderLobby(); try{ws.close();}catch(_){} } }, 12000);
    ws.onopen=()=>{ if(socket!==ws)return; if(connectTimer){clearTimeout(connectTimer);connectTimer=null;} ws.send(JSON.stringify({type:"queue",playerCount:count,mode})); };
    ws.onmessage=event=>{
      if(socket!==ws)return;
      let data; try{data=JSON.parse(event.data);}catch(_){return;}
      if(data.type==="connected"){ return; }
      if(data.type==="queue-joined"){ lobbyState.status="waiting"; renderLobby(); }
      if(data.type==="room-formed"){ lobbyState.status="room"; lobbyState.roomId=data.roomId; lobbyState.players=data.players||[]; lobbyState.ready=false; renderLobby(); }
      if(data.type==="ready-update"){ lobbyState.players=data.players||lobbyState.players; renderLobby(); }
      if(data.type==="game-start"){ lobbyState.status="starting"; lobbyState.players=data.players||lobbyState.players; renderLobby(); }
      if(data.type==="player-left"){ lobbyState.players=data.players||[]; renderLobby(); }
      if(data.type==="room-closed"){ lobbyState.status="closed"; lobbyState.roomId=null; lobbyState.players=[]; lobbyState.ready=false; renderLobby(); }
      if(data.type==="queue-cancelled"){ lobbyState.status="idle"; }
      if(data.type==="error"){ lobbyState.status="offline"; renderLobby(); }
    };
    ws.onerror=()=>{ if(socket===ws){lobbyState.status="offline";renderLobby();} };
    ws.onclose=()=>{ if(socket===ws && !["starting"].includes(lobbyState.status)){lobbyState.status="offline";renderLobby();} };
  }
  window.openTruthDareSetup=open;
})();