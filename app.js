
const tg = window.Telegram?.WebApp;

if (tg) {
  tg.ready();
  tg.expand();
}

const app = document.getElementById("app");

const state = {
  screen: "home",
  history: [],
  user: tg?.initDataUnsafe?.user || null,
  coins: 200,
  call: { type: null, status: "idle", sessionId: null, startedAt: null }
};

function icon(name) {
  const icons = {
    game: "🎮",
    call: "📞",
    profile: "👤",
    random: "🌍",
    partner: "🤝",
    back: "←",
    search: "🔎",
    shield: "🛡️"
  };

  return icons[name] || "•";
}


function visualIcon(name) {
  const paths = {
    game: '<path d="M6 11h4m-2-2v4m7-2h.01M18 9h.01M7 6h10a4 4 0 0 1 3.9 3.1l1 5A3 3 0 0 1 17 17l-2-2H9l-2 2a3 3 0 0 1-4.9-2.9l1-5A4 4 0 0 1 7 6Z"/>',
    call: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.4 19.4 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7l.5 2.8a2 2 0 0 1-.6 1.8L7.1 10a16 16 0 0 0 6 6l1.7-1.9a2 2 0 0 1 1.8-.6l2.8.5a2 2 0 0 1 1.6 1.9Z"/>',
    explore: '<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2.2 4.8-4.8 2.2 2.2-4.8 4.8-2.2Z"/>',
    profile: '<circle cx="12" cy="8" r="4"/><path d="M5 21a7 7 0 0 1 14 0"/>',
    phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.4 19.4 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7l.5 2.8a2 2 0 0 1-.6 1.8L7.1 10a16 16 0 0 0 6 6l1.7-1.9a2 2 0 0 1 1.8-.6l2.8.5a2 2 0 0 1 1.6 1.9Z"/>',
    video: '<rect x="3" y="6" width="13" height="12" rx="3"/><path d="m16 10 5-3v10l-5-3"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/>'
  };
  return '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' + (paths[name] || '') + '</svg>';
}

function header() {
  return `
    <header class="app-header">
      <div class="header-left">
        ${state.screen !== "home" ? '<button class="header-back" onclick="goBack()" aria-label="Go back"><span class="back-arrow">←</span><span>Back</span></button>' : ''}
        <div class="brand-lockup">
          
          <div class="brand-copy">
            <div class="brand-name">MeetStrangers<span>4u</span></div>
            <div class="brand-tagline">CHAT&nbsp; · &nbsp;CONNECT&nbsp; · &nbsp;EXPLORE</div>
          </div>
        </div>
      </div>
      <div class="coin-pill"><span>💰 ${state.coins}</span><span class="coin-add">+</span></div>
    </header>
  `;
}

function bottomNav() {
  return `
    <nav class="bottom-nav">

      <button class="nav-item ${state.screen === "funzone" ? "active" : ""}"
        onclick="navigate('funzone')">
        <span class="nav-symbol">${visualIcon("game")}</span>Fun Zone
      </button>

      <button class="nav-item ${["home", "voice", "video", "random", "matchmaking", "partner", "room"].includes(state.screen) ? "active" : ""}"
        onclick="navigate('home')">
        <span class="nav-symbol">${visualIcon("call")}</span>Call
      </button>

      <button class="nav-item ${state.screen === "explore" ? "active" : ""}"
        onclick="navigate('explore')">
        <span class="nav-symbol">${visualIcon("explore")}</span>Explore
      </button>

      <button class="nav-item ${state.screen === "profile" ? "active" : ""}"
        onclick="navigate('profile')">
        <span class="nav-symbol">${visualIcon("profile")}</span>Profile
      </button>

    </nav>
  `;
}


// HOME SCREEN

function homeScreen() {
  return `
    ${header()}
    <section class="call-intro premium-intro">
      <div class="intro-copy">
        <p class="call-intro-label">YOUR CONNECTION SPACE</p>
        <h1 class="page-title" style="margin-top:10px">Connect & Discover</h1>
        <p class="page-subtitle">Every connection starts with a hello.</p>
        <div class="intro-tagline"><span class="intro-sparkle">✦</span><span>Meet people. Share stories. Explore cultures.</span></div>
      </div>
      <div class="intro-globe" aria-hidden="true">
        <div class="globe-orbit globe-orbit-one"></div><div class="globe-orbit globe-orbit-two"></div>
        <div class="globe-core">${visualIcon("globe")}</div>
        <span class="globe-star star-one">✦</span><span class="globe-star star-two">·</span>
      </div>
    </section>
    <div class="call-spacer premium-gap"></div>
    <button class="call-card premium-call-card" onclick="navigate('voice')">
      <span class="premium-call-icon">${visualIcon("phone")}</span><span class="premium-call-divider"></span>
      <span class="premium-call-copy"><strong>Voice Calling</strong><small>Connect through voice with people worldwide.</small></span>
      <span class="premium-call-arrow">→</span><span class="call-wave call-wave-blue"></span>
    </button>
    <div class="call-spacer premium-gap"></div>
    <button class="call-card partner premium-call-card premium-video-card" onclick="navigate('video')">
      <span class="premium-call-icon">${visualIcon("video")}</span><span class="premium-call-divider"></span>
      <span class="premium-call-copy"><strong>Video Calling</strong><small>Meet people face to face around the world.</small></span>
      <span class="premium-call-arrow">→</span><span class="call-wave call-wave-purple"></span>
    </button>
    <div class="home-bottom-space"></div>
    ${bottomNav()}
  `;
}


// RANDOM SEARCH INTRO SCREEN

function randomScreen() {
  return `
    ${header()}

    <section class="panel">

      <h1 class="page-title">Ready to Connect?</h1>

      <p class="page-subtitle">
        Meet new people and make connections from around the world.
      </p>

      <div style="height:25px"></div>

      <div style="font-size:54px;text-align:center">🌍</div>

      <div style="height:25px"></div>

      <div class="panel">

        <h3>🌎 Worldwide Connections</h3>

        <p class="page-subtitle">
          Meet someone new from anywhere in the world.
        </p>

        <div style="height:16px"></div>

        <h3>🛡️ Stay Anonymous</h3>

        <p class="page-subtitle">
          Your Telegram profile photo won't be shown in the game.
        </p>

      </div>

      <div style="height:22px"></div>

      <button class="primary-button" onclick="startSearch()">
        🔎 Start Searching
      </button>

      <div style="height:12px"></div>

      <button class="secondary-button" onclick="navigate('home')">
        Cancel
      </button>

    </section>

    ${bottomNav()}
  `;
}


// MATCHMAKING SCREEN

function matchmakingScreen() {
  return `
    ${header()}

    <section class="panel" style="text-align:center">

      <div style="font-size:48px">🌐</div>

      <h1 class="page-title" style="margin-top:15px">
        Finding Partner...
      </h1>

      <p class="page-subtitle">
        Searching for someone around the world.
      </p>

      <div style="height:25px"></div>

      <div class="panel">

        <p style="color:#C5A66A;font-weight:700">
          YOUR MATCH · 1 / 2 PLAYERS
        </p>

        <div style="height:22px"></div>

        <h3>👤 You</h3>

        <p class="page-subtitle">
          Your assigned avatar
        </p>

        <div style="height:25px"></div>

        <h3>🔎 Finding Partner...</h3>

        <p class="page-subtitle">
          Waiting for another user
        </p>

      </div>

      <div style="height:25px"></div>

      <button class="secondary-button" onclick="cancelSearch()">
        ✕ Cancel Search
      </button>

    </section>

    ${bottomNav()}
  `;
}


// PARTNER CALL SCREEN

function partnerScreen() {
  return `
    ${header()}

    <section class="panel">

      <h1 class="page-title">Partner Call</h1>

      <p class="page-subtitle">
        Enter your partner's unique MeetStrangers4u ID.
      </p>

      <div style="height:24px"></div>

      <label for="partner-id">Partner User ID</label>

      <div style="height:9px"></div>

      <input
        id="partner-id"
        type="text"
        placeholder="Enter unique User ID"
      >

      <div style="height:18px"></div>

      <button class="primary-button" onclick="sendInvitation()">
        Send Invitation
      </button>

      <p class="page-subtitle" style="margin-top:15px">
        An invitation will be sent through the Telegram bot.
      </p>

    </section>

    ${bottomNav()}
  `;
}


// VOICE CALL SCREEN
function voiceScreen() {
  return `
    ${header()}
    <section class="panel call-options-panel compact-call-options">
      <div class="call-screen-heading">
        <div class="call-screen-icon voice-icon">${visualIcon("phone")}</div>
        <h1 class="page-title">Voice</h1>
        <p class="page-subtitle">Connect through voice, anywhere.</p>
      </div>
      <div class="compact-call-pricing voice-pricing">
        <div class="compact-pricing-main">
          <strong>10 Coins <span>Call Fee</span></strong>
          <strong>+5 Coins / Min</strong>
        </div>
        <small>After 1 min</small>
      </div>
      <button class="call-option-card voice-option" onclick="startRandomCall('Voice')">
        <span class="call-option-icon">${visualIcon("globe")}</span>
        <span class="call-option-copy"><strong>Random Call</strong><em>Meet someone new worldwide.</em><small class="call-option-extra">🌍 Discover new people</small></span>
        <span class="call-option-arrow">›</span>
      </button>
      <button class="call-option-card voice-option partner-option" onclick="openPartnerCall('Voice')">
        <span class="call-option-icon">${visualIcon("profile")}</span>
        <span class="call-option-copy"><strong>Partner Call</strong><em>Connect using your partner's ID.</em><small class="call-option-extra">🤝 Connect with someone you know</small></span>
        <span class="call-option-arrow">›</span>
      </button>
      <div class="call-options-bottom-space"></div>
    </section>
    ${bottomNav()}
  `;
}

// VIDEO CALL SCREEN
function videoScreen() {
  return `
    ${header()}
    <section class="panel call-options-panel compact-call-options">
      <div class="call-screen-heading">
        <div class="call-screen-icon video-icon">${visualIcon("video")}</div>
        <h1 class="page-title">Video</h1>
        <p class="page-subtitle">Meet face-to-face around the world.</p>
      </div>
      <div class="compact-call-pricing video-pricing">
        <div class="compact-pricing-main">
          <strong>20 Coins <span>Call Fee</span></strong>
          <strong>+10 Coins / Min</strong>
        </div>
        <small>After 1 min</small>
      </div>
      <button class="call-option-card video-option" onclick="startRandomCall('Video')">
        <span class="call-option-icon">${visualIcon("globe")}</span>
        <span class="call-option-copy"><strong>Random Call</strong><em>Meet someone new worldwide.</em><small class="call-option-extra">🌍 Discover new people</small></span>
        <span class="call-option-arrow">›</span>
      </button>
      <button class="call-option-card video-option partner-option" onclick="openPartnerCall('Video')">
        <span class="call-option-icon">${visualIcon("profile")}</span>
        <span class="call-option-copy"><strong>Partner Call</strong><em>Connect using your partner's ID.</em><small class="call-option-extra">🤝 Connect with someone you know</small></span>
        <span class="call-option-arrow">›</span>
      </button>
      <div class="call-options-bottom-space"></div>
    </section>
    ${bottomNav()}
  `;
}

// RANDOM CALL FLOW — UI states are ready for a real calling backend.
function callFlowScreen() {
  const type = state.call.type || "Voice";
  const isVideo = type === "Video";
  const status = state.call.status;
  const fee = isVideo ? 20 : 10;
  const rate = isVideo ? 10 : 5;
  const iconMarkup = isVideo ? visualIcon("video") : visualIcon("phone");

  if (status === "searching") {
    return `
      ${header()}
      <section class="panel call-flow-panel">
        <div class="call-flow-orbit">${iconMarkup}</div>
        <p class="call-flow-eyebrow">${type.toUpperCase()} MATCHMAKING</p>
        <h1 class="page-title">Finding Your Partner</h1>
        <p class="page-subtitle">Searching for one available person around the world.</p>
        <div class="matching-status"><span class="matching-pulse"></span> Waiting for a match</div>
        <div class="match-slots">
          <div class="match-slot"><div class="match-avatar you-avatar">You</div><strong>You</strong><small>Ready to connect</small></div>
          <div class="match-connector">•••</div>
          <div class="match-slot"><div class="match-avatar search-avatar">?</div><strong>Partner</strong><small>Finding someone...</small></div>
        </div>
        <p class="call-flow-price">💰 ${fee} Coins connection fee · +${rate} Coins / min after the first minute</p>
        <button class="secondary-button" onclick="cancelRandomCall()">Cancel Search</button>
      </section>
      ${bottomNav()}
    `;
  }

  if (status === "connected") {
    return `
      ${header()}
      <section class="active-call-screen ${isVideo ? "active-video-call" : "active-voice-call"}">
        <div class="active-call-top"><span class="live-indicator"></span> LIVE ${type.toUpperCase()} CALL <span class="call-encrypted">🔒 PRIVATE</span></div>
        <div class="call-partner-stage">
          ${isVideo ? '<div class="video-stage-placeholder"><div class="stage-avatar">M</div><span>Partner video stream will appear here</span></div>' : '<div class="voice-avatar-ring"><div class="voice-avatar">M</div><span class="voice-wave"></span></div>'}
          <h2>Connected</h2>
          <p>Your partner is here. Say hello!</p>
          <div class="call-duration" id="call-duration">00:00</div>
        </div>
        <div class="call-billing-strip"><span>Connection: ${fee} coins</span><strong>+${rate} coins / completed minute</strong></div>
        <button class="end-call-button" onclick="requestEndCall()">✕ &nbsp; End Call</button>
        <p class="call-small-note">Your balance is billed securely by the calling server. This screen alone does not charge coins.</p>
      </section>
      ${bottomNav()}
    `;
  }

  if (status === "ended") {
    return `
      ${header()}
      <section class="panel call-flow-panel call-ended-panel">
        <div class="call-ended-icon">✓</div>
        <p class="call-flow-eyebrow">CONNECTION CLOSED</p>
        <h1 class="page-title">Call Ended</h1>
        <p class="page-subtitle">Your call session has ended.</p>
        <button class="primary-button" onclick="navigate('${isVideo ? "video" : "voice"}')">Back to ${type} Calls</button>
      </section>
      ${bottomNav()}
    `;
  }

  return `
    ${header()}
    <section class="panel call-flow-panel call-unavailable-panel">
      <div class="call-flow-orbit">${iconMarkup}</div>
      <p class="call-flow-eyebrow">${type.toUpperCase()} CALLING</p>
      <h1 class="page-title">Almost Ready</h1>
      <p class="page-subtitle">The live calling service has not been connected to this app yet.</p>
      <div class="backend-status-card"><span class="backend-status-dot"></span><div><strong>Calling service not connected</strong><small>No match has been started and no coins have been deducted.</small></div></div>
      <div class="call-flow-price">💰 ${fee} Coins connection fee · +${rate} Coins / min after the first minute</div>
      <button class="primary-button" onclick="navigate('${isVideo ? "video" : "voice"}')">Back to ${type} Call</button>
    </section>
    ${bottomNav()}
  `;
}

// EXPLORE SCREEN

function exploreScreen() {
  return `
    ${header()}

    <section class="panel" style="text-align:center;padding:28px 18px">

      <h1 class="page-title">Explore</h1>

      <div style="height:28px"></div>

      <h3>Something Exciting is Coming!</h3>

      <p class="page-subtitle">
        We're preparing something special for you.
      </p>

      <div style="height:18px"></div>

      <p class="call-card-label">
        COMING SOON
      </p>

    </section>

    ${bottomNav()}
  `;
}


// FUN ZONE SCREEN

function funZoneScreen() {
  return `
    ${header()}

    <section class="panel">

      <h1 class="page-title">Choose Your Game</h1>

      <p class="page-subtitle">
        Explore games and have fun with others.
      </p>

      <div style="height:22px"></div>

      <button class="call-card"
        onclick="alert('Truth or Dare will be added next.')">

        🎯

        <h3>Truth or Dare</h3>

        <p>Play with other people.</p>

      </button>

      <div style="height:16px"></div>

      <div class="panel" style="text-align:center">
        <p>🎮 More games coming soon</p>
      </div>

    </section>

    ${bottomNav()}
  `;
}


// PROFILE SCREEN

function profileScreen() {
  const user = state.user;
  const displayName = user
    ? [user.first_name, user.last_name].filter(Boolean).join(" ")
    : "Guest";
  const username = user?.username ? "@" + user.username : "MeetStrangers4u Member";
  const initials = displayName.split(" ").filter(Boolean).slice(0,2).map(part => part[0]).join("").toUpperCase() || "M";
  const avatar = user?.photo_url
    ? `<img class="profile-avatar-image" src="${escapeHTML(user.photo_url)}" alt="Profile">`
    : `<span>${escapeHTML(initials)}</span>`;

  return `
    ${header()}

    <section class="profile-page">
      <div class="profile-hero">
        <div class="profile-avatar">${avatar}</div>
        <h1 class="profile-name">${escapeHTML(displayName)}</h1>
        <p class="profile-handle">${escapeHTML(username)}</p>
        <div class="profile-member-tag"><span></span> MEMBER</div>
      </div>

      <div class="profile-balance">
        <div>
          <p class="profile-eyebrow">YOUR COIN BALANCE</p>
          <div class="profile-balance-value">💰 ${state.coins}</div>
        </div>
        <button class="wallet-button" onclick="navigate('wallet')">Wallet <span>→</span></button>
      </div>

      <p class="profile-section-label">YOUR ACCOUNT</p>
      <button class="profile-menu-row earn-row" onclick="navigate('earn')">
        <span class="profile-menu-icon earn-icon">✦</span>
        <span class="profile-menu-copy">
          <strong>Earn Coins</strong>
          <small>Watch ads and collect free coins</small>
        </span>
        <span class="profile-menu-arrow">›</span>
      </button>

      <p class="profile-section-label">PREFERENCES &amp; SUPPORT</p>
      <button class="profile-menu-row" onclick="navigate('privacy')">
        <span class="profile-menu-icon privacy-icon">♢</span>
        <span class="profile-menu-copy">
          <strong>Privacy &amp; Safety</strong>
          <small>Manage your safety and privacy</small>
        </span>
        <span class="profile-menu-arrow">›</span>
      </button>
      <button class="profile-menu-row" onclick="navigate('about')">
        <span class="profile-menu-icon about-icon">ⓘ</span>
        <span class="profile-menu-copy">
          <strong>About MeetStrangers4u</strong>
          <small>Learn more about the community</small>
        </span>
        <span class="profile-menu-arrow">›</span>
      </button>

      <p class="profile-footer">MeetStrangers4u · Connect beyond boundaries</p>
    </section>

    ${bottomNav()}
  `;
}

function earnCoinsScreen() {
  return `
    ${header()}
    <section class="panel profile-subpage">
      <div class="earn-illustration">✦</div>
      <p class="profile-eyebrow">REWARDS</p>
      <h1 class="page-title">Earn Coins</h1>
      <p class="page-subtitle">Watch a short ad and get rewarded with coins.</p>
      <div class="earn-reward-card">
        <span>Today's reward</span>
        <strong>💰 10 Coins</strong>
      </div>
      <button class="primary-button" onclick="alert('Ad service will be connected here. No coins have been added yet.')">▶ Watch Ad</button>
      <p class="earn-note">Rewards are added after the ad is successfully completed.</p>
    </section>
    ${bottomNav()}
  `;
}

function walletScreen() {
  return `
    ${header()}
    <section class="panel profile-subpage">
      <button class="profile-back" onclick="navigate('profile')">← Back to Profile</button>
      <p class="profile-eyebrow">YOUR BALANCE</p>
      <h1 class="page-title">Coin Wallet</h1>
      <div class="wallet-total">💰 ${state.coins} <small>Coins</small></div>
      <p class="page-subtitle">Your coin activity will appear here.</p>
    </section>
    ${bottomNav()}
  `;
}

function profileInfoScreen(kind) {
  const privacy = kind === "privacy";
  return `
    ${header()}
    <section class="panel profile-subpage">
      <button class="profile-back" onclick="navigate('profile')">← Back to Profile</button>
      <div class="profile-info-symbol">${privacy ? "♢" : "ⓘ"}</div>
      <h1 class="page-title">${privacy ? "Privacy & Safety" : "About MeetStrangers4u"}</h1>
      <p class="page-subtitle">${privacy
        ? "Your safety matters. Connect respectfully, never share sensitive personal information, and report anything that makes you uncomfortable."
        : "MeetStrangers4u brings people together for meaningful conversations and new connections from around the world."}</p>
    </section>
    ${bottomNav()}
  `;
}

// HTML ESCAPE

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}


// NAVIGATION

function navigate(screen) {
  if (screen === state.screen) return;
  state.history.push(state.screen);
  state.screen = screen;
  render();
}

function goBack() {
  const previous = state.history.pop();
  state.screen = previous || "home";
  render();
}


function openPartnerCall(type) {
  state.call.type = type === "Video" ? "Video" : "Voice";
  navigate("partner");
}

// SEARCH ACTIONS

function startSearch() {
  navigate("matchmaking");
}

function cancelSearch() {
  navigate("home");
}

// RANDOM CALL FLOW
function startRandomCall(callType) {
  const type = callType === "Video" ? "Video" : "Voice";
  const connectionFee = type === "Video" ? 20 : 10;

  if (state.coins < connectionFee) {
    showInsufficientCoinsPopup();
    return;
  }

  state.history.push(state.screen);
  state.call = { type, status: "unavailable", sessionId: null, startedAt: null };

  // A calling backend can handle this event and call onCallSearching().
  const request = new CustomEvent("meetstrangers4u:start-random-call", {
    detail: { type, mode: "random" },
    cancelable: true
  });
  const backendReady = !window.dispatchEvent(request);
  state.call.status = backendReady ? "searching" : "unavailable";
  state.screen = "call";
  render();
}

// These callbacks are the integration points for the future calling backend.
// The backend must confirm the match and handle all coin billing securely.
function onCallSearching(type, sessionId) {
  state.call = { type: type === "Video" ? "Video" : "Voice", status: "searching", sessionId: sessionId || null, startedAt: null };
  state.screen = "call";
  render();
}

function onCallConnected(session) {
  const type = session?.type === "Video" ? "Video" : "Voice";
  state.call = { type, status: "connected", sessionId: session?.sessionId || null, startedAt: Date.now() };
  state.screen = "call";
  render();
  startCallClock();
}

function onCallEnded() {
  state.call.status = "ended";
  stopCallClock();
  render();
}

let callClockInterval = null;
function startCallClock() {
  stopCallClock();
  callClockInterval = setInterval(() => {
    const node = document.getElementById("call-duration");
    if (!node || !state.call.startedAt) return;
    const seconds = Math.max(0, Math.floor((Date.now() - state.call.startedAt) / 1000));
    const mins = String(Math.floor(seconds / 60)).padStart(2, "0");
    const secs = String(seconds % 60).padStart(2, "0");
    node.textContent = mins + ":" + secs;
  }, 1000);
}

function stopCallClock() {
  if (callClockInterval) clearInterval(callClockInterval);
  callClockInterval = null;
}

function cancelRandomCall() {
  const request = new CustomEvent("meetstrangers4u:cancel-search-request", {
    detail: { sessionId: state.call.sessionId },
    cancelable: true
  });
  window.dispatchEvent(request);
  state.call.status = "ended";
  state.screen = state.call.type === "Video" ? "video" : "voice";
  render();
}

function requestEndCall() {
  const request = new CustomEvent("meetstrangers4u:end-call-request", {
    detail: { sessionId: state.call.sessionId },
    cancelable: true
  });
  const backendReady = !window.dispatchEvent(request);
  if (!backendReady) {
    alert("The calling service is not connected yet. Your call has not been ended by the server.");
  }
}

function showInsufficientCoinsPopup() {
  document.getElementById("coin-shortage-modal")?.remove();
  const modal = document.createElement("div");
  modal.id = "coin-shortage-modal";
  modal.className = "coin-modal-backdrop";
  modal.innerHTML = '<div class="coin-modal" role="dialog" aria-modal="true" aria-labelledby="coin-modal-title"><div class="coin-modal-icon">💰</div><h3 id="coin-modal-title">Not Enough Coins</h3><p>You don\'t have enough coins. Earn coins by watching ads.</p><button class="primary-button" onclick="closeCoinPopup(); navigate(\'earn\')">▶ Watch Ad</button><button class="coin-modal-close" onclick="closeCoinPopup()">Maybe Later</button></div>';
  document.body.appendChild(modal);
}

function closeCoinPopup() {
  document.getElementById("coin-shortage-modal")?.remove();
}

// PARTNER INVITATION

function sendInvitation() {
  const input = document.getElementById("partner-id");
  const id = input?.value.trim();

  if (!id) {
    alert("Please enter a valid Partner User ID.");
    return;
  }

  alert(
    "Invitation backend is not connected yet. No invitation was sent."
  );
}


// MAIN RENDER

function render() {
  const isHome = state.screen === "home";
  const isCompactPage = ["funzone", "explore", "profile"].includes(state.screen);
  const isCallOptionsPage = ["voice", "video"].includes(state.screen);
  app.classList.toggle("home-view", isHome);
  app.classList.toggle("compact-view", isCompactPage);
  app.classList.toggle("call-options-view", isCallOptionsPage);
  document.body.classList.toggle("home-screen-active", isHome || isCompactPage);
  document.body.classList.toggle("call-options-screen-active", isCallOptionsPage);
  const screens = {
    home: homeScreen,
    voice: voiceScreen,
    video: videoScreen,
    call: callFlowScreen,
    explore: exploreScreen,
    random: randomScreen,
    matchmaking: matchmakingScreen,
    partner: partnerScreen,
    funzone: funZoneScreen,
    profile: profileScreen,
    earn: earnCoinsScreen,
    wallet: walletScreen,
    privacy: () => profileInfoScreen("privacy"),
    about: () => profileInfoScreen("about")
  };

  app.innerHTML = (screens[state.screen] || homeScreen)();
}


// INITIALIZE APP

render();
