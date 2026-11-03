
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
      <button class="profile-button" onclick="navigate('profile')">
        ${icon("profile")}
      </button>
    </header>
  `;
}

function bottomNav() {
  return `
    <nav class="bottom-nav">
      <button class="nav-item ${state.screen === "funzone" ? "active" : ""}"
        onclick="navigate('funzone')">
        <span>${icon("game")}</span>Fun Zone
      </button>
      <button class="nav-item ${state.screen === "home" || state.screen === "random" || state.screen === "matchmaking" || state.screen === "partner" || state.screen === "room" ? "active" : ""}"
        onclick="navigate('home')">
        <span>${icon("call")}</span>Call
      </button>
      <button class="nav-item ${state.screen === "profile" ? "active" : ""}"
        onclick="navigate('profile')">
        <span>${icon("profile")}</span>Profile
      </button>
    </nav>
  `;
}

function homeScreen() {
  return `
    ${header()}
    <section class="panel">
      <p style="color:#C5A66A;font-size:11px;font-weight:700;letter-spacing:1px">
        YOUR CONNECTION SPACE
      </p>
      <h1 class="page-title" style="margin-top:12px">Connect & Discover</h1>
      <p class="page-subtitle">Every connection starts with a hello.</p>

      <div style="height:22px"></div>

      <button class="call-card" onclick="navigate('random')">
        <div>${icon("random")} <span style="color:#72D8F5">RANDOM CALL</span></div>
        <h3>Random Call</h3>
        <p>Meet someone new from anywhere in the world.</p>
      </button>

      <div style="height:18px"></div>

      <button class="call-card partner" onclick="navigate('partner')">
        <div>${icon("partner")} <span style="color:#B9A1FF">PARTNER CALL</span></div>
        <h3>Partner Call</h3>
        <p>Connect directly with your chosen partner.</p>
      </button>

      <div style="height:26px"></div>
    </section>
    ${bottomNav()}
  `;
}

function randomScreen() {
  return `
    ${header()}
    <section class="panel">
      <h1 class="page-title">Ready to Connect?</h1>
      <p class="page-subtitle">Meet new people and make connections from around the world.</p>
      <div style="height:25px"></div>
      <div style="font-size:54px;text-align:center">🌍</div>
      <div style="height:25px"></div>
      <div class="panel">
        <h3>🌎 Worldwide Connections</h3>
        <p class="page-subtitle">Meet someone new from anywhere in the world.</p>
        <div style="height:16px"></div>
        <h3>🛡️ Stay Anonymous</h3>
        <p class="page-subtitle">Your Telegram profile photo won't be shown in the game.</p>
      </div>
      <div style="height:22px"></div>
      <button class="primary-button" onclick="startSearch()">🔎 Start Searching</button>
      <div style="height:12px"></div>
      <button class="secondary-button" onclick="navigate('home')">Cancel</button>
    </section>
    ${bottomNav()}
  `;
}

function matchmakingScreen() {
  return `
    ${header()}
    <section class="panel" style="text-align:center">
      <div style="font-size:48px">🌐</div>
      <h1 class="page-title" style="margin-top:15px">Finding Partner...</h1>
      <p class="page-subtitle">Searching for someone around the world.</p>
      <div style="height:25px"></div>
      <div class="panel">
        <p style="color:#C5A66A;font-weight:700">YOUR MATCH · 1 / 2 PLAYERS</p>
        <div style="height:22px"></div>
        <h3>👤 You</h3>
        <p class="page-subtitle">Your assigned avatar</p>
        <div style="height:25px"></div>
        <h3>🔎 Finding Partner...</h3>
        <p class="page-subtitle">Waiting for another user</p>
      </div>
      <div style="height:25px"></div>
      <button class="secondary-button" onclick="cancelSearch()">✕ Cancel Search</button>
    </section>
    ${bottomNav()}
  `;
}

function partnerScreen() {
  return `
    ${header()}
    <section class="panel">
      <h1 class="page-title">Partner Call</h1>
      <p class="page-subtitle">Enter your partner's unique MeetStrangers4u ID.</p>
      <div style="height:24px"></div>
      <label for="partner-id">Partner User ID</label>
      <div style="height:9px"></div>
      <input id="partner-id" type="text" placeholder="Enter unique User ID">
      <div style="height:18px"></div>
      <button class="primary-button" onclick="sendInvitation()">Send Invitation</button>
      <p class="page-subtitle" style="margin-top:15px">An invitation will be sent through the Telegram bot.</p>
    </section>
    ${bottomNav()}
  `;
}

function funZoneScreen() {
  return `
    ${header()}
    <section class="panel">
      <h1 class="page-title">Choose Your Game</h1>
      <p class="page-subtitle">Explore games and have fun with others.</p>
      <div style="height:22px"></div>
      <button class="call-card" onclick="alert('Truth or Dare will be added next.')">
        🎯 <h3>Truth or Dare</h3>
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

function profileScreen() {
  const user = state.user;
  const displayName = user
    ? [user.first_name, user.last_name].filter(Boolean).join(" ")
    : "Guest";

  return `
    ${header()}
    <section class="panel" style="text-align:center">
      <div style="font-size:55px">👤</div>
      <h1 class="page-title" style="margin-top:12px">Your Profile</h1>
      <p class="page-subtitle">${escapeHTML(displayName)}</p>
      <p class="page-subtitle">Telegram ID: ${user ? escapeHTML(String(user.id)) : "Not available"}</p>
      <div style="height:20px"></div>
      <p class="page-subtitle">Your app profile and avatar settings will appear here.</p>
    </section>
    ${bottomNav()}
  `;
}

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function navigate(screen) {
  state.screen = screen;
  render();
}

function startSearch() {
  navigate("matchmaking");
}

function cancelSearch() {
  navigate("home");
}

function sendInvitation() {
  const input = document.getElementById("partner-id");
  const id = input?.value.trim();

  if (!id) {
    alert("Please enter a valid Partner User ID.");
    return;
  }

  alert("Invitation backend is not connected yet. No invitation was sent.");
}

function render() {
  const screens = {
    home: homeScreen,
    random: randomScreen,
    matchmaking: matchmakingScreen,
    partner: partnerScreen,
    funzone: funZoneScreen,
    profile: profileScreen
  };

  app.innerHTML = (screens[state.screen] || homeScreen)();
}

render();
