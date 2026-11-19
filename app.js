
const tg = window.Telegram?.WebApp;

if (tg) {
  tg.ready();
  tg.expand();
}

const app = document.getElementById("app");
const launchParams = new URLSearchParams(window.location.search);
const partnerLaunch = launchParams.get("partner") === "1";
const botCallLaunch = launchParams.get("botcall") === "1";
const launchCallType = launchParams.get("type") === "video" ? "Video" : "Voice";

const state = {
  screen: partnerLaunch ? "partner" : "home",
  history: [],
  user: tg?.initDataUnsafe?.user || null,
  account: null,
  coins: 0,
  partnerInvite: null,
  call: { type: partnerLaunch ? launchCallType : null, mode: null, status: "idle", sessionId: null, startedAt: null, message: "" }
};

const CALL_API = "https://call.lxreward.xyz";
let callSocket = null;
let peerConnection = null;
let localMediaStream = null;
let remoteMediaStream = null;
let pendingIceCandidates = [];
let pendingOffer = null;
let mediaReadySent = false;
let accountLoaded = false;
let callAttemptId = 0;
let searchCancelledToastTimer = null;

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
              <div class="brand-tagline" style="${state.screen === "home" ? 'margin-top:0;margin-left:17px;font-weight:750;font-size:11px' : state.screen === "profile" ? 'position:absolute;left:calc(50% + 14px);top:50%;transform:translate(-50%,-50%);margin:0;font-weight:750;font-size:13px' : 'position:absolute;left:calc(50% - 24px);top:calc(50% - 2px);transform:translate(-50%,-50%);margin:0;font-weight:750;font-size:9px'}">CHAT&nbsp; · &nbsp;CONNECT&nbsp; · &nbsp;EXPLORE</div>
          </div>
        </div>
      </div>
      ${state.screen !== "profile" ? '<button type="button" class="coin-pill" onclick="navigate(\'profile\')" aria-label="Open profile and coin balance"><span>💰 ' + state.coins + '</span><span class="coin-add" aria-hidden="true">+</span></button>' : ''}
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
      <span class="premium-call-arrow">↗</span><span class="call-wave call-wave-blue"></span>
    </button>
    <div class="call-spacer premium-gap"></div>
    <button class="call-card partner premium-call-card premium-video-card" onclick="navigate('video')">
      <span class="premium-call-icon">${visualIcon("video")}</span><span class="premium-call-divider"></span>
      <span class="premium-call-copy"><strong>Video Calling</strong><small>Meet people face to face around the world.</small></span>
      <span class="premium-call-arrow">↗</span><span class="call-wave call-wave-purple"></span>
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
  const type = state.call.type === "Video" ? "Video" : "Voice";
  const inviting = state.call.status === "inviting";
  const connectionFee = type === "Video" ? 20 : 10;
  const perMinuteRate = type === "Video" ? 50 : 20;
  const statusMessage = state.call.message
    ? `<div class="backend-status-card" style="margin-top:16px"><span class="backend-status-dot"></span><div><strong>${escapeHTML(state.call.message)}</strong></div></div>`
    : "";

  return `
    ${header()}
    <section class="panel partner-call-panel ${type === "Voice" ? "partner-voice-clean" : "partner-video-clean"}">
      <p class="call-flow-eyebrow">PRIVATE ${type.toUpperCase()} CALL</p>
      <h1 class="page-title">Partner Call</h1>
      <p class="page-subtitle">Connect privately with someone using their unique user ID.</p>

      <div class="partner-voice-pricing">
        <div class="partner-voice-price-row">
          <span>Connection fee</span><strong>${connectionFee} Coins</strong>
        </div>
        <div class="partner-voice-price-row">
          <span>Per minute</span><strong>${perMinuteRate} Coins / min</strong>
        </div>
        <p>Connection fee applies after connecting. Per-minute charges begin after the first minute.</p>
      </div>

      <div class="partner-call-section partner-voice-entry">
        <label for="partner-id">Partner User ID</label>
        <input
          id="partner-id"
          type="text"
          inputmode="numeric"
          autocomplete="off"
          maxlength="20"
          placeholder="Enter partner's User ID"
          ${inviting ? "disabled" : ""}
        >
        ${inviting
          ? `<button class="secondary-button" onclick="cancelPartnerInvitation()">Cancel Invitation</button>`
          : `<button class="primary-button" onclick="sendInvitation()">Send ${type} Invitation</button>`
        }
      </div>

      ${statusMessage}

      <p class="partner-safety-note partner-voice-note">
        Your invitation will be delivered privately through Telegram.
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
          <strong>+20 Coins / Min</strong>
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
          <strong>+50 Coins / Min</strong>
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
  const rate = isVideo ? 50 : 20;
  const iconMarkup = isVideo ? visualIcon("video") : visualIcon("phone");
  const isPartner = state.call.mode === "partner";

  if (status === "searching" || status === "connecting") {
    const connecting = status === "connecting";
    return `
      ${header()}
      <section class="panel call-flow-panel">
        <div class="call-flow-orbit">${iconMarkup}</div>
        <p class="call-flow-eyebrow">${isPartner ? "PRIVATE " : ""}${type.toUpperCase()} CALL</p>
        <h1 class="page-title">${connecting ? "Connecting Your Call" : isPartner ? "Waiting for Your Partner" : "Finding Your Partner"}</h1>
        <p class="page-subtitle">${connecting ? "A partner has been found. Preparing your secure connection." : isPartner ? "Your invitation code is verified. Keep this screen open while your partner joins." : "Searching for one available person around the world."}</p>
        <div class="matching-status"><span class="matching-pulse"></span> ${isPartner ? "Waiting for your invited partner" : "Waiting for a match"}</div>
        <div class="match-slots">
          <div class="match-slot"><div class="match-avatar you-avatar">You</div><strong>You</strong><small>Ready to connect</small></div>
          <div class="match-connector">•••</div>
          <div class="match-slot"><div class="match-avatar search-avatar">?</div><strong>Partner</strong><small>${isPartner ? "Joining with your code..." : "Finding someone..."}</small></div>
        </div>
        <p class="call-flow-price">${isPartner ? "🔒 Private invitation · Only the invited two accounts can join" : `💰 ${fee} Coins connection fee · +${rate} Coins / min after the first minute`}</p>
        <button class="secondary-button" onclick="cancelRandomCall()">${isPartner ? "Cancel Private Call" : "Cancel Search"}</button>
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
          ${isVideo ? '<div class="video-stage-placeholder"><video id="remote-video" autoplay playsinline></video></div>' : '<div class="voice-avatar-ring"><div class="voice-avatar">M</div><span class="voice-wave"></span></div>'}
          <audio id="remote-audio" autoplay playsinline></audio>
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
        <h1 class="page-title">${state.call.message || "Call Ended"}</h1>
        <p class="page-subtitle">Your call session has ended.</p>
        <button class="primary-button" onclick="${isPartner ? "navigate('partner')" : `startRandomCall('${type}')`}">${isPartner ? "Back to Partner Call" : "Search Again"}</button>
        <button class="secondary-button" onclick="navigate('home')">Back to Home Screen</button>
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
        onclick="window.openTruthDareSetup && window.openTruthDareSetup()">

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

function countryFlagFromCode(code) {
  const normalized = String(code || "").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(normalized)) return "";
  return String.fromCodePoint(...[...normalized].map(char => 127397 + char.charCodeAt(0)));
}

function profileScreen() {
  const user = state.user;
  const account = state.account || {};
  const displayName = account.custom_name?.trim()
    || (user ? [user.first_name, user.last_name].filter(Boolean).join(" ") : "Guest");
  const username = user?.username ? "@" + user.username : "MeetStrangers4u Member";
  const countryName = String(account.country_name || account.countryName || account.country || account.location_country || "").trim();
  const countryFlag = String(account.country_flag || account.countryFlag || account.flag_emoji || "")
    || countryFlagFromCode(account.country_code || account.countryCode || account.iso2 || "");
  const countryLine = countryName
    ? `<p class="profile-country">${countryFlag ? `<span class="profile-country-flag">${escapeHTML(countryFlag)}</span>` : ""}<span>${escapeHTML(countryName)}</span></p>`
    : "";
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
        ${countryLine}
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
  const sections = privacy
    ? [
        {
          icon: "◇",
          title: "Protect Your Personal Information",
          body: "Never share passwords, OTPs, bank details, or other private information."
        },
        {
          icon: "♡",
          title: "Connect With Respect",
          body: "Respect boundaries. Avoid harassment, pressure, scams, and suspicious links."
        },
        {
          icon: "⚑",
          title: "Stay in Control",
          body: "Leave any chat or call whenever you feel uncomfortable."
        },
        {
          icon: "✕",
          title: "Report Unwanted Behaviour",
          body: "Report unsafe or inappropriate behaviour. Your comfort comes first."
        }
      ]
    : [
        {
          icon: "◎",
          title: "Meet People Around the World",
          body: "Discover new cultures, exchange ideas, and hear stories from different backgrounds."
        },
        {
          icon: "✦",
          title: "Chat, Call & Explore",
          body: "Enjoy conversations, random connections, partner calls, and interactive experiences."
        },
        {
          icon: "♡",
          title: "A Community Built on Respect",
          body: "We believe every great connection starts with kindness, trust, and mutual respect."
        },
        {
          icon: "✧",
          title: "Our Mission",
          body: "To bring people closer and turn simple conversations into meaningful connections."
        }
      ];

  return `
    ${header()}
    <section class="panel profile-info-page ${privacy ? "privacy-info-page" : "about-info-page"}">
      <div class="profile-info-hero">
        <div class="profile-info-symbol">${privacy ? "◇" : "ⓘ"}</div>
        <p class="profile-info-kicker">${privacy ? "YOUR COMFORT MATTERS" : "GET TO KNOW US"}</p>
        <h1 class="page-title">${privacy ? "Privacy & Safety" : "About MeetStrangers4u"}</h1>
        <p class="profile-info-lead">${privacy
          ? "Connect confidently. Protect your privacy and put safety first."
          : "Meet new people, share stories, and discover connections worldwide."}</p>
      </div>

      <div class="profile-info-sections">
        ${sections.map(section => `
          <article class="profile-info-section">
            <div class="profile-info-section-icon" aria-hidden="true">${section.icon}</div>
            <div class="profile-info-section-copy">
              <h2>${section.title}</h2>
              <p>${section.body}</p>
            </div>
          </article>
        `).join("")}
      </div>

      <div class="profile-info-signoff">
        <strong>${privacy ? "Connect Freely. Stay Safe. Respect Everyone." : "One World. Countless Stories."}</strong>
      </div>
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
  const searchWasCancelled = cancelActiveSearch(false);
  if (!searchWasCancelled && ["voice", "video"].includes(state.screen) && state.call.status === "idle") {
    callAttemptId++;
  }
  if (!searchWasCancelled) state.history.push(state.screen);
  state.screen = screen;
  render();
  if (searchWasCancelled) {
    showSearchCancelledToast("Search cancelled. To keep searching, please stay on this page without going back or navigating to another section.");
  }
}

function goBack() {
  const searchWasCancelled = cancelActiveSearch(false);
  if (!searchWasCancelled && ["voice", "video"].includes(state.screen) && state.call.status === "idle") {
    callAttemptId++;
  }
  const previous = state.history.pop();
  state.screen = previous || "home";
  render();
  if (searchWasCancelled) {
    showSearchCancelledToast("Search cancelled. To keep searching, please stay on this page without going back or navigating to another section.");
  }
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

// RANDOM CALL FLOW — authenticated API + WebRTC signaling.
async function loadAccount() {
  if (!tg?.initData) throw new Error("Please open MeetStrangers4u from Telegram.");
  const response = await fetch(CALL_API + "/api/me", {
    headers: { "X-Telegram-Init-Data": tg.initData },
    cache: "no-store"
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || "Unable to load your account.");
  state.account = data.user;
  state.coins = Number(data.user.coins || 0);
  accountLoaded = true;
  render();
  return data.user;
}

function sendCallMessage(payload) {
  if (callSocket?.readyState === WebSocket.OPEN) {
    callSocket.send(JSON.stringify(payload));
    return true;
  }
  return false;
}

async function startRandomCall(callType) {
  const attemptId = ++callAttemptId;
  const originScreen = state.screen;
  const type = callType === "Video" ? "Video" : "Voice";
  const connectionFee = type === "Video" ? 20 : 10;
  if (["searching", "connecting", "connected"].includes(state.call.status)) return;

  try {
    if (!accountLoaded) await loadAccount();
    if (attemptId !== callAttemptId || state.screen !== originScreen) return;
  } catch (err) {
    if (attemptId !== callAttemptId || state.screen !== originScreen) return;
    alert(err.message);
    return;
  }
  if (state.coins < 100) {
    showInsufficientCoinsPopup();
    return;
  }
  if (!tg?.initData) {
    alert("Please open MeetStrangers4u from Telegram to start calling.");
    return;
  }

  cleanupCallResources();
  state.call = { type, status: "searching", sessionId: null, startedAt: null, message: "" };
  state.history.push(state.screen);
  state.screen = "call";
  render();

  try {
    const turnResponse = await fetch(CALL_API + "/api/turn-credentials", {
      headers: { "X-Telegram-Init-Data": tg.initData },
      cache: "no-store"
    });
    const turnData = await turnResponse.json().catch(() => ({}));
    if (attemptId !== callAttemptId || state.screen !== "call" || state.call.status !== "searching") return;
    if (!turnResponse.ok) throw new Error(turnData.message || "Unable to prepare secure calling.");

    const ws = new WebSocket("wss://call.lxreward.xyz/ws?initData=" + encodeURIComponent(tg.initData));
    callSocket = ws;
    ws.onopen = () => {
      if (callSocket === ws && state.screen === "call" && state.call.status === "searching") {
        ws.send(JSON.stringify({ type: "find", callType: type.toLowerCase() }));
      } else if (callSocket === ws) {
        callSocket = null;
        ws.close();
      }
    };
    ws.onmessage = event => {
      if (callSocket !== ws) return;
      let message;
      try { message = JSON.parse(event.data); } catch (_) { return; }
      handleCallServerMessage(message, turnData.iceServers || [], attemptId).catch(err => {
        if (attemptId !== callAttemptId || callSocket !== ws) return;
        console.error("Calling signal error:", err);
        sendCallMessage({ type: "end-call" });
        finishCall("A secure call connection could not be established. Please try again.");
      });
    };
    ws.onerror = () => {
      if (callSocket === ws) finishCall("Unable to connect to the calling service. Please try again.");
    };
    ws.onclose = () => {
      if (callSocket === ws && state.call.status !== "ended") {
        finishCall("Calling connection was interrupted. Please try again.");
      }
    };
  } catch (err) {
    if (attemptId !== callAttemptId || state.screen !== "call") return;
    finishCall(err.message || "Unable to start calling. Please try again.");
  }
}

async function handleCallServerMessage(message, iceServers, attemptId = callAttemptId) {
  const isPartnerInviteScreen =
    state.screen === "partner" && state.call.status === "inviting";

  if (attemptId !== callAttemptId || !callSocket ||
      (state.screen !== "call" && !isPartnerInviteScreen)) return;

  switch (message.type) {
    case "ready":
      break;

    case "partner-invite-expired":
      if (state.call.status === "inviting") {
        showPartnerInviteError("Invitation expired. Please try again.");
      } else if (state.call.mode === "partner" && state.screen === "call") {
        finishCall("This Partner Call invitation has expired.");
      }
      break;

    case "partner-invite-cancelled":
      if (state.call.status === "inviting") {
        const reason = message.reason;
        showPartnerInviteError(
          reason === "participant-disconnected"
            ? "Invitation cancelled because a participant disconnected."
            : reason === "user-unavailable"
              ? "Your partner is no longer available."
              : "Invitation was cancelled."
        );
      } else if (state.call.mode === "partner" && state.screen === "call") {
        finishCall(message.message || "This private invitation is no longer active.");
      }
      break;

    case "searching":
      if (state.call.status !== "searching") break;
      render();
      break;

    case "partner-waiting":
      if (state.call.status === "searching" && state.call.mode === "partner") render();
      break;

    case "matched": {
      const canMatch =
        state.call.status === "searching" ||
        state.call.status === "inviting" ||
        (state.call.status === "connecting" && state.call.mode === "partner");

      if (!canMatch) break;

      state.call.type = message.callType === "video" ? "Video" : "Voice";
      state.call.sessionId = message.sessionId;
      state.call.status = "connecting";
      state.screen = "call";
      render();
      await preparePeerConnection(message.peerId, iceServers, attemptId);
      break;
    }

    case "offer":
      if (peerConnection) await receiveOffer(message.data);
      else pendingOffer = message.data;
      break;

    case "answer":
      if (peerConnection) {
        await peerConnection.setRemoteDescription(message.data);
        await flushPendingIceCandidates();
      }
      break;

    case "ice-candidate":
      if (message.data) {
        if (peerConnection?.remoteDescription) await peerConnection.addIceCandidate(message.data);
        else pendingIceCandidates.push(message.data);
      }
      break;

    case "call-connected":
      state.coins = Number(message.coins ?? state.coins);
      onCallConnected({
        type: message.callType === "video" ? "Video" : "Voice",
        sessionId: message.sessionId
      });
      break;

    case "wallet-update":
      state.coins = Number(message.coins);

      const coinValue = document.querySelector(".coin-pill span:first-child");
      if (coinValue) coinValue.textContent = "\u{1F4B0} " + state.coins;

      const profileBalance = document.querySelector(".profile-balance-value");
      if (profileBalance) profileBalance.textContent = "\u{1F4B0} " + state.coins;

      attachRemoteMedia();
      break;

    case "minute-billed":
      break;

    case "insufficient-coins":
      state.coins = Number(message.coins ?? state.coins);
      finishCall("Not enough coins to start this call.");
      showInsufficientCoinsPopup();
      break;

    case "search-timeout":
      if (state.screen === "call" && state.call.status === "searching") {
        finishCall(message.message || "No users are available right now. Please try again after some time.");
      }
      break;

    case "call-ended":
      finishCall(message.reason === "insufficient-coins"
        ? "Your coin balance ran out. The call has ended."
        : message.reason === "connection-timeout"
          ? "Could not establish a connection. Please try again."
          : "Call Ended");
      if (message.reason === "insufficient-coins") showInsufficientCoinsPopup();
      break;

    case "error":
      if (state.call.status === "inviting") {
        showPartnerInviteError(message.message || "Unable to send the invitation.");
      } else {
        finishCall(message.message || "The calling service encountered an error.");
      }
      break;
  }
}

async function preparePeerConnection(peerId, iceServers, attemptId = callAttemptId) {
  try {
    const isVideo = state.call.type === "Video";
    const mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: isVideo });
    if (attemptId !== callAttemptId || state.screen !== "call" || state.call.status !== "connecting") {
      mediaStream.getTracks().forEach(track => track.stop());
      return;
    }
    localMediaStream = mediaStream;
    remoteMediaStream = new MediaStream();
    // Keep candidates received while microphone/camera permission was pending.
    mediaReadySent = false;

    const pc = new RTCPeerConnection({ iceServers, iceTransportPolicy: "all" });
    peerConnection = pc;

    // Attach every handler before applying a queued remote offer or creating SDP.
    pc.ontrack = event => {
      const incoming = event.streams?.[0];
      const tracks = incoming ? incoming.getTracks() : [event.track];
      tracks.forEach(track => {
        if (!remoteMediaStream.getTracks().some(existing => existing.id === track.id)) {
          remoteMediaStream.addTrack(track);
        }
      });
      attachRemoteMedia();
      maybeSendMediaReady();
    };
    pc.onicecandidate = event => {
      if (event.candidate) sendCallMessage({ type: "ice-candidate", data: event.candidate });
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connected") maybeSendMediaReady();
      if (["failed", "closed"].includes(pc.connectionState) && state.call.status === "connected") {
        requestEndCall();
      }
    };

    localMediaStream.getTracks().forEach(track => pc.addTrack(track, localMediaStream));

    if (pendingOffer) {
      const offer = pendingOffer;
      pendingOffer = null;
      await receiveOffer(offer);
    }

    const ownId = String(state.account?.user_id || tg?.initDataUnsafe?.user?.id || "");
    if (ownId.localeCompare(String(peerId), undefined, { numeric: true }) < 0) {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      sendCallMessage({ type: "offer", data: pc.localDescription });
    }
  } catch (err) {
    console.error("Call media setup failed:", err);
    sendCallMessage({ type: "end-call" });
    finishCall("Microphone or camera access is unavailable. Please allow permission and try again.");
  }
}

async function receiveOffer(offer) {
  if (!peerConnection) return;
  await peerConnection.setRemoteDescription(offer);
  await flushPendingIceCandidates();
  const answer = await peerConnection.createAnswer();
  await peerConnection.setLocalDescription(answer);
  sendCallMessage({ type: "answer", data: peerConnection.localDescription });
}

async function flushPendingIceCandidates() {
  if (!peerConnection?.remoteDescription) return;
  const candidates = pendingIceCandidates.splice(0);
  for (const candidate of candidates) await peerConnection.addIceCandidate(candidate);
}

function maybeSendMediaReady() {
  if (mediaReadySent || !peerConnection || peerConnection.connectionState !== "connected") return;
  if (!remoteMediaStream?.getTracks().length) return;
  mediaReadySent = true;
  sendCallMessage({ type: "media-ready" });
}

function attachRemoteMedia() {
  if (!remoteMediaStream) return;

  const audio = document.getElementById("remote-audio");
  const video = document.getElementById("remote-video");

  if (audio) {
    audio.autoplay = true;
    audio.playsInline = true;
    audio.muted = false;

    if (audio.srcObject !== remoteMediaStream) {
      audio.srcObject = remoteMediaStream;
    }

    audio.play().catch(err => {
      console.warn("Remote audio playback blocked:", err.name, err.message);
    });
  }

  if (video) {
    if (video.srcObject !== remoteMediaStream) {
      video.srcObject = remoteMediaStream;
    }
    video.play().catch(err => {
      console.warn("Remote video playback blocked:", err.name, err.message);
    });
  }
}

function onCallSearching(type, sessionId) {
  state.call = { type: type === "Video" ? "Video" : "Voice", status: "searching", sessionId: sessionId || null, startedAt: null, message: "" };
  state.screen = "call";
  render();
}

function onCallConnected(session) {
  const type = session?.type === "Video" ? "Video" : "Voice";
  state.call = { ...state.call, type, status: "connected", sessionId: session?.sessionId || state.call.sessionId, startedAt: Date.now() };
  state.screen = "call";
  render();
  attachRemoteMedia();
  startCallClock();
}

function onCallEnded(message) {
  finishCall(message || "Call Ended");
}

let callClockInterval = null;
function startCallClock() {
  stopCallClock();
  callClockInterval = setInterval(() => {
    const node = document.getElementById("call-duration");
    if (!state.call.startedAt) return;
    const seconds = Math.max(0, Math.floor((Date.now() - state.call.startedAt) / 1000));
    const mins = String(Math.floor(seconds / 60)).padStart(2, "0");
    const secs = String(seconds % 60).padStart(2, "0");
    if (node) node.textContent = mins + ":" + secs;
    updateFloatingCallTimer(mins + ":" + secs);
  }, 1000);
}

function stopCallClock() {
  if (callClockInterval) clearInterval(callClockInterval);
  callClockInterval = null;
}

function cleanupCallResources() {
  stopCallClock();
  if (peerConnection) {
    peerConnection.ontrack = null;
    peerConnection.onicecandidate = null;
    peerConnection.onconnectionstatechange = null;
    peerConnection.close();
    peerConnection = null;
  }
  if (localMediaStream) {
    localMediaStream.getTracks().forEach(track => track.stop());
    localMediaStream = null;
  }
  remoteMediaStream = null;
  pendingIceCandidates = [];
  pendingOffer = null;
  mediaReadySent = false;
}

function showSearchCancelledToast(message) {
  const existing = document.getElementById("search-cancelled-toast");
  if (existing) existing.remove();
  if (searchCancelledToastTimer) clearTimeout(searchCancelledToastTimer);

  const toast = document.createElement("div");
  toast.id = "search-cancelled-toast";
  toast.className = "search-cancelled-toast";
  toast.setAttribute("role", "status");
  toast.textContent = message || "Search cancelled.";
  document.body.appendChild(toast);

  searchCancelledToastTimer = setTimeout(() => {
    toast.remove();
    searchCancelledToastTimer = null;
  }, 5000);
}

function cancelActiveSearch() {
  if (state.screen !== "call" || !["searching", "connecting"].includes(state.call.status)) return false;

  const socket = callSocket;
  const hasSession = Boolean(state.call.sessionId);
  callAttemptId++;

  if (socket) {
    if (socket.readyState === WebSocket.OPEN) {
      try {
        socket.send(JSON.stringify({
          type: hasSession ? "end-call" : state.call.mode === "partner" ? "cancel-partner" : "cancel-search"
        }));
      } catch (_) {}
    }
    callSocket = null;
    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
      socket.close();
    }
  }

  cleanupCallResources();
  const type = state.call.type;
  state.call = { type, status: "idle", sessionId: null, startedAt: null, message: "" };
  return true;
}

function finishCall(message) {
  callAttemptId++;
  cleanupCallResources();
  if (callSocket) {
    const oldSocket = callSocket;
    callSocket = null;
    if (oldSocket.readyState === WebSocket.OPEN || oldSocket.readyState === WebSocket.CONNECTING) oldSocket.close();
  }
  state.call.status = "ended";
  state.call.message = message || "Call Ended";
  state.call.sessionId = null;
  state.screen = "call";
  render();
}

function cancelRandomCall() {
  const type = state.call.type;
  if (!cancelActiveSearch()) return;
  state.screen = state.history.pop() || (type === "Video" ? "video" : "voice");
  render();
  showSearchCancelledToast("Search cancelled.");
}

function requestEndCall() {
  if (!sendCallMessage({ type: "end-call" })) finishCall("Call connection closed.");
}

function showInsufficientCoinsPopup() {
  document.getElementById("coin-shortage-modal")?.remove();
  const modal = document.createElement("div");
  modal.id = "coin-shortage-modal";
  modal.className = "coin-modal-backdrop";
  modal.innerHTML = '<div class="coin-modal" role="dialog" aria-modal="true" aria-labelledby="coin-modal-title"><div class="coin-modal-icon">💰</div><h3 id="coin-modal-title">Coins Finished</h3><p>Your coin balance is not enough to continue this call. Watch an ad to earn more coins, then start another call.</p><button class="primary-button" onclick="closeCoinPopup(); navigate(&quot;earn&quot;)">▶ Watch Ad</button><button class="coin-modal-close" onclick="closeCoinPopup()">Maybe Later</button></div>';
  document.body.appendChild(modal);
}

function closeCoinPopup() {
  document.getElementById("coin-shortage-modal")?.remove();
}

// PARTNER INVITATION

function closePartnerSocket() {
  if (!callSocket) return;
  const oldSocket = callSocket;
  callSocket = null;
  if (oldSocket.readyState === WebSocket.OPEN ||
      oldSocket.readyState === WebSocket.CONNECTING) {
    oldSocket.close();
  }
}

function showPartnerInviteError(message) {
  closePartnerSocket();
  state.call.status = "idle";
  state.call.sessionId = null;
  state.call.inviteCode = null;
  state.call.message = message || "Unable to send the invitation.";
  state.screen = "partner";
  render();
}

async function getCallIceServers() {
  const response = await fetch(CALL_API + "/api/turn-credentials", {
    headers: { "X-Telegram-Init-Data": tg.initData },
    cache: "no-store"
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.message || "Unable to prepare secure calling.");
  }
  return data.iceServers || [];
}

function connectPartnerSocket(iceServers, attemptId = callAttemptId) {
  return new Promise((resolve, reject) => {
    if (!tg?.initData) {
      reject(new Error("Please open MeetStrangers4u from Telegram."));
      return;
    }

    const ws = new WebSocket(
      "wss://call.lxreward.xyz/ws?initData=" +
      encodeURIComponent(tg.initData)
    );
    callSocket = ws;
    let opened = false;
    let settled = false;

    const timeout = setTimeout(() => {
      if (!opened && !settled) {
        settled = true;
        if (callSocket === ws) closePartnerSocket();
        reject(new Error("Calling service connection timed out. Please try again."));
      }
    }, 10000);

    ws.onopen = () => {
      if (callSocket !== ws || attemptId !== callAttemptId) {
        ws.close();
        return;
      }
      opened = true;
      settled = true;
      clearTimeout(timeout);
      resolve(ws);
    };

    ws.onmessage = event => {
      if (callSocket !== ws || attemptId !== callAttemptId) return;
      let message;
      try {
        message = JSON.parse(event.data);
      } catch (_) {
        return;
      }

      handleCallServerMessage(message, iceServers, attemptId).catch(err => {
        if (attemptId !== callAttemptId || callSocket !== ws) return;
        console.error("Partner call signal error:", err);
        sendCallMessage({ type: "end-call" });
        finishCall("A secure call connection could not be established. Please try again.");
      });
    };

    ws.onerror = () => {
      if (callSocket !== ws) return;
      if (!opened && !settled) {
        settled = true;
        clearTimeout(timeout);
        reject(new Error("Unable to connect to the calling service. Please try again."));
      } else if (state.call.status === "inviting") {
        showPartnerInviteError("Calling connection was interrupted. Please try again.");
      } else {
        finishCall("Unable to connect to the calling service. Please try again.");
      }
    };

    ws.onclose = () => {
      if (callSocket !== ws) return;
      if (!opened && !settled) {
        settled = true;
        clearTimeout(timeout);
        reject(new Error("Calling service connection closed. Please try again."));
      } else if (state.call.status !== "ended") {
        if (state.call.status === "inviting") {
          showPartnerInviteError("Calling connection was interrupted. Please try again.");
        } else {
          finishCall("Calling connection was interrupted. Please try again.");
        }
      }
    };
  });
}

async function sendInvitation() {
  const input = document.getElementById("partner-id");
  const targetId = input?.value.trim() || "";

  if (!/^\d{1,20}$/.test(targetId)) {
    alert("Please enter a valid Telegram User ID.");
    return;
  }

  if (["searching", "connecting", "connected", "inviting"].includes(state.call.status)) {
    alert("You must finish your current call activity first.");
    return;
  }

  if (!tg?.initData) {
    alert("Please open MeetStrangers4u from Telegram.");
    return;
  }

  const attemptId = ++callAttemptId;
  closePartnerSocket();

  const callType = state.call.type === "Video" ? "video" : "voice";
  state.call.mode = "partner";
  state.call.status = "inviting";
  state.call.message = "Preparing your invitation...";
  state.call.inviteCode = null;
  state.screen = "partner";
  render();

  try {
    if (!accountLoaded) await loadAccount();
    if (attemptId !== callAttemptId) return;

    const requiredFee = callType === "video" ? 20 : 10;
    if (state.coins < requiredFee) {
      throw new Error("You need at least " + requiredFee + " coins for the Partner Call connection fee.");
    }

    const iceServers = await getCallIceServers();
    if (attemptId !== callAttemptId) return;

    await connectPartnerSocket(iceServers, attemptId);
    if (attemptId !== callAttemptId) return;

    const response = await fetch(CALL_API + "/api/partner-invites", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Telegram-Init-Data": tg.initData
      },
      body: JSON.stringify({ targetId, callType }),
      cache: "no-store"
    });

    const data = await response.json().catch(() => ({}));
    if (attemptId !== callAttemptId) return;

    if (!response.ok) {
      if (data.error === "USER_UNAVAILABLE" ||
          data.error === "USER_NOT_FOUND") {
        throw new Error("User unavailable.");
      }
      throw new Error(data.message || "Unable to send the invitation.");
    }

    if (state.call.status === "inviting") {
      state.call.inviteCode = data.code;
      state.call.message = data.accepted
        ? "Your partner accepted. Connecting your call..."
        : data.partnerOnline
          ? "Invitation sent. Waiting for your partner to accept."
          : "Invitation sent — partner is currently offline.";
      render();
    }
  } catch (err) {
    if (attemptId !== callAttemptId) return;
    showPartnerInviteError(err.message || "Unable to send the invitation.");
  }
}

async function cancelPartnerInvitation() {
  const code = state.call.inviteCode;
  ++callAttemptId;

  if (code && !sendCallMessage({ type: "cancel-partner", code })) {
    try {
      await fetch(CALL_API + "/api/partner-invites/cancel", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Telegram-Init-Data": tg?.initData || ""
        },
        body: JSON.stringify({ code }),
        cache: "no-store"
      });
    } catch (err) {
      console.warn("Partner invitation cancellation:", err.message);
    }
  }

  closePartnerSocket();
  state.call.mode = null;
  state.call.status = "idle";
  state.call.sessionId = null;
  state.call.inviteCode = null;
  state.call.message = "Invitation cancelled.";
  state.screen = "partner";
  render();
}

async function acceptPartnerInvitation(code, requestedType) {
  if (!code || !/^\d{8}$/.test(String(code))) return;

  const type = requestedType === "video" ? "Video" : "Voice";
  callAttemptId++;
  cleanupCallResources();
  closePartnerSocket();

  state.call = {
    type,
    mode: "partner",
    status: "connecting",
    sessionId: null,
    startedAt: null,
    message: "Accepting your Partner Call invitation..."
  };
  state.screen = "call";
  render();

  try {
    if (!accountLoaded) await loadAccount();

    const iceServers = await getCallIceServers();
    await connectPartnerSocket(iceServers, callAttemptId);

    if (!sendCallMessage({ type: "join-partner", code: String(code) })) {
      throw new Error("Unable to accept the invitation. Please try again.");
    }
  } catch (err) {
    finishCall(err.message || "Unable to accept the Partner Call invitation.");
  }
}

async function acceptBotPartnerInvitation(code, role, requestedType) {
  if (!/^[a-f0-9]{24}$/i.test(String(code || ""))) return;
  if (!["caller", "target"].includes(role)) return;

  const attemptId = ++callAttemptId;
  const type = requestedType === "video" ? "Video" : "Voice";

  cleanupCallResources();
  closePartnerSocket();

  state.call = {
    type,
    mode: "partner",
    status: "connecting",
    sessionId: null,
    startedAt: null,
    message: "Connecting your Partner Call..."
  };
  state.screen = "call";
  render();

  try {
    if (!accountLoaded) await loadAccount();
    if (attemptId !== callAttemptId) return;

    const iceServers = await getCallIceServers();
    if (attemptId !== callAttemptId) return;

    await connectPartnerSocket(iceServers, attemptId);
    if (attemptId !== callAttemptId) return;

    if (!sendCallMessage({
      type: "join-bot-partner",
      code: String(code),
      role
    })) {
      throw new Error("Unable to join the call. Please try again.");
    }
  } catch (err) {
    if (attemptId === callAttemptId) {
      finishCall(err.message || "Unable to join the Partner Call.");
    }
  }
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
  document.body.classList.toggle("video-options-screen-active", state.screen === "video");
  document.body.classList.toggle("call-matching-screen-active", state.screen === "call" && ["searching", "connecting"].includes(state.call.status));
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
  if (state.call.status === "connected" && state.screen !== "call") {
    app.insertAdjacentHTML("beforeend", floatingCallWidgetHTML());
    updateFloatingCallTimer();
  }
}


let floatingCallPosition = null;
let floatingCallDrag = null;

function floatingCallWidgetHTML() {
  const style = floatingCallPosition
    ? `left:${floatingCallPosition.x}px;top:${floatingCallPosition.y}px;right:auto;bottom:auto;`
    : "";
  const icon = state.call.type === "Video" ? "📹" : "📞";
  return `<button id="floating-active-call" class="floating-active-call" style="${style}" type="button" onclick="openFloatingActiveCall(event)" onpointerdown="startFloatingCallDrag(event)" aria-label="Return to active call">
    <span class="floating-call-icon">${icon}</span><span class="floating-call-live">LIVE</span><span class="floating-call-time" id="floating-call-duration">00:00</span>
  </button>`;
}

function updateFloatingCallTimer(value) {
  const node = document.getElementById("floating-call-duration");
  if (!node || !state.call.startedAt) return;
  if (value === undefined) {
    const seconds = Math.max(0, Math.floor((Date.now() - state.call.startedAt) / 1000));
    const mins = String(Math.floor(seconds / 60)).padStart(2, "0");
    const secs = String(seconds % 60).padStart(2, "0");
    value = mins + ":" + secs;
  }
  node.textContent = value;
}

function openFloatingActiveCall(event) {
  const box = document.getElementById("floating-active-call");
  if (box?.dataset.dragged === "true") {
    delete box.dataset.dragged;
    event?.preventDefault();
    return;
  }
  state.history.push(state.screen);
  state.screen = "call";
  render();
}

function startFloatingCallDrag(event) {
  if (event.button !== undefined && event.button !== 0) return;
  const box = document.getElementById("floating-active-call");
  if (!box) return;
  const rect = box.getBoundingClientRect();
  floatingCallDrag = {startX:event.clientX,startY:event.clientY,left:rect.left,top:rect.top,moved:false,pointerId:event.pointerId};
  box.setPointerCapture?.(event.pointerId);
  event.preventDefault();
  const move = ev => {
    if (!floatingCallDrag || ev.pointerId !== floatingCallDrag.pointerId) return;
    const dx=ev.clientX-floatingCallDrag.startX, dy=ev.clientY-floatingCallDrag.startY;
    if (Math.abs(dx)>4 || Math.abs(dy)>4) floatingCallDrag.moved=true;
    if (!floatingCallDrag.moved) return;
    const maxX=Math.max(0,window.innerWidth-box.offsetWidth), maxY=Math.max(0,window.innerHeight-box.offsetHeight);
    const x=Math.min(maxX,Math.max(0,floatingCallDrag.left+dx)), y=Math.min(maxY,Math.max(0,floatingCallDrag.top+dy));
    box.style.left=x+"px";box.style.top=y+"px";box.style.right="auto";box.style.bottom="auto";
    floatingCallPosition={x,y};
  };
  const end = ev => {
    if (floatingCallDrag && ev.pointerId===floatingCallDrag.pointerId) {
      const moved=floatingCallDrag.moved;
      floatingCallDrag=null;
      if (moved) box.dataset.dragged="true";
      else delete box.dataset.dragged;
    }
    document.removeEventListener("pointermove",move);
    document.removeEventListener("pointerup",end);
    document.removeEventListener("pointercancel",end);
  };
  document.addEventListener("pointermove",move);
  document.addEventListener("pointerup",end);
  document.addEventListener("pointercancel",end);
}

function resumeRemoteAudioPlayback() {
  const audio = document.getElementById("remote-audio");
  if (!audio || !audio.srcObject) return;

  audio.muted = false;

  if (audio.paused) {
    const playback = audio.play();
    if (playback?.catch) {
      playback.catch(err => {
        console.warn("Remote audio resume failed:", err.name, err.message);
      });
    }
  }
}

document.addEventListener("pointerdown", resumeRemoteAudioPlayback, true);
document.addEventListener("keydown", resumeRemoteAudioPlayback, true);

// INITIALIZE APP

render();

let pendingPartnerCall = null;

function showPartnerCallJoinNotice(invite) {
  pendingPartnerCall = invite;
  document.getElementById("partner-call-join-notice")?.remove();

  const isVideo = invite.type === "video";
  const notice = document.createElement("div");
  notice.id = "partner-call-join-notice";
  notice.className = "partner-call-join-overlay";
  notice.innerHTML = `
    <div class="partner-call-join-card" role="dialog" aria-modal="true" aria-labelledby="partner-join-title">
      <button class="partner-call-join-close" type="button" aria-label="Dismiss notification" onclick="dismissPartnerCallJoinNotice()">×</button>
      <div class="partner-call-join-icon ${isVideo ? "video" : ""}">${isVideo ? "▣" : "☎"}</div>
      <div class="partner-call-join-kicker">PRIVATE PARTNER CALL</div>
      <h2 id="partner-join-title">Your partner is ready</h2>
      <p>Tap below to join the call and activate audio.</p>
      <button class="partner-call-join-action" type="button" onclick="joinPendingPartnerCall()">
        <span>🔊</span> JOIN ${isVideo ? "VIDEO" : "VOICE"} CALL
      </button>
      <div class="partner-call-join-foot">Secure connection · Only invited participants</div>
    </div>`;
  document.body.appendChild(notice);
}

function dismissPartnerCallJoinNotice() {
  document.getElementById("partner-call-join-notice")?.remove();
}

async function joinPendingPartnerCall() {
  const invite = pendingPartnerCall;
  if (!invite) return;
  dismissPartnerCallJoinNotice();
  pendingPartnerCall = null;

  // User tap is the explicit gesture to start the invitation join and audio playback flow.
  if (invite.kind === "bot") {
    await acceptBotPartnerInvitation(invite.code, invite.role, invite.type);
  } else {
    await acceptPartnerInvitation(invite.code, invite.type);
  }
}

loadAccount().then(() => {
  const params = new URLSearchParams(window.location.search);

  if (params.get("botcall") === "1" && params.get("code")) {
    showPartnerCallJoinNotice({
      kind: "bot",
      code: params.get("code"),
      role: params.get("role"),
      type: params.get("type") === "video" ? "video" : "voice"
    });
  } else if (params.get("partner") === "1" && params.get("code")) {
    showPartnerCallJoinNotice({
      kind: "miniapp",
      code: params.get("code"),
      type: params.get("type") === "video" ? "video" : "voice"
    });
  }
}).catch(err => {
  console.warn("MeetStrangers4u account sync:", err.message);
});
