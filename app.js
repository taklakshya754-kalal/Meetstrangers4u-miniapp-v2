
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
  coins: 200
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

    <section class="panel">

      <h1 class="page-title">Voice Call</h1>

      <p class="page-subtitle">
        Choose how you want to connect.
      </p>

      <div class="call-cost-note">💰 10 Coins per Call</div>

      <div class="call-card">

        <div class="call-card-label">
          🌍 RANDOM MATCHMAKING
        </div>

        <h3>Random Call</h3>

        <p>
          Meet someone new from anywhere in the world.
        </p>

        <div style="height:14px"></div>

        <button class="primary-button"
          onclick="startRandomCall('Voice')">

          Start Random Call

        </button>

      </div>

      <div style="height:18px"></div>

      <div class="call-card partner">

        <div class="call-card-label">
          🤝 DIRECT CONNECTION
        </div>

        <h3>Partner Call</h3>

        <p>
          Connect directly with someone using their unique ID.
        </p>

        <div style="height:14px"></div>

        <button class="secondary-button"
          onclick="alert('Voice partner connection will be connected next.')">

          Connect with Partner

        </button>

      </div>

      <p class="page-subtitle" style="text-align:center;margin-top:20px">
        Private one-to-one voice connection.
      </p>

    </section>

    ${bottomNav()}
  `;
}


// VIDEO CALL SCREEN

function videoScreen() {
  return `
    ${header()}

    <section class="panel">

      <h1 class="page-title">Video Call</h1>

      <p class="page-subtitle">
        See and connect with someone face-to-face.
      </p>

      <div class="call-cost-note">💰 10 Coins per Call</div>

      <div class="call-card">

        <div class="call-card-label">
          🌍 RANDOM VIDEO MATCH
        </div>

        <h3>Random Video Call</h3>

        <p>
          Meet new people through live video.
        </p>

        <div style="height:14px"></div>

        <button class="primary-button"
          onclick="startRandomCall('Video')">

          Start Random Video Call

        </button>

      </div>

      <div style="height:18px"></div>

      <div class="call-card partner">

        <div class="call-card-label">
          🤝 DIRECT VIDEO CONNECTION
        </div>

        <h3>Partner Video Call</h3>

        <p>
          Connect directly using a unique ID.
        </p>

        <div style="height:14px"></div>

        <button class="secondary-button"
          onclick="alert('Video partner connection will be connected next.')">

          Connect with Partner

        </button>

      </div>

      <p class="page-subtitle" style="text-align:center;margin-top:20px">
        Private one-to-one video connection.
      </p>

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


// SEARCH ACTIONS

function startSearch() {
  navigate("matchmaking");
}

function cancelSearch() {
  navigate("home");
}

// RANDOM CALL COIN CHECK
function startRandomCall(callType) {
  if (state.coins < 10) {
    showInsufficientCoinsPopup();
    return;
  }
  // Charge only after the server confirms a successful call connection.
  // The call backend is not connected yet, so this prototype does not deduct coins.
  alert(callType + " random calling is not connected yet. Your coins have not been deducted.");
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
  app.classList.toggle("home-view", isHome);
  app.classList.toggle("compact-view", isCompactPage);
  document.body.classList.toggle("home-screen-active", isHome || isCompactPage);
  const screens = {
    home: homeScreen,
    voice: voiceScreen,
    video: videoScreen,
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
