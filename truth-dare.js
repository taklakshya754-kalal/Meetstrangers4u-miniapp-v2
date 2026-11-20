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
  let gameState = null;
  let voiceState = { active:false, muted:false, soundMuted:false, busy:false, stream:null, peers:new Map(), iceServers:[], error:null };
  let rtcPendingSignals = [];
  let connectTimer = null, gameSpinTimer = null;

  function close() {
    stopVoice();
    stopSocket(true);
    document.getElementById("td-setup-overlay")?.remove();
    currentOverlay = null;
  }
  function stopSocket(sendCancel) {
    if (connectTimer) { clearTimeout(connectTimer); connectTimer = null; }
    if (gameSpinTimer) { clearTimeout(gameSpinTimer); gameSpinTimer = null; }
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
  function showToast(message) {
    document.getElementById("td-toast")?.remove();
    const toast=document.createElement("div");
    toast.id="td-toast";toast.className="td-toast";toast.textContent=message;
    document.body.appendChild(toast);
    setTimeout(()=>toast.remove(),2800);
  }
  function open() {
    if (document.getElementById("td-setup-overlay")) return;
    const overlay = document.createElement("div");
    overlay.id = "td-setup-overlay"; overlay.className = "td-overlay"; currentOverlay = overlay;
    overlay.innerHTML = `<div class="td-sheet" role="dialog" aria-modal="true" aria-label="Truth or Dare setup">
      <button class="td-close" type="button" aria-label="Close">×</button>
      <div class="td-setup-content">
      <div class="td-kicker">FUN ZONE · MULTIPLAYER</div><div class="td-title">Truth <span>or</span> Dare</div>
      <p class="td-subtitle">Set up your game room</p>
      <div class="td-custom-selection" id="td-custom-selection" hidden><div class="td-custom-selection-count"><b>${selectedPlayers} Players</b></div><div class="td-custom-selection-mode"><b>${MODES.find(m=>m.id===selectedMode)?.title || selectedMode}</b></div></div>
      <section class="td-section td-player-section"><div class="td-label">PLAYERS</div><div class="td-player-grid">${[2,3,4,5].map(n=>`<button class="td-player ${n===selectedPlayers?'selected':''}" data-players="${n}" type="button"><b>${n}</b><small>Players</small></button>`).join("")}</div></section>
      <section class="td-section td-mode-section"><div class="td-label">GAME MODE</div><div class="td-mode-list">${MODES.map(m=>`<button class="td-mode ${m.id===selectedMode?'selected':''}" data-mode="${m.id}" type="button"><span class="td-mode-icon">${m.icon}</span><span class="td-mode-copy"><b>${m.title}</b><small>${m.desc}</small></span><span class="td-check">✓</span></button>`).join("")}</div></section>
      <div class="td-custom-rewards-preview" id="td-custom-rewards-preview" hidden></div>
      <section class="td-points"><div class="td-label">GAME SCORE · WALLET COINS NOT USED</div><div class="td-point-row"><span>Truth verified</span><b>+25 Score</b></div><div class="td-point-row"><span>Dare verified</span><b>+50 Score</b></div><div class="td-point-row"><span>Skip Truth</span><b class="minus">−25 Score</b></div><div class="td-point-row"><span>Skip Dare</span><b class="minus">−50 Score</b></div></section>
      <div class="td-custom-invites" id="td-custom-invites" hidden><label class="td-label" for="td-invite-ids">TELEGRAM USER IDs (1–4)</label><textarea id="td-invite-ids" inputmode="numeric" pattern="[0-9, ]*" maxlength="100" placeholder="Example: 123456789, 987654321"></textarea><small>Private room · Host + 1 to 4 friends · 2–5 players total</small></div><div class="td-match-actions" id="td-match-actions"><button class="td-primary td-match-btn" type="button" id="td-random-match"><span class="td-match-icon">🎲</span> Random</button><button class="td-primary td-match-btn" type="button" id="td-custom-match"><span class="td-match-icon">👥</span> Custom</button></div><button class="td-primary" type="button" id="td-confirm-setup" hidden>Create Room <span>→</span></button>
      <p class="td-footnote">Real users only · Score stays inside the game</p></div></div>`;
    document.body.appendChild(overlay);
    overlay.querySelector(".td-close").onclick = close;
    overlay.addEventListener("click", e => { if (e.target === overlay) close(); });
    overlay.querySelectorAll("[data-players]").forEach(btn => btn.onclick = () => { selectedPlayers=Number(btn.dataset.players); overlay.querySelectorAll("[data-players]").forEach(x=>x.classList.toggle("selected",x===btn)); });
    overlay.querySelectorAll("[data-mode]").forEach(btn => btn.onclick = () => { selectedMode=btn.dataset.mode; overlay.querySelectorAll("[data-mode]").forEach(x=>x.classList.toggle("selected",x===btn)); });
    overlay.querySelector("#td-random-match").onclick=()=>startQueue(selectedPlayers,selectedMode);
    overlay.querySelector("#td-custom-match").onclick=()=>{overlay.classList.add("td-custom-room-active");overlay.querySelector(".td-custom-selection-count").textContent=selectedPlayers+" Players";overlay.querySelector(".td-custom-selection-mode").textContent=MODES.find(m=>m.id===selectedMode)?.title||selectedMode;overlay.querySelector("#td-custom-selection").hidden=false;overlay.querySelector(".td-player-section").hidden=true;overlay.querySelector(".td-mode-section").hidden=true;const rewardBox=overlay.querySelector("#td-custom-rewards-preview");const secondPrize=selectedPlayers>2?50:10;rewardBox.innerHTML='<div class="td-winner-rewards-title">🏆 WINNER REWARDS</div><div class="td-reward-row"><span>🥇 <b>1st Prize</b></span><strong>100 Coins 💰</strong></div><div class="td-reward-row"><span>🥈 <b>2nd Prize</b></span><strong>'+secondPrize+' Coins 💰</strong></div>'+(selectedPlayers>2?'':'<p class="td-reward-selection-note">Want a higher 2nd prize? Please select more than 2 players.</p>')+'<p>Winning coins will be added to your wallet.</p>';rewardBox.hidden=false;overlay.querySelector("#td-custom-invites").hidden=false;overlay.querySelector("#td-match-actions").hidden=true;overlay.querySelector("#td-confirm-setup").hidden=false;};
    overlay.querySelector("#td-confirm-setup").onclick=()=>startCustomRoom(selectedMode,overlay.querySelector("#td-invite-ids").value);
    const inviteContainer=overlay.querySelector("#td-custom-invites");
    const inviteInput=overlay.querySelector("#td-invite-ids");
    const activateIdEntry=()=>{
      if(overlay.classList.contains("td-id-entry-focus"))return;
      overlay.classList.add("td-id-entry-focus");
      const boxCount=Math.max(1,selectedPlayers-1);
      const existing=(inviteInput.value||"").split(/[\s,;]+/).map(x=>x.trim()).filter(Boolean);
      inviteContainer.querySelector("#td-invite-id-boxes")?.remove();
      const boxes=document.createElement("div");
      boxes.id="td-invite-id-boxes";
      boxes.className="td-invite-id-boxes";
      boxes.innerHTML=Array.from({length:boxCount},(_,i)=>'<label class="td-invite-player-field"><span>PLAYER '+(i+1)+'</span><input type="text" inputmode="numeric" pattern="[0-9]*" maxlength="16" autocomplete="off" placeholder="Enter Telegram User ID" value="'+esc(existing[i]||'')+'"></label>').join("");
      inviteInput.insertAdjacentElement("afterend",boxes);
      boxes.querySelectorAll("input").forEach(input=>input.addEventListener("input",()=>{
        inviteInput.value=[...boxes.querySelectorAll("input")].map(x=>x.value.trim()).filter(Boolean).join(", ");
      }));
    };
    inviteContainer.addEventListener("click",activateIdEntry);
    inviteContainer.addEventListener("focusin",activateIdEntry);
    inviteContainer.addEventListener("focusout",e=>{
      if(inviteContainer.contains(e.relatedTarget))return;
      overlay.classList.remove("td-id-entry-focus");
      inviteContainer.querySelector("#td-invite-id-boxes")?.remove();
    });

  }
  function renderLobby() {
    const overlay = document.getElementById("td-setup-overlay");
    if (!overlay) return;
    const modeTitle = MODES.find(m=>m.id===lobbyState.mode)?.title || lobbyState.mode;
    let heading = "Finding Players";
    let message = "Connecting securely to matchmaking…";
    if (lobbyState.status === "waiting") { heading = lobbyState.isCustom ? "Private Room" : "Finding Players"; message = lobbyState.isCustom ? "Waiting for your invited friends to accept and join. Keep this screen open." : "Waiting for real players with the same settings. Keep this screen open."; }
    if (lobbyState.status === "room") { heading = "Room Lobby"; message = "Players joined! Everyone must tap Ready to start."; }
    if(lobbyState.isCustom&&lobbyState.status==="waiting"&&Number.isInteger(lobbyState.inviteSent)){message="Invite delivery: "+lobbyState.inviteSent+" sent"+(lobbyState.inviteFailed? ", "+lobbyState.inviteFailed+" failed":"")+". Waiting for acceptance.";}
    if (lobbyState.status === "starting") { heading = "Starting Game"; message = "All players are ready. Preparing the game…"; }
    if (lobbyState.status === "offline") { heading = "Matchmaking Offline"; message = "Game service is not reachable yet. Try again later."; }
    if (lobbyState.status === "closed") { heading = "Room Closed"; message = "A player left before the game began. You can search for a new room."; }
    const list = lobbyState.players || [];
    const myId=String(window.Telegram?.WebApp?.initDataUnsafe?.user?.id||"");
    const isHost=list.some(p=>p.host&&String(p.id)===myId);
    const canAdd=lobbyState.isCustom&&isHost&&["waiting","room"].includes(lobbyState.status)&&list.length+Number(lobbyState.pendingInviteCount||0)<lobbyState.count;
    const slots = Array.from({length:lobbyState.count}, (_,i) => {
      const p=list[i];
      const add=(!p&&canAdd)?'<button type="button" class="td-slot-add" data-add-player aria-label="Add player">＋</button>':'';
      return `<div class="td-slot ${p?'td-filled':''}"><span class="td-slot-avatar">${p?(p.host?'👑':'👤'):'＋'}</span><b>${p?esc(p.name):'Waiting for player'}</b><small>${p?(p.host?'Host':p.ready?'Ready':'Not ready'):'Open slot'}</small>${add}</div>`;
    }).join("");
    overlay.innerHTML = `<div class="td-sheet td-lobby-sheet" role="dialog" aria-modal="true" aria-label="Truth or Dare live lobby">
      <button class="td-close" type="button" aria-label="Close">×</button>
      <div class="td-kicker">LIVE MULTIPLAYER</div><div class="td-title">${heading}</div>
      <p class="td-subtitle">${lobbyState.count} players · ${modeTitle}</p>
      <div class="td-lobby-status"><span class="td-status-dot ${lobbyState.status}"></span><span>${message}</span></div>
      <div class="td-room-preview"><div class="td-room-label">PLAYERS · ${list.length}/${lobbyState.count}</div><div class="td-slots">${slots}</div></div>
      ${lobbyState.notice?`<div class="td-lobby-decline">${esc(lobbyState.notice)}</div>`:""}
      ${lobbyState.addInviteOpen?`<div class="td-add-player-form"><input id="td-add-player-id" type="text" inputmode="numeric" maxlength="16" placeholder="Telegram User ID"><button class="td-primary" id="td-send-player-invite" type="button">Send Invitation</button></div>`:""}
      ${((lobbyState.isCustom&&["waiting","room"].includes(lobbyState.status))||(!lobbyState.isCustom&&["room","starting"].includes(lobbyState.status)))?`<div class="td-lobby-voice"><div class="td-label">VOICE CHAT · LOBBY</div><div class="td-voice-state">${voiceState.active?"Voice chat connected":voiceState.busy?"Connecting microphone…":"Join voice to talk before the game"}</div>${voiceState.error?`<p class="td-voice-error">${esc(voiceState.error)}</p>`:""}<div class="td-action-grid">${voiceState.active?`<button class="td-secondary" id="td-lobby-mic">${voiceState.muted?"🎙️ Unmute Microphone":"🔇 Mute Microphone"}</button><button class="td-secondary" id="td-lobby-sound">${voiceState.soundMuted?"🔊 Sound On":"🔈 Sound Off"}</button><button class="td-secondary" id="td-lobby-voice-leave">Leave Voice</button>`:`<button class="td-primary td-voice-start" id="td-lobby-voice-join" ${voiceState.busy?"disabled":""}>🎙️ Join Voice Chat</button><button class="td-secondary" id="td-lobby-sound">${voiceState.soundMuted?"🔊 Sound On":"🔈 Sound Off"}</button>`}</div></div>`:""}
      <div class="td-lobby-summary"><span>Mode</span><b>${esc(modeTitle)}</b><span>Win target</span><b>1000 Score</b><span>Room</span><b>${lobbyState.roomId?esc(lobbyState.roomId.slice(0,8)):'Searching…'}</b></div>
      ${lobbyState.status==="room" ? `<button class="td-primary td-ready-btn" type="button">${lobbyState.ready?'✓ Ready — Tap to Unready':'I’m Ready'}</button>` : ""}
      ${(lobbyState.status==="offline" || lobbyState.status==="closed") ? `<button class="td-primary td-retry-btn" type="button">Retry Matchmaking</button>` : ""}
      <button class="td-secondary td-cancel-btn" type="button">${lobbyState.status==="room"?"Leave Room":"Cancel Search"}</button>
      <p class="td-footnote">No bots · No wallet coins · Server-authoritative room</p></div>`;
    overlay.querySelector(".td-close").onclick = close;
    overlay.querySelector(".td-cancel-btn").onclick = () => { stopSocket(true); close(); open(); };
    overlay.querySelectorAll("[data-add-player]").forEach(btn=>btn.addEventListener("click",()=>{lobbyState.addInviteOpen=true;renderLobby();}));
    overlay.querySelector("#td-send-player-invite")?.addEventListener("click",()=>{const input=overlay.querySelector("#td-add-player-id");const id=(input?.value||"").trim();if(!/^\d{5,16}$/.test(id)){showToast("Enter a valid Telegram User ID");return;}if(!socket||socket.readyState!==WebSocket.OPEN){showToast("Room connection is unavailable");return;}socket.send(JSON.stringify({type:"host-add-invite",inviteeId:id}));lobbyState.addInviteOpen=false;renderLobby();});
    overlay.querySelector("#td-lobby-voice-join")?.addEventListener("click",startVoice);
    overlay.querySelector("#td-lobby-mic")?.addEventListener("click",toggleVoiceMute);
    overlay.querySelector("#td-lobby-sound")?.addEventListener("click",toggleSoundMute);
    overlay.querySelector("#td-lobby-voice-leave")?.addEventListener("click",stopVoice);
    overlay.querySelector(".td-ready-btn")?.addEventListener("click", () => {
      if (!socket || socket.readyState !== WebSocket.OPEN) return;
      lobbyState.ready = !lobbyState.ready;
      socket.send(JSON.stringify({ type:"ready", ready:lobbyState.ready }));
      renderLobby();
    });
    overlay.querySelector(".td-retry-btn")?.addEventListener("click", () => startQueue(lobbyState.count, lobbyState.mode));
  }
  function closeVoicePeerFor(peerId){const peer=voiceState.peers.get(String(peerId));if(peer){try{peer.pc.close();}catch(_){}voiceState.peers.delete(String(peerId));}document.getElementById("td-remote-audio-"+String(peerId))?.remove();}
  function sendRtc(to, signal) { if(socket && socket.readyState===WebSocket.OPEN) socket.send(JSON.stringify({type:"rtc-signal",to,signal})); }
  function createVoicePeer(peerId) {
    if(voiceState.peers.has(peerId)) return voiceState.peers.get(peerId);
    const pc=new RTCPeerConnection({iceServers:voiceState.iceServers.length?voiceState.iceServers:[{urls:"stun:stun.google.com:19302"}],iceTransportPolicy:"all"});
    const state={pc,pendingIce:[]};voiceState.peers.set(peerId,state);
    if(voiceState.stream)voiceState.stream.getTracks().forEach(track=>pc.addTrack(track,voiceState.stream));
    pc.onicecandidate=e=>{if(e.candidate)sendRtc(peerId,{candidate:e.candidate.toJSON?e.candidate.toJSON():e.candidate});};
    pc.ontrack=e=>{let audio=document.getElementById("td-remote-audio-"+peerId);if(!audio){audio=document.createElement("audio");audio.id="td-remote-audio-"+peerId;audio.autoplay=true;audio.playsInline=true;audio.style.position="fixed";audio.style.width="1px";audio.style.height="1px";audio.style.opacity="0";audio.style.pointerEvents="none";document.body.appendChild(audio);}audio.srcObject=e.streams[0];audio.volume=voiceState.soundMuted?0:1;audio.play().catch(()=>{});};
    pc.onconnectionstatechange=()=>{if(pc.connectionState==="failed"||pc.connectionState==="closed"){const a=document.getElementById("td-remote-audio-"+peerId);if(a)a.remove();}};
    return state;
  }
  async function flushVoiceIce(peer) {if(!peer.pc.remoteDescription)return;for(const candidate of peer.pendingIce.splice(0)){try{await peer.pc.addIceCandidate(new RTCIceCandidate(candidate));}catch(_){}}}
  async function handleRtcSignal(from,signal) {
    if(!voiceState.active||!signal){if(rtcPendingSignals.length<20)rtcPendingSignals.push({from,signal});return;}
    const peer=createVoicePeer(from);
    if(signal.candidate){if(peer.pc.remoteDescription){try{await peer.pc.addIceCandidate(new RTCIceCandidate(signal.candidate));}catch(_){}}else peer.pendingIce.push(signal.candidate);return;}
    if(signal.type==="offer"&&signal.description){await peer.pc.setRemoteDescription(new RTCSessionDescription(signal.description));await flushVoiceIce(peer);const answer=await peer.pc.createAnswer();await peer.pc.setLocalDescription(answer);sendRtc(from,{type:"answer",description:peer.pc.localDescription});}
    else if(signal.type==="answer"&&signal.description){await peer.pc.setRemoteDescription(new RTCSessionDescription(signal.description));await flushVoiceIce(peer);}
  }
  async function startVoice() {
    if(voiceState.active||voiceState.busy)return;
    if(!navigator.mediaDevices?.getUserMedia||!window.RTCPeerConnection){voiceState.error="Voice calling is not supported in this browser.";gameState?renderGame():renderLobby();return;}
    voiceState.busy=true;voiceState.error=null;gameState?renderGame():renderLobby();
    try{
      const tgWebApp=window.Telegram?.WebApp;
      if(!tgWebApp?.initData)throw new Error("Please reopen the Mini App from Telegram.");
      const turnResponse=await fetch("https://call.lxreward.xyz/api/turn-credentials",{headers:{"X-Telegram-Init-Data":tgWebApp.initData},cache:"no-store"});
      const turnData=await turnResponse.json().catch(()=>({}));
      if(!turnResponse.ok||!Array.isArray(turnData.iceServers)||!turnData.iceServers.length)throw new Error(turnData.message||"Unable to prepare secure voice chat.");
      voiceState.iceServers=turnData.iceServers;
      const stream=await navigator.mediaDevices.getUserMedia({audio:true,video:false});
      voiceState.stream=stream;voiceState.active=true;voiceState.muted=false;voiceState.busy=false;
      if(socket&&socket.readyState===WebSocket.OPEN)socket.send(JSON.stringify({type:"voice-status",active:true}));
      const myId=String(gameState?.userId||window.Telegram?.WebApp?.initDataUnsafe?.user?.id||"");
      const peers=(gameState?(gameState.players||[]):(lobbyState.players||[])).filter(p=>String(p.id)!==myId&&(gameState||p.voiceActive));
      for(const p of peers){const peer=createVoicePeer(String(p.id));if(myId<String(p.id)){const offer=await peer.pc.createOffer();await peer.pc.setLocalDescription(offer);sendRtc(String(p.id),{type:"offer",description:peer.pc.localDescription});}}
      const pending=rtcPendingSignals.splice(0);for(const signal of pending)await handleRtcSignal(signal.from,signal.signal);
      gameState?renderGame():renderLobby();
    }catch(err){voiceState.busy=false;voiceState.active=false;voiceState.error=err?.name==="NotAllowedError"?"Microphone permission was denied.":(err?.message||"Could not start voice.");if(voiceState.stream)voiceState.stream.getTracks().forEach(t=>t.stop());voiceState.stream=null;gameState?renderGame():renderLobby();}
  }
  function toggleVoiceMute(){if(!voiceState.active||!voiceState.stream)return;voiceState.muted=!voiceState.muted;voiceState.stream.getAudioTracks().forEach(t=>t.enabled=!voiceState.muted);gameState?renderGame():renderLobby();}
  function toggleSoundMute(){voiceState.soundMuted=!voiceState.soundMuted;document.querySelectorAll("[id^=td-remote-audio-]").forEach(a=>a.volume=voiceState.soundMuted?0:1);gameState?renderGame():renderLobby();}
  function stopVoice(){
    if(voiceState.active&&socket&&socket.readyState===WebSocket.OPEN)socket.send(JSON.stringify({type:"voice-status",active:false}));
    voiceState.peers.forEach(peer=>{try{peer.pc.close();}catch(_){}});
    voiceState.peers.clear();rtcPendingSignals=[];
    if(voiceState.stream)voiceState.stream.getTracks().forEach(t=>t.stop());
    voiceState.stream=null;voiceState.active=false;voiceState.muted=false;voiceState.soundMuted=false;voiceState.busy=false;voiceState.iceServers=[];
    document.querySelectorAll('[id^="td-remote-audio-"]').forEach(a=>a.remove());
    if(!gameState&&document.getElementById("td-setup-overlay"))renderLobby();
  }

  function sendGameAction(type, payload={}) {
    if(socket && socket.readyState===WebSocket.OPEN) socket.send(JSON.stringify({type,...payload}));
  }
  function renderGame(spinning=false) {
    const overlay=document.getElementById("td-setup-overlay");
    if(!overlay || !gameState) return;
    const chatDraft=document.getElementById("td-chat-input")?.value||"";
    const players=gameState.players||lobbyState.players||[];
    const scores=gameState.scores||{};
    const active=players.find(p=>p.id===gameState.selectedId);
    const me=players.find(p=>p.id===gameState.userId);
    const isMyTurn=gameState.selectedId===gameState.userId;
    const challenge=gameState.challenge;
    const phase=gameState.phase||"spin";
    const rank=(gameState.ranked||players.map(p=>({id:p.id,name:p.name,score:scores[p.id]||0}))).sort((a,b)=>b.score-a.score);
    const scoreRows=rank.map(p=>'<div class="td-score-row '+(p.id===gameState.selectedId?'active':'')+'"><span>'+esc(p.name)+(p.id===gameState.userId?' (You)':'')+'</span><b>'+Number(p.score||scores[p.id]||0)+' Score</b></div>').join("");
    const secondPrize=players.length>2?50:10;
    const rewardNote=players.length>2?"":"<p class=\"td-reward-selection-note\">Want a higher 2nd prize? Please select more than 2 players.</p>";
    const chatRows=(gameState.chat||[]).slice(-18).map(m=>'<div class="td-chat-line"><b>'+esc(m.playerName)+'</b> '+esc(m.text)+'</div>').join("");
    let action="";
    if(phase==="spin") action='<button class="td-primary" id="td-spin">🎯 Spin the Bottle</button><p class="td-footnote">Anyone in the room can spin to choose the next player.</p>';
    if(phase==="choose" && isMyTurn) action='<div class="td-action-grid"><button class="td-primary" id="td-truth">💭 Truth</button><button class="td-primary td-dare" id="td-dare">🔥 Dare</button></div>';
    if(phase==="task" && isMyTurn) action='<button class="td-primary" id="td-complete">✅ I completed it</button><button class="td-secondary" id="td-skip">Skip challenge</button>';
    if(phase==="verify" && !isMyTurn && !(gameState.votes||{})[gameState.userId]) action='<div class="td-action-grid"><button class="td-primary td-verify-yes" id="td-vote-yes">✓ Verify</button><button class="td-secondary td-verify-no" id="td-vote-no">✕ Not done</button></div>';
    if(phase==="verify" && (gameState.votes||{})[gameState.userId]) action='<p class="td-footnote">Your verification vote has been submitted.</p>';
    if(phase==="finished") action='<button class="td-primary" id="td-game-close">Close Game</button>';
    overlay.innerHTML='<div class="td-sheet td-game-sheet" role="dialog" aria-modal="true" aria-label="Truth or Dare game">'+
      '<button class="td-close" id="td-game-exit" type="button" aria-label="Leave game">×</button>'+
      '<div class="td-kicker">LIVE GAME · ROUND '+Number(gameState.round||0)+'</div><div class="td-title">Truth <span>or</span> Dare</div>'+
      '<div class="td-game-status">'+esc(gameState.resultText||((phase==="spin")?"Ready for the next spin":phase==="choose"?"Choose your challenge":phase==="task"?"Challenge time!":phase==="verify"?"Players are verifying": "Game finished"))+'</div>'+
      '<div class="td-bottle-wrap"><div class="td-bottle '+(spinning?"td-spin-anim":"")+'" style="--td-rotation:'+Number(gameState.spinRotation||0)+'deg">🍾</div></div>'+
      '<div class="td-selected">'+(active?'Selected: <b>'+esc(active.name)+'</b>':(phase==="choose"?'Choose Truth or Dare':'Spin to select a player'))+'</div>'+
      '<div class="td-winner-rewards"><div class="td-winner-rewards-title">🏆 WINNER REWARDS</div><div class="td-reward-row"><span>🥇 <b>1st Prize</b></span><strong>100 Coins 💰</strong></div><div class="td-reward-row"><span>🥈 <b>2nd Prize</b></span><strong>'+secondPrize+' Coins 💰</strong></div>'+rewardNote+'<p>Winning coins will be added to your wallet.</p></div>'+
      '<div class="td-score-panel"><div class="td-label">SCORES · TARGET 1000</div>'+scoreRows+'</div>'+
      (challenge?'<div class="td-challenge-card"><div class="td-challenge-type">'+(challenge.type==="truth"?"💭 TRUTH":"🔥 DARE")+'</div><div class="td-challenge-text">'+esc(challenge.text)+'</div><small>For '+esc(challenge.playerName||"player")+'</small></div>':'')+
      (phase==="verify"?'<div class="td-vote-summary">Verified: '+Number(gameState.yes||0)+' / '+Number(gameState.requiredVotes||0)+' approvals needed</div>':'')+
      action+
      (gameState.ranked&&phase==="finished"?'<div class="td-score-panel"><div class="td-label">FINAL RANKING</div>'+rank.map((p,i)=>'<div class="td-score-row"><span>'+(i+1)+'. '+esc(p.name)+'</span><b>'+Number(p.score||0)+' Score</b></div>').join("")+'</div>':'')+
      '<div class="td-voice-panel"><div class="td-label">VOICE CHAT · OPTIONAL</div><div class="td-voice-state">'+(voiceState.active?(voiceState.muted?"Mic muted":"Microphone on"):voiceState.busy?"Requesting microphone…":"Tap to join voice")+'</div>'+(voiceState.error?'<p class="td-voice-error">'+esc(voiceState.error)+'</p>':'')+(voiceState.active?'<div class="td-action-grid"><button class="td-primary td-voice-mute" id="td-voice-mute">'+(voiceState.muted?"🔊 Unmute":"🔇 Mute")+'</button><button class="td-secondary" id="td-voice-stop">Leave Voice</button></div>':'<button class="td-primary td-voice-start" id="td-voice-start" '+(voiceState.busy?'disabled':'')+'>🎙️ Join Voice Chat</button>')+'</div>'+'<div class="td-chat-panel"><div class="td-label">ROOM CHAT</div><div class="td-chat-log" id="td-chat-log">'+chatRows+'</div><div class="td-chat-input"><input id="td-chat-input" maxlength="240" placeholder="Message players…"><button id="td-chat-send">Send</button></div></div>'+
      '<button class="td-secondary" id="td-game-leave">Leave Game</button><p class="td-footnote">Game score only · wallet coins are not used</p></div>';
    const chatInput=overlay.querySelector("#td-chat-input");if(chatInput)chatInput.value=chatDraft;
    const spinBtn=overlay.querySelector("#td-spin");
    spinBtn?.addEventListener("click",()=>sendGameAction("spin"));
    overlay.querySelector("#td-truth")?.addEventListener("click",()=>sendGameAction("choose-challenge",{choice:"truth"}));
    overlay.querySelector("#td-dare")?.addEventListener("click",()=>sendGameAction("choose-challenge",{choice:"dare"}));
    overlay.querySelector("#td-complete")?.addEventListener("click",()=>sendGameAction("submit-task"));
    overlay.querySelector("#td-skip")?.addEventListener("click",()=>sendGameAction("skip-challenge"));
    overlay.querySelector("#td-vote-yes")?.addEventListener("click",()=>sendGameAction("verify-vote",{vote:"yes"}));
    overlay.querySelector("#td-vote-no")?.addEventListener("click",()=>sendGameAction("verify-vote",{vote:"no"}));
    const sendChat=()=>{const input=overlay.querySelector("#td-chat-input");const val=input?.value.trim();if(val){sendGameAction("chat",{text:val});input.value="";}};
    overlay.querySelector("#td-voice-start")?.addEventListener("click",startVoice);
    overlay.querySelector("#td-voice-mute")?.addEventListener("click",toggleVoiceMute);
    overlay.querySelector("#td-voice-stop")?.addEventListener("click",()=>{stopVoice();renderGame();});
    overlay.querySelector("#td-chat-send")?.addEventListener("click",sendChat);
    overlay.querySelector("#td-chat-input")?.addEventListener("keydown",e=>{if(e.key==="Enter")sendChat();});
    const log=overlay.querySelector("#td-chat-log");if(log)log.scrollTop=log.scrollHeight;
    overlay.querySelector("#td-game-leave")?.addEventListener("click",close);
    overlay.querySelector("#td-game-exit")?.addEventListener("click",close);
    overlay.querySelector("#td-game-close")?.addEventListener("click",close);
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
      if(data.type==="voice-joined"||data.type==="voice-left"){lobbyState.players=data.players||lobbyState.players;if(data.type==="voice-joined"&&voiceState.active&&String(data.playerId)!==String(window.Telegram?.WebApp?.initDataUnsafe?.user?.id||"")){const me=String(window.Telegram?.WebApp?.initDataUnsafe?.user?.id||""),peerId=String(data.playerId);if(me<peerId){const peer=createVoicePeer(peerId);if(!peer.pc.localDescription){peer.pc.createOffer().then(o=>peer.pc.setLocalDescription(o)).then(()=>sendRtc(peerId,{type:"offer",description:peer.pc.localDescription})).catch(()=>{});}}}if(!gameState)renderLobby();}
      if(data.type==="player-left"&&!gameState){closeVoicePeerFor(data.playerId);lobbyState.players=data.players||[];renderLobby();}
      if(data.type==="game-start"){ lobbyState.status="starting"; lobbyState.players=data.players||lobbyState.players; renderLobby(); }
      if(data.type==="game-state"){ gameState={...data, userId:window.Telegram.WebApp.initDataUnsafe?.user?.id?String(window.Telegram.WebApp.initDataUnsafe.user.id):null, chat:[], resultText:null, selectedId:null, votes:{}, yes:0, requiredVotes:0, phase:"spin"}; renderGame(); }
      if(data.type==="bottle-spin" && gameState){ gameState.round=data.round; gameState.selectedId=data.selectedId; gameState.resultText=null; gameState.phase="spin-animation"; const idx=(gameState.players||[]).findIndex(p=>p.id===data.selectedId); gameState.spinRotation=1440+Math.max(0,idx)*360/Math.max(1,(gameState.players||[]).length); renderGame(true); if(gameSpinTimer)clearTimeout(gameSpinTimer); gameSpinTimer=setTimeout(()=>{if(gameState){gameState.phase="choose";renderGame();}gameSpinTimer=null;},Math.max(1000,Number(data.spinMs||4200))); }
      if(data.type==="challenge" && gameState){ gameState.challenge=data.challenge; gameState.phase="task"; gameState.resultText="Selected player: choose and complete the task"; renderGame(); }
      if(data.type==="task-submitted" && gameState){ gameState.challenge=data.challenge; gameState.phase="verify"; gameState.votes={}; gameState.requiredVotes=data.requiredVotes; gameState.yes=0; gameState.resultText="Others: verify whether the task was completed"; renderGame(); }
      if(data.type==="verification-update" && gameState){ gameState.votes=data.votes||{}; gameState.yes=data.yes||0; gameState.no=data.no||0; gameState.requiredVotes=data.required||gameState.requiredVotes; renderGame(); }
      if(data.type==="challenge-result" && gameState){ gameState.scores=data.scores||gameState.scores; gameState.phase=data.nextPhase||"spin"; gameState.challenge=null; gameState.votes={}; gameState.ranked=data.ranked; gameState.resultText=data.skipped?"Challenge skipped · "+data.delta+" Score":data.accepted?"Verified · +"+data.delta+" Score":"Verification failed · no score"; renderGame(); }
      if(data.type==="game-over" && gameState){ gameState.phase="finished"; gameState.ranked=data.ranked; gameState.resultText="🏆 "+data.winner.name+" wins!"; renderGame(); }
      if(data.type==="chat-message" && gameState){ gameState.chat=(gameState.chat||[]).concat(data).slice(-40); renderGame(); }
      if(data.type==="rtc-signal" && (gameState||lobbyState.isCustom||["room","starting"].includes(lobbyState.status))){ handleRtcSignal(String(data.from||""),data.signal).catch(()=>{}); }
      if(data.type==="player-left" && gameState){ closeVoicePeerFor(data.playerId); gameState.players=data.players||[]; renderGame(); }
      if(data.type==="room-closed"){ stopVoice(); gameState=null; lobbyState.status="closed"; lobbyState.roomId=null; lobbyState.players=[]; lobbyState.ready=false; renderLobby(); }
      if(data.type==="queue-cancelled"){ lobbyState.status="idle"; }
      if(data.type==="error"){if(["ALREADY_INVITED","ROOM_FULL","INVITEE_BUSY","HOST_ONLY_INVITE","INVALID_INVITE_ID"].includes(data.code)){showToast(({ALREADY_INVITED:"This user has already been invited.",ROOM_FULL:"The room is full.",INVITEE_BUSY:"This user is currently busy.",HOST_ONLY_INVITE:"Only the host can invite players.",INVALID_INVITE_ID:"Enter a valid Telegram User ID."})[data.code]);}else if(gameState){gameState.resultText="Action failed: "+String(data.code||"error");renderGame();}else{lobbyState.status="offline";renderLobby();}}
    };
    ws.onerror=()=>{ if(socket===ws){lobbyState.status="offline";renderLobby();} };
    ws.onclose=()=>{ if(socket===ws && !["starting"].includes(lobbyState.status)){lobbyState.status="offline";renderLobby();} };
  }

  function startCustomRoom(mode, inviteText) {
    const ids=[...new Set((inviteText||"").split(/[\s,;]+/).map(x=>x.trim()).filter(Boolean))];
    if(ids.length<1||ids.length>4){alert("Please enter 1 to 4 Telegram numeric IDs.");return;}
    if(ids.some(x=>!/^\d{5,16}$/.test(x))){alert("Telegram IDs must be numeric. Check the IDs.");return;}
    const myId=String(window.Telegram?.WebApp?.initDataUnsafe?.user?.id||"");
    if(ids.includes(myId)){alert("You cannot invite yourself.");return;}
    startCustomSocket(mode,ids);
  }
  function startCustomSocket(mode, inviteIds) {
    stopSocket(true);const count=inviteIds.length+1;
    lobbyState={status:"connecting",players:[],roomId:null,ready:false,target:1000,count,mode,isCustom:true};renderLobby();
    if(!window.Telegram?.WebApp?.initData){lobbyState.status="offline";renderLobby();return;}
    let ws;try{ws=new WebSocket(WS_ENDPOINT+"?customRoom=1&initData="+encodeURIComponent(window.Telegram.WebApp.initData));}catch(_){lobbyState.status="offline";renderLobby();return;}socket=ws;
    connectTimer=setTimeout(()=>{if(socket===ws&&ws.readyState!==WebSocket.OPEN){lobbyState.status="offline";renderLobby();try{ws.close();}catch(_){}}},12000);
    ws.onopen=()=>{if(socket!==ws)return;if(connectTimer){clearTimeout(connectTimer);connectTimer=null;}ws.send(JSON.stringify({type:"create-custom-room",mode,inviteIds}));};
    ws.onmessage=event=>{if(socket!==ws)return;let data;try{data=JSON.parse(event.data);}catch(_){return;}
      if(data.type==="connected")return;
      if(data.type==="custom-room-created"){lobbyState.status="waiting";lobbyState.roomId=data.roomId;lobbyState.players=data.players||[];lobbyState.pendingInviteCount=Number(data.pendingInviteCount||0);renderLobby();}
      if(data.type==="custom-joined"){lobbyState.status="waiting";lobbyState.roomId=data.roomId;lobbyState.players=data.players||[];lobbyState.isCustom=true;renderLobby();}
      if(data.type==="custom-invites-sent"){lobbyState.inviteSent=data.sent||0;lobbyState.inviteFailed=data.failed||0;lobbyState.pendingInviteCount=Number(data.pendingInviteCount??data.sent??0);renderLobby();}
      if(data.type==="custom-room-updated"){lobbyState.players=data.players||lobbyState.players;lobbyState.pendingInviteCount=Number(data.pendingInviteCount||0);lobbyState.notice=null;renderLobby();}
      if(data.type==="custom-invite-sent"){if(data.sent){lobbyState.pendingInviteCount=Number(lobbyState.pendingInviteCount||0)+1;lobbyState.notice=null;showToast("Invitation sent successfully!");}else showToast("Invitation could not be delivered. Check the User ID.");renderLobby();}
      if(data.type==="voice-joined"||data.type==="voice-left"){lobbyState.players=data.players||lobbyState.players;if(data.type==="voice-joined"&&voiceState.active&&String(data.playerId)!==String(window.Telegram?.WebApp?.initDataUnsafe?.user?.id||"")){const me=String(window.Telegram?.WebApp?.initDataUnsafe?.user?.id||""),peerId=String(data.playerId);if(me<peerId){const peer=createVoicePeer(peerId);if(!peer.pc.localDescription){peer.pc.createOffer().then(o=>peer.pc.setLocalDescription(o)).then(()=>sendRtc(peerId,{type:"offer",description:peer.pc.localDescription})).catch(()=>{});}}}if(!gameState)renderLobby();}
      if(data.type==="invite-declined"){if(data.closeRoom){stopVoice();stopSocket(true);gameState=null;lobbyState={status:"idle",players:[],roomId:null,ready:false,target:1000,count:2,mode:"normal"};document.getElementById("td-setup-overlay")?.remove();currentOverlay=null;showToast("Your partner declined your request");}else{lobbyState.players=data.players||lobbyState.players;lobbyState.pendingInviteCount=Number(data.pendingInviteCount||0);lobbyState.notice=(data.inviteeName||("User "+data.inviteeId))+" declined your invitation. Tap + to enter another user’s ID and send a new invitation.";renderLobby();}}
      if(data.type==="room-formed"){lobbyState.status="room";lobbyState.roomId=data.roomId;lobbyState.players=data.players||[];lobbyState.pendingInviteCount=0;lobbyState.notice=null;lobbyState.ready=false;renderLobby();}
      if(data.type==="ready-update"){lobbyState.players=data.players||lobbyState.players;renderLobby();}
      if(data.type==="game-start"){lobbyState.status="starting";lobbyState.players=data.players||lobbyState.players;renderLobby();}
      if(data.type==="game-state"){gameState={...data,userId:String(window.Telegram.WebApp.initDataUnsafe?.user?.id||""),chat:[],resultText:null,selectedId:null,votes:{},yes:0,requiredVotes:0,phase:"spin"};renderGame();}
      if(data.type==="bottle-spin"&&gameState){gameState.round=data.round;gameState.selectedId=data.selectedId;gameState.resultText=null;gameState.phase="spin-animation";const idx=(gameState.players||[]).findIndex(p=>p.id===data.selectedId);gameState.spinRotation=1440+Math.max(0,idx)*360/Math.max(1,(gameState.players||[]).length);renderGame(true);if(gameSpinTimer)clearTimeout(gameSpinTimer);gameSpinTimer=setTimeout(()=>{if(gameState){gameState.phase="choose";renderGame();}gameSpinTimer=null;},Math.max(1000,Number(data.spinMs||4200)));}
      if(data.type==="challenge"&&gameState){gameState.challenge=data.challenge;gameState.phase="task";gameState.resultText="Selected player: choose and complete the task";renderGame();}
      if(data.type==="task-submitted"&&gameState){gameState.challenge=data.challenge;gameState.phase="verify";gameState.votes={};gameState.requiredVotes=data.requiredVotes;gameState.yes=0;gameState.resultText="Others: verify whether the task was completed";renderGame();}
      if(data.type==="verification-update"&&gameState){gameState.votes=data.votes||{};gameState.yes=data.yes||0;gameState.no=data.no||0;gameState.requiredVotes=data.required||gameState.requiredVotes;renderGame();}
      if(data.type==="challenge-result"&&gameState){gameState.scores=data.scores||gameState.scores;gameState.phase=data.nextPhase||"spin";gameState.challenge=null;gameState.votes={};gameState.ranked=data.ranked;gameState.resultText=data.skipped?"Challenge skipped · "+data.delta+" Score":data.accepted?"Verified · +"+data.delta+" Score":"Verification failed · no score";renderGame();}
      if(data.type==="game-over"&&gameState){gameState.phase="finished";gameState.ranked=data.ranked;gameState.resultText="🏆 "+data.winner.name+" wins!";renderGame();}
      if(data.type==="chat-message"&&gameState){gameState.chat=(gameState.chat||[]).concat(data).slice(-40);renderGame();}
      if(data.type==="rtc-signal"&&(gameState||lobbyState.isCustom)){handleRtcSignal(String(data.from||""),data.signal).catch(()=>{});}
      if(data.type==="player-left"&&gameState){closeVoicePeerFor(data.playerId);gameState.players=data.players||[];renderGame();}
      if(data.type==="room-closed"){stopVoice();gameState=null;lobbyState.status="closed";lobbyState.roomId=null;lobbyState.players=[];lobbyState.ready=false;renderLobby();}
      if(data.type==="error"){const code=String(data.code||"error");if(gameState){gameState.resultText="Action failed: "+code;renderGame();}else{lobbyState.status="offline";renderLobby();alert("Custom room: "+code);}}
    };
    ws.onerror=()=>{if(socket===ws){lobbyState.status="offline";renderLobby();}};ws.onclose=()=>{if(socket===ws&&!["starting"].includes(lobbyState.status)){lobbyState.status="offline";renderLobby();}};
  }
  function joinCustomRoom(token) {
    if(!token)return;open();stopSocket(true);lobbyState={status:"connecting",players:[],roomId:null,ready:false,target:1000,count:2,mode:"normal",isCustom:true};renderLobby();
    if(!window.Telegram?.WebApp?.initData){lobbyState.status="offline";renderLobby();return;}let ws;try{ws=new WebSocket(WS_ENDPOINT+"?inviteToken="+encodeURIComponent(token)+"&initData="+encodeURIComponent(window.Telegram.WebApp.initData));}catch(_){lobbyState.status="offline";renderLobby();return;}socket=ws;
    connectTimer=setTimeout(()=>{if(socket===ws&&ws.readyState!==WebSocket.OPEN){lobbyState.status="offline";renderLobby();try{ws.close();}catch(_){}}},12000);
    ws.onopen=()=>{if(socket!==ws)return;if(connectTimer){clearTimeout(connectTimer);connectTimer=null;}ws.send(JSON.stringify({type:"join-custom-room",token}));};
    ws.onmessage=event=>{if(socket!==ws)return;let data;try{data=JSON.parse(event.data);}catch(_){return;}
      if(data.type==="connected")return;
      if(data.type==="custom-joined"){lobbyState.status="waiting";lobbyState.count=data.playerCount;lobbyState.mode=data.mode;lobbyState.roomId=data.roomId;lobbyState.players=data.players||[];renderLobby();}
      if(data.type==="room-formed"){lobbyState.status="room";lobbyState.roomId=data.roomId;lobbyState.count=data.playerCount;lobbyState.mode=data.mode;lobbyState.players=data.players||[];lobbyState.ready=false;renderLobby();}
      if(data.type==="ready-update"){lobbyState.players=data.players||lobbyState.players;renderLobby();}
      if(data.type==="game-start"){lobbyState.status="starting";lobbyState.players=data.players||lobbyState.players;renderLobby();}
      if(data.type==="game-state"){gameState={...data,userId:String(window.Telegram.WebApp.initDataUnsafe?.user?.id||""),chat:[],resultText:null,selectedId:null,votes:{},yes:0,requiredVotes:0,phase:"spin"};renderGame();}
      if(data.type==="voice-joined"||data.type==="voice-left"){lobbyState.players=data.players||lobbyState.players;if(data.type==="voice-joined"&&voiceState.active&&String(data.playerId)!==String(window.Telegram?.WebApp?.initDataUnsafe?.user?.id||"")){const me=String(window.Telegram?.WebApp?.initDataUnsafe?.user?.id||""),peerId=String(data.playerId);if(me<peerId){const peer=createVoicePeer(peerId);if(!peer.pc.localDescription){peer.pc.createOffer().then(o=>peer.pc.setLocalDescription(o)).then(()=>sendRtc(peerId,{type:"offer",description:peer.pc.localDescription})).catch(()=>{});}}}if(!gameState)renderLobby();}
      if(data.type==="rtc-signal"&&(gameState||lobbyState.isCustom)){handleRtcSignal(String(data.from||""),data.signal).catch(()=>{});}
      if(data.type==="error"){lobbyState.status="offline";renderLobby();alert("Invitation failed or expired: "+String(data.code||""));} 
    };
    ws.onerror=()=>{lobbyState.status="offline";renderLobby();};ws.onclose=()=>{if(socket===ws&&!["starting"].includes(lobbyState.status)){lobbyState.status="offline";renderLobby();}};
  }

  window.openTruthDareSetup=open;
  const queryStartParam=new URLSearchParams(location.search).get("tdjoin");
  const telegramStartParam=window.Telegram?.WebApp?.initDataUnsafe?.start_param;
  const startParam=[queryStartParam,telegramStartParam].find(value=>typeof value==="string"&&value.startsWith("tdjoin_"));
  if(startParam){window.Telegram?.WebApp?.ready?.();joinCustomRoom(startParam.slice(7));}
})();