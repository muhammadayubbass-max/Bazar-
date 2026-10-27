/* =========================================================
   M~A~MARAL — MAIN APPLICATION
   YouTube Search + Player + Firebase Auth + Cloud Sync
   ========================================================= */

"use strict";

/* =========================
   1. CONFIGURATION
========================= */

const YOUTUBE_API_KEY = "AIzaSyAXjMCVFSVfSjoBWq6qxhfBCKZhDbbw1A4";

const firebaseConfig = {
  apiKey: "AIzaSyD4hn552TlYdc2GOr9_QN0Gi30FjC96M6g",
  authDomain: "m-a-maral.firebaseapp.com",
  databaseURL: "https://m-a-maral-default-rtdb.firebaseio.com",
  projectId: "m-a-maral",
  storageBucket: "m-a-maral.firebasestorage.app",
  messagingSenderId: "724557034155",
  appId: "1:724557034155:web:1b7e415ff8c3d17cf07dee",
  measurementId: "G-R866VGQQQ6"
};

const STORAGE = {
  favorites: "maral_favorites_v1",
  history: "maral_history_v1",
  playlists: "maral_playlists_v1",
  theme: "maral_theme_v1"
};

const YOUTUBE_API = "https://www.googleapis.com/youtube/v3/search";
const MAX_HISTORY = 100;

let auth = null;
let database = null;
let currentUser = null;
let firebaseReady = false;
let cloudReadyForUser = false;
let cloudWriteTimer = null;
let toastTimer = null;
let currentVideo = null;
let activePlaylistId = null;
let authMode = "login";
let playlistModalMode = "create";
let currentPageToken = "";
let currentSearchToken = "";
let currentQuery = "";
let isLoadingVideos = false;
let isLoadingMoreSearch = false;

let homeVideos = [];
let searchVideos = [];

let favorites = readStorage(STORAGE.favorites, []);
let history = readStorage(STORAGE.history, []);
let playlists = readStorage(STORAGE.playlists, []);

const $ = (id) => document.getElementById(id);

/* =========================
   2. STORAGE HELPERS
========================= */

function readStorage(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    return value == null ? fallback : value;
  } catch (error) {
    console.warn("Storage read error:", key, error);
    return fallback;
  }
}

function saveLocalData() {
  try {
    localStorage.setItem(STORAGE.favorites, JSON.stringify(favorites));
    localStorage.setItem(STORAGE.history, JSON.stringify(history));
    localStorage.setItem(STORAGE.playlists, JSON.stringify(playlists));
  } catch (error) {
    console.error("Storage save error:", error);
    showToast("هەڵگرتنی داتای ناوخۆیی سەرکەوتوو نەبوو.");
  }
}

function normalizeVideo(video) {
  if (!video || !video.id) return null;

  return {
    id: String(video.id),
    title: String(video.title || "بێ ناونیشان"),
    channel: String(video.channel || "YouTube"),
    thumbnail: String(video.thumbnail || ""),
    publishedAt: String(video.publishedAt || ""),
    addedAt: Number(video.addedAt || Date.now())
  };
}

function uniqueVideos(items) {
  const seen = new Set();

  return (Array.isArray(items) ? items : [])
    .map(normalizeVideo)
    .filter((video) => {
      if (!video || !video.id || seen.has(video.id)) return false;
      seen.add(video.id);
      return true;
    });
}

function normalizePlaylists(items) {
  if (!Array.isArray(items)) return [];

  return items
    .filter((item) => item && typeof item === "object")
    .map((item) => ({
      id: String(item.id || makeId()),
      name: String(item.name || "Playlist"),
      videos: uniqueVideos(item.videos || []),
      createdAt: Number(item.createdAt || Date.now())
    }));
}

function makeId() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return window.crypto.randomUUID();
  }

  return "maral_" + Date.now() + "_" + Math.random().toString(36).slice(2, 10);
}

function isFavorite(videoId) {
  return favorites.some((video) => video.id === String(videoId));
}

/* =========================
   3. FIREBASE INITIALIZATION
========================= */

function initializeFirebase() {
  try {
    if (!window.firebase) {
      setConnectionStatus("Firebase بار نەبوو");
      console.error("Firebase SDK is missing.");
      return;
    }

    if (!firebase.apps.length) {
      firebase.initializeApp(firebaseConfig);
    }

    auth = firebase.auth();
    database = firebase.database();
    firebaseReady = true;

    setConnectionStatus("Firebase ئامادەیە");
    auth.onAuthStateChanged(handleAuthStateChanged);
  } catch (error) {
    console.error("Firebase initialization failed:", error);
    setConnectionStatus("کێشەی Firebase");
    showToast("Firebase ئامادە نییە. ڕێکخستنەکانت بپشکنە.");
  }
}

function setConnectionStatus(message) {
  const element = $("connectionStatus");
  if (element) element.textContent = message;
}

/* =========================
   4. AUTHENTICATION
========================= */

function openAuthModal(mode = "login") {
  if (!firebaseReady) {
    showToast("Firebase ئامادە نییە. پەڕەکە نوێ بکەرەوە.");
    return;
  }

  if (currentUser) {
    showToast("ئێستا بە هەژمارەکەت چوویتە ژوورەوە.");
    return;
  }

  setAuthMode(mode);
  openModal("authModal");
}

function setAuthMode(mode) {
  authMode = mode === "signup" ? "signup" : "login";

  const signup = authMode === "signup";

  $("authTitle").textContent = signup ? "هەژمار دروست بکە" : "بەخێربێیتەوە";
  $("authSubtitle").textContent = signup
    ? "هەژمارێک دروست بکە بۆ هەڵگرتنی داتاکانت."
    : "بچۆ ژوورەوە بۆ هاوکاتکردنی داتاکانت.";

  $("authSubmitButton").textContent = signup ? "دروستکردنی هەژمار" : "چوونەژوورەوە";
  $("switchAuthMode").textContent = signup
    ? "هەژمارت هەیە؟ بچۆ ژوورەوە"
    : "هەژمارت نییە؟ هەژمار دروست بکە";

  $("confirmPasswordWrap").classList.toggle("hidden", !signup);
  $("authConfirmPassword").required = signup;
  $("forgotPasswordButton").classList.toggle("hidden", signup);
  $("authError").textContent = "";
  $("authError").className = "form-message";
  $("authPassword").autocomplete = signup ? "new-password" : "current-password";
}

function translateAuthError(error) {
  const code = error && error.code ? error.code : "";

  const messages = {
    "auth/email-already-in-use": "ئەم ئیمەیڵە پێشتر بەکارهاتووە.",
    "auth/invalid-email": "ئیمەیڵەکە دروست نییە.",
    "auth/weak-password": "وشەی نهێنی لاوازە؛ لانیکەم ٦ پیت بەکاربهێنە.",
    "auth/user-not-found": "هەژمارێک بەو ئیمەیڵە نەدۆزرایەوە.",
    "auth/wrong-password": "ئیمەیڵ یان وشەی نهێنی هەڵەیە.",
    "auth/invalid-credential": "ئیمەیڵ یان وشەی نهێنی دروست نییە.",
    "auth/too-many-requests": "هەوڵی زۆر دراوە؛ کەمێک چاوەڕێ بکە.",
    "auth/network-request-failed": "کێشەی پەیوەندی ئینتەرنێت هەیە.",
    "auth/operation-not-allowed": "Email/Password لە Firebase چالاک نەکراوە."
  };

  return messages[code] || "کێشەیەک ڕوویدا. Firebase و پەیوەندی ئینتەرنێت بپشکنە.";
}

async function handleAuthSubmit(event) {
  event.preventDefault();

  if (!auth || !firebaseReady) {
    showAuthMessage("Firebase ئامادە نییە.", true);
    return;
  }

  const email = $("authEmail").value.trim();
  const password = $("authPassword").value;
  const confirmPassword = $("authConfirmPassword").value;
  const submitButton = $("authSubmitButton");

  if (!email || !password) {
    showAuthMessage("ئیمەیڵ و وشەی نهێنی پڕ بکەرەوە.", true);
    return;
  }

  if (password.length < 6) {
    showAuthMessage("وشەی نهێنی دەبێت لانیکەم ٦ پیت بێت.", true);
    return;
  }

  if (authMode === "signup" && password !== confirmPassword) {
    showAuthMessage("وشە نهێنییەکان یەک ناگرنەوە.", true);
    return;
  }

  submitButton.disabled = true;
  submitButton.textContent = "تکایە چاوەڕێ بکە...";
  showAuthMessage("");

  try {
    if (authMode === "signup") {
      await auth.createUserWithEmailAndPassword(email, password);
      showToast("هەژمارەکەت بە سەرکەوتوویی دروست کرا.");
    } else {
      await auth.signInWithEmailAndPassword(email, password);
      showToast("بە سەرکەوتوویی چوویتە ژوورەوە.");
    }

    closeModal("authModal");
    $("authForm").reset();
  } catch (error) {
    console.error("Authentication error:", error);
    showAuthMessage(translateAuthError(error), true);
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = authMode === "signup" ? "دروستکردنی هەژمار" : "چوونەژوورەوە";
  }
}

function showAuthMessage(message, isError = false) {
  const element = $("authError");
  if (!element) return;

  element.textContent = message;
  element.className = "form-message" + (message ? (isError ? " error" : " success") : "");
}

async function resetPassword() {
  if (!auth) return;

  const email = $("authEmail").value.trim();

  if (!email) {
    showAuthMessage("سەرەتا ئیمەیڵەکەت بنووسە.", true);
    $("authEmail").focus();
    return;
  }

  try {
    await auth.sendPasswordResetEmail(email);
    showAuthMessage("لینکی گۆڕینی وشەی نهێنی بۆ ئیمەیڵەکەت نێردرا.");
  } catch (error) {
    showAuthMessage(translateAuthError(error), true);
  }
}

async function logout() {
  if (!auth || !currentUser) return;

  try {
    await auth.signOut();
    showToast("بە سەرکەوتوویی چوویتە دەرەوە.");
  } catch (error) {
    console.error("Logout error:", error);
    showToast("چوونەدەرەوە سەرکەوتوو نەبوو.");
  }
}

function handleAuthButton() {
  if (currentUser) {
    const confirmed = window.confirm(
      "دەتەوێت لە هەژمارەکەت بچیتە دەرەوە؟"
    );
    if (confirmed) logout();
  } else {
    openAuthModal("login");
  }
}

async function handleAuthStateChanged(user) {
  currentUser = user || null;
  cloudReadyForUser = false;

  updateAccountButton();

  if (!user) {
    setConnectionStatus("داتای ناوخۆیی");
    renderAllCollections();
    return;
  }

  setConnectionStatus("هاوکاتکردنی داتا...");

  try {
    await loadCloudData(user.uid);
    cloudReadyForUser = true;
    setConnectionStatus("هاوکات کرا");
    showToast("داتاکانت لەگەڵ هەژمارەکەت هاوکات کران.");
  } catch (error) {
    console.error("Cloud sync failed:", error);
    setConnectionStatus("کێشەی هاوکاتکردن");
    showToast("  بەخێر بێیت.");
  }

  renderAllCollections();
}

function updateAccountButton() {
  const buttonText = $("accountButtonText");

  if (currentUser) {
    buttonText.textContent = currentUser.email || "هەژمارەکەم";
    $("accountButton").title = "کلیک بکە بۆ چوونەدەرەوە";
  } else {
    buttonText.textContent = "چوونەژوورەوە";
    $("accountButton").title = "چوونەژوورەوە یان دروستکردنی هەژمار";
  }
}

/* =========================
   5. FIREBASE CLOUD SYNC
========================= */

function userDataRef(uid) {
  if (!database || !uid) throw new Error("Firebase Database is unavailable.");
  return database.ref("users/" + uid);
}

function cloudSnapshotToArrays(snapshot) {
  const data = snapshot.val() || {};

  return {
    favorites: uniqueVideos(data.favorites ? Object.values(data.favorites) : []),
    history: uniqueVideos(data.history ? Object.values(data.history) : []),
    playlists: normalizePlaylists(data.playlists ? Object.values(data.playlists) : [])
  };
}

async function loadCloudData(uid) {
  const snapshot = await userDataRef(uid).once("value");
  const cloud = cloudSnapshotToArrays(snapshot);

  /*
   * Merge cloud and local data instead of deleting existing local items.
   * Cloud data is restored across devices; local data is preserved too.
   */
  favorites = mergeVideos(cloud.favorites, favorites);
  history = mergeVideos(cloud.history, history).slice(0, MAX_HISTORY);
  playlists = mergePlaylists(cloud.playlists, playlists);

  saveLocalData();
  renderAllCollections();

  await saveCloudDataNow();
}

function mergeVideos(primary, secondary) {
  const result = [];
  const ids = new Set();

  for (const video of [...(primary || []), ...(secondary || [])]) {
    const normalized = normalizeVideo(video);
    if (!normalized || ids.has(normalized.id)) continue;
    ids.add(normalized.id);
    result.push(normalized);
  }

  return result;
}

function mergePlaylists(primary, secondary) {
  const result = [];
  const ids = new Set();

  for (const playlist of [...(primary || []), ...(secondary || [])]) {
    if (!playlist || !playlist.id || ids.has(String(playlist.id))) continue;
    ids.add(String(playlist.id));
    result.push({
      id: String(playlist.id),
      name: String(playlist.name || "Playlist"),
      videos: uniqueVideos(playlist.videos || []),
      createdAt: Number(playlist.createdAt || Date.now())
    });
  }

  return result;
}

function scheduleCloudSave() {
  saveLocalData();

  if (!currentUser || !cloudReadyForUser || !database) return;

  clearTimeout(cloudWriteTimer);
  cloudWriteTimer = setTimeout(() => {
    saveCloudDataNow().catch((error) => {
      console.error("Cloud save error:", error);
      setConnectionStatus("کێشەی هەڵگرتن");
      showToast("داتاکان لە Cloud هەڵنەگیران.");
    });
  }, 500);
}

async function saveCloudDataNow() {
  if (!currentUser || !database) return;

  const uid = currentUser.uid;

  const payload = {
    favorites: Object.fromEntries(favorites.map((video) => [safeKey(video.id), video])),
    history: Object.fromEntries(history.map((video) => [safeKey(video.id), video])),
    playlists: Object.fromEntries(playlists.map((playlist) => [safeKey(playlist.id), playlist])),
    updatedAt: Date.now()
  };

  await userDataRef(uid).update(payload);
  setConnectionStatus("هاوکات کرا");
}

function safeKey(value) {
  return String(value).replace(/[.#$[\]/]/g, "_");
}

/* =========================
   6. YOUTUBE SEARCH
========================= */

async function youtubeSearch(query, pageToken = "", maxResults = 12) {
  if (!YOUTUBE_API_KEY || YOUTUBE_API_KEY === "PASTE_YOUR_YOUTUBE_API_KEY_HERE") {
    throw new Error("YOUTUBE_KEY_MISSING");
  }

  const params = new URLSearchParams({
    part: "snippet",
    type: "video",
    maxResults: String(maxResults),
    q: query,
    key: YOUTUBE_API_KEY,
    safeSearch: "moderate",
    videoEmbeddable: "true",
    order: "relevance"
  });

  if (pageToken) params.set("pageToken", pageToken);

  const response = await fetch(YOUTUBE_API + "?" + params.toString());
  const data = await response.json();

  if (!response.ok || data.error) {
    const error = new Error(data.error?.message || "YouTube request failed");
    error.youtubeReason = data.error?.errors?.[0]?.reason || "";
    throw error;
  }

  return {
    videos: (data.items || [])
      .filter((item) => item.id && item.id.videoId && item.snippet)
      .map((item) => ({
        id: item.id.videoId,
        title: item.snippet.title || "Untitled video",
        channel: item.snippet.channelTitle || "YouTube",
        thumbnail:
          item.snippet.thumbnails?.high?.url ||
          item.snippet.thumbnails?.medium?.url ||
          item.snippet.thumbnails?.default?.url ||
          "",
        publishedAt: item.snippet.publishedAt || "",
        addedAt: Date.now()
      })),
    nextPageToken: data.nextPageToken || ""
  };
}

function friendlyYoutubeError(error) {
  if (error.message === "YOUTUBE_KEY_MISSING") {
    return "بۆ پیشاندانی ڤیدیۆکان، YOUTUBE_API_KEY لە script.js دابنێ.";
  }

  if (error.youtubeReason === "quotaExceeded") {
    return "سنووری ڕۆژانەی YouTube API تەواو بووە. دواتر هەوڵ بدەرەوە.";
  }

  if (error.youtubeReason === "keyInvalid") {
    return "کلیلەکەی YouTube API دروست نییە.";
  }

  return "نەتوانرا ڤیدیۆکان باربکرێن. ئینتەرنێت و API Key بپشکنە.";
}

async function loadHomeVideos(reset = true) {
  if (isLoadingVideos) return;
  isLoadingVideos = true;

  if (reset) {
    homeVideos = [];
    currentPageToken = "";
    $("homeVideoGrid").innerHTML = loadingMarkup("ڤیدیۆکان بار دەکرێن...");
  }

  $("loadMoreButton").disabled = true;

  try {
    const result = await youtubeSearch("popular music videos", currentPageToken, 12);
    homeVideos = reset ? result.videos : mergeVideos(homeVideos, result.videos);
    currentPageToken = result.nextPageToken;
    renderVideos($("homeVideoGrid"), homeVideos);

    $("loadMoreButton").classList.toggle("hidden", !currentPageToken);
  } catch (error) {
    console.error(error);
    if (reset) {
      $("homeVideoGrid").innerHTML = errorMarkup(friendlyYoutubeError(error));
    } else {
      showToast(friendlyYoutubeError(error));
    }
  } finally {
    isLoadingVideos = false;
    $("loadMoreButton").disabled = false;
  }
}

async function loadMoreHomeVideos() {
  if (!currentPageToken || isLoadingVideos) return;
  await loadHomeVideos(false);
}

async function performSearch(query, loadMore = false) {
  query = String(query || "").trim();
  if (!query) return;

  if (!loadMore) {
    currentQuery = query;
    currentSearchToken = "";
    searchVideos = [];
    $("searchTitle").textContent = "ئەنجامی گەڕان: " + query;
    $("searchResultsGrid").innerHTML = loadingMarkup("گەڕان بەردەوامە...");
    showSection("search");
  }

  if (isLoadingMoreSearch) return;
  isLoadingMoreSearch = true;
  $("searchMoreButton").disabled = true;

  try {
    const result = await youtubeSearch(query, currentSearchToken, 12);
    searchVideos = loadMore
      ? mergeVideos(searchVideos, result.videos)
      : result.videos;

    currentSearchToken = result.nextPageToken;
    renderVideos($("searchResultsGrid"), searchVideos);
    $("searchMoreButton").classList.toggle("hidden", !currentSearchToken);
  } catch (error) {
    console.error(error);
    $("searchResultsGrid").innerHTML = errorMarkup(friendlyYoutubeError(error));
  } finally {
    isLoadingMoreSearch = false;
    $("searchMoreButton").disabled = false;
  }
}

/* =========================
   7. VIDEO CARDS AND PLAYER
========================= */

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function renderVideos(container, videos) {
  if (!container) return;

  if (!videos || videos.length === 0) {
    container.innerHTML = emptyMarkup("هیچ ڤیدیۆیەک نییە", "گەڕانێکی تر تاقی بکەرەوە.");
    return;
  }

  container.innerHTML = videos.map((video) => {
    const favorite = isFavorite(video.id);
    const title = escapeHTML(video.title);
    const channel = escapeHTML(video.channel);
    const thumbnail = escapeHTML(video.thumbnail);
    const id = escapeHTML(video.id);

    return `
      <article class="video-card">
        <button class="video-thumb" data-play-video="${id}" aria-label="پەخشکردنی ${title}">
          <img src="${thumbnail}" alt="${title}" loading="lazy"
               onerror="this.onerror=null;this.src='https://placehold.co/640x360/171126/ffffff?text=M~A~MARAL'">
          <span class="play-overlay"><span>▶</span></span>
        </button>
        <div class="video-info">
          <h3 class="video-title">${title}</h3>
          <p class="video-channel">${channel}</p>
          <div class="video-card-actions">
            <button class="small-action ${favorite ? "is-favorite" : ""}"
                    data-favorite-video="${id}"
                    aria-label="گۆڕینی دڵخواز"> ${favorite ? "♥ دڵخواز" : "♡ دڵخواز"} </button>
            <button class="small-action" data-play-video="${id}">▶ بینین</button>
          </div>
        </div>
      </article>
    `;
  }).join("");
}

function findVideo(videoId) {
  const id = String(videoId);

  const all = [
    ...homeVideos,
    ...searchVideos,
    ...favorites,
    ...history,
    ...playlists.flatMap((playlist) => playlist.videos || [])
  ];

  return all.find((video) => video.id === id) || null;
}

function openVideo(videoId) {
  const video = findVideo(videoId);
  if (!video) {
    showToast("زانیاری ڤیدیۆکە نەدۆزرایەوە.");
    return;
  }

  currentVideo = video;

  $("modalVideoTitle").textContent = video.title;
  $("videoFrame").src =
    "https://www.youtube-nocookie.com/embed/" +
    encodeURIComponent(video.id) +
    "?autoplay=1&playsinline=1&rel=0";

  updateModalFavoriteButton();
  $("playerAccountHint").textContent = currentUser
    ? "داتاکانت لەگەڵ هەژمارەکەت هاوکات دەکرێن."
    : "بچۆ ژوورەوە بۆ هەڵگرتنی دڵخوازەکان لەسەر ئامێرەکانت.";

  openModal("videoModal");
  addToHistory(video);
}

function closeVideoPlayer() {
  $("videoFrame").src = "about:blank";
  currentVideo = null;
}

function updateModalFavoriteButton() {
  if (!currentVideo) return;

  const favorite = isFavorite(currentVideo.id);
  $("modalFavoriteButton").textContent = favorite
    ? "♥ لابردن لە دڵخوازەکان"
    : "♡ زیادکردن بۆ دڵخوازەکان";
}

function addToHistory(video) {
  history = [
    normalizeVideo({ ...video, addedAt: Date.now() }),
    ...history.filter((item) => item.id !== video.id)
  ].slice(0, MAX_HISTORY);

  scheduleCloudSave();
  renderHistory();
}

function toggleFavorite(videoId) {
  const video = findVideo(videoId);
  if (!video) return;

  if (isFavorite(videoId)) {
    favorites = favorites.filter((item) => item.id !== String(videoId));
    showToast("لە دڵخوازەکان لابرا.");
  } else {
    favorites.unshift(normalizeVideo({ ...video, addedAt: Date.now() }));
    showToast("زیادکرا بۆ دڵخوازەکان ❤️");
  }

  scheduleCloudSave();
  renderAllCollections();
  updateModalFavoriteButton();
}

/* =========================
   8. HISTORY
========================= */

function renderHistory() {
  renderVideos($("historyGrid"), history);
}

function clearHistory() {
  if (!history.length) {
    showToast("مێژووی بینین بەتاڵە.");
    return;
  }

  if (!window.confirm("دڵنیایت دەتەوێت هەموو مێژووی بینین بسڕیتەوە؟")) return;

  history = [];
  scheduleCloudSave();
  renderHistory();
  showToast("مێژووی بینین پاککرایەوە.");
}

/* =========================
   9. PLAYLISTS
========================= */

function renderPlaylists() {
  const container = $("playlistsContainer");

  if (!playlists.length) {
    container.innerHTML = emptyMarkup(
      "هێشتا Playlist ـت نییە",
      "لەسەر «لیستی نوێ» کلیک بکە و لیستی تایبەتی خۆت دروست بکە."
    );
    return;
  }

  container.innerHTML = playlists.map((playlist) => `
    <article class="playlist-card">
      <button class="playlist-art" data-open-playlist="${escapeHTML(playlist.id)}"
              aria-label="کردنەوەی Playlist">♫</button>
      <h3>${escapeHTML(playlist.name)}</h3>
      <p>${playlist.videos.length} ڤیدیۆ</p>
      <div class="playlist-card-actions">
        <button class="secondary-button" data-open-playlist="${escapeHTML(playlist.id)}">کردنەوە</button>
        <button class="small-action" data-delete-playlist="${escapeHTML(playlist.id)}">سڕینەوە</button>
      </div>
    </article>
  `).join("");
}

function openCreatePlaylistModal() {
  playlistModalMode = "create";
  $("playlistModalTitle").textContent = "Playlist دروست بکە";
  $("playlistForm").classList.remove("hidden");
  $("playlistChoices").classList.add("hidden");
  $("playlistNameInput").value = "";
  $("playlistMessage").textContent = "";
  openModal("playlistModal");
}

function createPlaylist(event) {
  event.preventDefault();

  const name = $("playlistNameInput").value.trim();
  if (!name) {
    showPlaylistMessage("ناوی Playlist بنووسە.", true);
    return;
  }

  if (playlists.some((playlist) => playlist.name.toLowerCase() === name.toLowerCase())) {
    showPlaylistMessage("Playlist ـێک بەو ناوە پێشتر هەیە.", true);
    return;
  }

  playlists.unshift({
    id: makeId(),
    name,
    videos: [],
    createdAt: Date.now()
  });

  scheduleCloudSave();
  renderPlaylists();
  closeModal("playlistModal");
  showToast("Playlist دروست کرا.");
}

function openPlaylist(playlistId) {
  const playlist = playlists.find((item) => item.id === String(playlistId));
  if (!playlist) return;

  activePlaylistId = playlist.id;
  $("activePlaylistTitle").textContent = playlist.name;
  $("playlistVideosArea").classList.remove("hidden");
  $("playlistsContainer").classList.add("hidden");

  renderVideos($("playlistVideosGrid"), playlist.videos);
  $("playlistVideosArea").scrollIntoView({ behavior: "smooth", block: "start" });
}

function backToPlaylists() {
  activePlaylistId = null;
  $("playlistVideosArea").classList.add("hidden");
  $("playlistsContainer").classList.remove("hidden");
}

function deletePlaylist(playlistId) {
  const playlist = playlists.find((item) => item.id === String(playlistId));
  if (!playlist) return;

  if (!window.confirm(`دڵنیایت دەتەوێت Playlist ـی «${playlist.name}» بسڕیتەوە؟`)) return;

  playlists = playlists.filter((item) => item.id !== String(playlistId));
  if (activePlaylistId === String(playlistId)) backToPlaylists();

  scheduleCloudSave();
  renderPlaylists();
  showToast("Playlist سڕایەوە.");
}

function openAddToPlaylistModal() {
  if (!currentVideo) return;

  playlistModalMode = "add";
  $("playlistModalTitle").textContent = "زیادکردن بۆ Playlist";
  $("playlistForm").classList.add("hidden");
  $("playlistChoices").classList.remove("hidden");
  $("playlistMessage").textContent = "";

  const container = $("playlistChoices");

  if (!playlists.length) {
    container.innerHTML = `
      <p class="muted-note">هیچ Playlist ـێکت نییە. سەرەتا یەکێک دروست بکە.</p>
      <button id="createPlaylistFromAdd" class="primary-button">＋ Playlist دروست بکە</button>
    `;
  } else {
    container.innerHTML = playlists.map((playlist) => `
      <button class="playlist-choice" data-add-to-playlist="${escapeHTML(playlist.id)}">
        ♫ ${escapeHTML(playlist.name)} (${playlist.videos.length})
      </button>
    `).join("");
  }

  openModal("playlistModal");
}

function addCurrentVideoToPlaylist(playlistId) {
  if (!currentVideo) return;

  const playlist = playlists.find((item) => item.id === String(playlistId));
  if (!playlist) return;

  if (playlist.videos.some((video) => video.id === currentVideo.id)) {
    showPlaylistMessage("ئەم ڤیدیۆیە پێشتر لەو Playlist ـەدا هەیە.", true);
    return;
  }

  playlist.videos.unshift(normalizeVideo(currentVideo));
  scheduleCloudSave();
  renderPlaylists();
  closeModal("playlistModal");
  showToast("ڤیدیۆکە زیادکرا بۆ " + playlist.name);
}

function showPlaylistMessage(message, isError = false) {
  const element = $("playlistMessage");
  element.textContent = message;
  element.className = "form-message" + (isError ? " error" : " success");
}

/* =========================
   10. NAVIGATION AND MODALS
========================= */

const sectionIds = {
  home: "homeSection",
  search: "searchSection",
  favorites: "favoritesSection",
  history: "historySection",
  playlists: "playlistsSection",
  about: "aboutSection"
};

function showSection(name) {
  const target = sectionIds[name] ? name : "home";

  Object.entries(sectionIds).forEach(([key, id]) => {
    $(id).classList.toggle("hidden", key !== target);
  });

  document.querySelectorAll(".nav-item").forEach((button) => {
    button.classList.toggle("active", button.dataset.section === target);
  });

  if (target === "favorites") renderFavorites();
  if (target === "history") renderHistory();
  if (target === "playlists") renderPlaylists();

  window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderFavorites() {
  renderVideos($("favoritesGrid"), favorites);
}

function renderAllCollections() {
  renderFavorites();
  renderHistory();
  renderPlaylists();

  if (activePlaylistId) openPlaylist(activePlaylistId);

  if (homeVideos.length) renderVideos($("homeVideoGrid"), homeVideos);
  if (searchVideos.length) renderVideos($("searchResultsGrid"), searchVideos);
}

function openModal(id) {
  $(id).classList.remove("hidden");
  document.body.style.overflow = "hidden";
}

function closeModal(id) {
  $(id).classList.add("hidden");

  if (id === "videoModal") closeVideoPlayer();

  if (!document.querySelector(".modal:not(.hidden)")) {
    document.body.style.overflow = "";
  }
}

function closeAllModals() {
  document.querySelectorAll(".modal:not(.hidden)").forEach((modal) => {
    closeModal(modal.id);
  });
}

/* =========================
   11. UI HELPERS
========================= */

function emptyMarkup(title, message) {
  return `
    <div class="empty-state">
      <span class="empty-icon">✦</span>
      <strong>${escapeHTML(title)}</strong>
      <span>${escapeHTML(message)}</span>
    </div>
  `;
}

function loadingMarkup(message) {
  return `<div class="loading-state">✨ ${escapeHTML(message)}</div>`;
}

function errorMarkup(message) {
  return `<div class="error-state">⚠️ ${escapeHTML(message)}</div>`;
}

function showToast(message) {
  const toast = $("toast");
  if (!toast) return;

  toast.textContent = message;
  toast.classList.add("show");

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.remove("show");
  }, 3500);
}

function createStars() {
  const field = $("starField");
  if (!field) return;

  field.innerHTML = "";

  for (let i = 0; i < 45; i++) {
    const star = document.createElement("span");
    star.className = "star";
    star.style.left = Math.random() * 100 + "%";
    star.style.top = Math.random() * 100 + "%";
    star.style.animationDelay = Math.random() * 4 + "s";
    star.style.animationDuration = (2 + Math.random() * 4) + "s";
    field.appendChild(star);
  }
}

function toggleTheme() {
  const light = document.body.classList.toggle("light-theme");
  localStorage.setItem(STORAGE.theme, light ? "light" : "dark");
  $("themeToggle").textContent = light ? "🌙" : "☀️";
}

function loadTheme() {
  const theme = localStorage.getItem(STORAGE.theme);
  const light = theme === "light";

  document.body.classList.toggle("light-theme", light);
  $("themeToggle").textContent = light ? "🌙" : "☀️";
}

/* =========================
   12. EVENT LISTENERS
========================= */

function setupEvents() {
  $("searchForm").addEventListener("submit", (event) => {
    event.preventDefault();
    performSearch($("searchInput").value);
  });

  $("searchMoreButton").addEventListener("click", () => {
    performSearch(currentQuery, true);
  });

  $("loadMoreButton").addEventListener("click", loadMoreHomeVideos);
  $("accountButton").addEventListener("click", handleAuthButton);
  $("authForm").addEventListener("submit", handleAuthSubmit);

  $("switchAuthMode").addEventListener("click", () => {
    setAuthMode(authMode === "login" ? "signup" : "login");
  });

  $("forgotPasswordButton").addEventListener("click", resetPassword);
  $("themeToggle").addEventListener("click", toggleTheme);
  $("clearHistoryButton").addEventListener("click", clearHistory);
  $("createPlaylistButton").addEventListener("click", openCreatePlaylistModal);
  $("playlistForm").addEventListener("submit", createPlaylist);
  $("backToPlaylistsButton").addEventListener("click", backToPlaylists);

  $("exploreButton").addEventListener("click", () => {
    $("searchInput").focus();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  $("modalFavoriteButton").addEventListener("click", () => {
    if (currentVideo) toggleFavorite(currentVideo.id);
  });

  $("modalPlaylistButton").addEventListener("click", openAddToPlaylistModal);

  document.addEventListener("click", (event) => {
    const nav = event.target.closest("[data-section]");
    if (nav) {
      event.preventDefault();
      showSection(nav.dataset.section);
      return;
    }

    const closeButton = event.target.closest("[data-close-modal]");
    if (closeButton) {
      closeModal(closeButton.dataset.closeModal);
      return;
    }

    const playButton = event.target.closest("[data-play-video]");
    if (playButton) {
      openVideo(playButton.dataset.playVideo);
      return;
    }

    const favoriteButton = event.target.closest("[data-favorite-video]");
    if (favoriteButton) {
      toggleFavorite(favoriteButton.dataset.favoriteVideo);
      return;
    }

    const openPlaylistButton = event.target.closest("[data-open-playlist]");
    if (openPlaylistButton) {
      openPlaylist(openPlaylistButton.dataset.openPlaylist);
      return;
    }

    const deletePlaylistButton = event.target.closest("[data-delete-playlist]");
    if (deletePlaylistButton) {
      deletePlaylist(deletePlaylistButton.dataset.deletePlaylist);
      return;
    }

    const addPlaylistButton = event.target.closest("[data-add-to-playlist]");
    if (addPlaylistButton) {
      addCurrentVideoToPlaylist(addPlaylistButton.dataset.addToPlaylist);
      return;
    }

    if (event.target.closest("#createPlaylistFromAdd")) {
      closeModal("playlistModal");
      openCreatePlaylistModal();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeAllModals();
  });

  window.addEventListener("online", () => {
    setConnectionStatus(currentUser ? "پەیوەندی هەیە" : "ئامادەیە");
  });

  window.addEventListener("offline", () => {
    setConnectionStatus("ئینتەرنێت نییە");
  });

  window.addEventListener("beforeunload", () => {
    saveLocalData();
  });
}

/* =========================
   13. START APPLICATION
========================= */

function initializeApp() {
  $("currentYear").textContent = String(new Date().getFullYear());

  createStars();
  loadTheme();

  favorites = uniqueVideos(favorites);
  history = uniqueVideos(history).slice(0, MAX_HISTORY);
  playlists = normalizePlaylists(playlists);

  saveLocalData();
  setupEvents();

  renderAllCollections();
  initializeFirebase();
  loadHomeVideos(true);
}

document.addEventListener("DOMContentLoaded", initializeApp);