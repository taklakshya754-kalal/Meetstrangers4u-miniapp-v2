
const tg = window.Telegram?.WebApp;

if (tg) {
  tg.ready();
  tg.expand();
}

const app = document.getElementById("app");

const state = {
  screen: "home",
  user: tg?.initDataUnsafe?.user || null
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

function header() {
  return `
    <header class="app-header">
      <div class="brand-name">MeetStrangers4u</div>
      <div class="coin-pill">💰 200</div>
    </header>
  `;
}

function bottomNav() {
  return `
    <nav class="bottom-nav">

      <button class="nav-item ${state.screen === "funzone" ? "active" : ""}"
        onclick="navigate('funzone')">
        <span>🎮</span>Fun Zone
      </button>

      <button class="nav-item ${["home", "voice", "video", "random", "matchmaking", "partner", "room"].includes(state.screen) ? "active" : ""}"
        onclick="navigate('home')">
        <span>📞</span>Call
      </button>

      <button class="nav-item ${state.screen === "explore" ? "active" : ""}"
        onclick="navigate('explore')">
        <span>◈</span>Explore
      </button>

      <button class="nav-item ${state.screen === "profile" ? "active" : ""}"
        onclick="navigate('profile')">
        <span>👤</span>Profile
      </button>

    </nav>
  `;
}


// HOME SCREEN

function homeScreen() {
  return `
    ${header()}

    <section class="call-intro">
      <p class="call-intro-label">YOUR CONNECTION SPACE</p>

      <h1 class="page-title" style="margin-top:10px">
        Connect & Discover
      </h1>

      <p class="page-subtitle">
        Every connection starts with a hello.
      </p>
    </section>

    <div class="call-spacer"></div>

    <button class="call-card" onclick="navigate('voice')">
      <div class="call-card-label">📞</div>
      <h3>Voice Calling</h3>
      <p>Connect through voice with people worldwide.</p>
    </button>

    <div class="call-spacer"></div>

    <button class="call-card partner" onclick="navigate('video')">
      <div class="call-card-label">🎥</div>
      <h3>Video Calling</h3>
      <p>Meet people face to face around the world.</p>
    </button>

    <div style="height:26px"></div>

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

      <div style="height:22px"></div>

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
          onclick="alert('Voice matchmaking will be connected next.')">

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

      <div style="height:22px"></div>

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
          onclick="alert('Video matchmaking will be connected next.')">

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
          <div class="profile-balance-value">💰 200</div>
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
      <button class="profile-back" onclick="navigate('profile')">← Back to Profile</button>
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
      <div class="wallet-total">💰 200 <small>Coins</small></div>
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
  state.screen = screen;
  render();
}


// SEARCH ACTIONS

function startSearch() {
  navigate("matchmaking");
}

function cancelSearch() {
  navigate("home");
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
  const screens = {
    home: homeScreen,
    voice: voiceScreen,
    video: videoScreen,
    explore: exploreScreen,
    random: randomScreen,
    matchmaking: matchmakingScreen,
    partner: partnerScreen,
    funzone: funZoneScreen,
    profile: profileScreen
  };

  app.innerHTML = (screens[state.screen] || homeScreen)();
}


// INITIALIZE APP

render();
