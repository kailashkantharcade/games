/* ============================================================
   leaderboard.js
   Shared score board used by snake.html, turtle-crossing.html, and
   the live boards on index.html.

   HOW THIS WORKS — a plain text file, not a database
   ----------------------------------------------------
   GitHub Pages only serves static files — there's no server of
   your own to save scores on. Instead of a database, this uses
   a GitHub Gist, which is just a small text file GitHub hosts
   for you for free. The leaderboard is one line per person:

       snake|Kailash|14|1737558231000
       turtle-crossing|Arjun|6|1737558290000

   game|name|best score|last updated (ms since epoch)

   Reading that file works from any website. Writing to it
   needs a GitHub access token (see setup below).

   >>> If GIST_CONFIG.gistId or .token is left empty, scores
   >>> are saved to THIS BROWSER ONLY (localStorage), so the
   >>> games still work out of the box — your friends just
   >>> won't see your score, and you won't see theirs, until
   >>> you finish the setup below.

   SETUP (about 5 minutes, completely free):
   1. Go to https://gist.github.com while signed into GitHub.
   2. Filename: leaderboard.txt — leave the content box empty
      (or put a single space). Click "Create public gist".
   3. Copy the gist ID from the URL:
      https://gist.github.com/yourname/THIS_LONG_ID_HERE
   4. Go to https://github.com/settings/tokens (classic tokens)
      -> "Generate new token (classic)".
      - Give it a name like "arcade-leaderboard".
      - Set an expiration you're comfortable with.
      - Check ONLY the "gist" checkbox -- nothing else.
      - Generate, then copy the token (starts with ghp_).
   5. Paste both values into GIST_CONFIG below.

   SECURITY NOTE: this token will be visible to anyone who
   views your page source (that's unavoidable on a static site
   with no server). That's why step 4 says to check ONLY the
   "gist" permission -- worst case someone edits your leaderboard
   gist, not your GitHub account or any repo. Don't reuse a
   token that has other permissions.
   ============================================================ */

const GIST_CONFIG = {
  gistId: "9ba71336d9b9045420c50c2003829df0",   // e.g. "1a2b3c4d5e6f7g8h9i0j1k2l3m4n5o6p"
  token: "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",    // classic GitHub token with ONLY the "gist" scope
  filename: "leaderboard.txt"
};

const isConfigured = !!(GIST_CONFIG.gistId && GIST_CONFIG.token);

const GIST_API = "https://api.github.com/gists/";

let cache = null;          // parsed rows from the gist, once loaded
let cachePromise = null;   // in-flight fetch, so parallel calls share one request
const watchers = {};       // gameId -> [callback, ...]
let pollHandle = null;

/* ---------- text <-> rows ---------- */

function parseText(text) {
  return String(text || "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const [game, name, score, date] = line.split("|");
      return { game, name, score: parseInt(score, 10) || 0, date: parseInt(date, 10) || 0 };
    });
}

function toText(rows) {
  return rows.map((r) => [r.game, r.name, r.score, r.date].join("|")).join("\n");
}

function sanitizeName(name) {
  return String(name || "Anonymous").replace(/[|\n\r]/g, "").trim().slice(0, 20) || "Anonymous";
}

/* ---------- gist read/write ---------- */

async function fetchGist() {
  const res = await fetch(GIST_API + GIST_CONFIG.gistId, {
    headers: { Accept: "application/vnd.github+json" }
  });
  if (!res.ok) throw new Error("Could not read the leaderboard gist (" + res.status + ")");
  const json = await res.json();
  const file = json.files && json.files[GIST_CONFIG.filename];
  return parseText(file ? file.content : "");
}

async function loadAll(force) {
  if (!isConfigured) return [];
  if (cache && !force) return cache;
  if (!cachePromise || force) {
    cachePromise = fetchGist().then((rows) => {
      cache = rows;
      return rows;
    }).catch((err) => {
      console.warn("[leaderboard] " + err.message);
      cache = cache || [];
      return cache;
    });
  }
  return cachePromise;
}

async function saveAll(rows) {
  const res = await fetch(GIST_API + GIST_CONFIG.gistId, {
    method: "PATCH",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: "token " + GIST_CONFIG.token,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ files: { [GIST_CONFIG.filename]: { content: toText(rows) || " " } } })
  });
  if (!res.ok) throw new Error("Could not save to the leaderboard gist (" + res.status + ")");
  cache = rows;
}

/* ---------- local fallback (per-browser only) ---------- */

function localKey(gameId) { return "leaderboard:" + gameId; }

function readLocal(gameId) {
  try { return JSON.parse(localStorage.getItem(localKey(gameId)) || "[]"); }
  catch (e) { return []; }
}

function writeLocal(gameId, list) {
  try { localStorage.setItem(localKey(gameId), JSON.stringify(list)); }
  catch (e) { /* storage unavailable, ignore */ }
}

/* ---------- public API ---------- */

/** Save a score, keeping only each person's best score per game. gameId e.g. "snake" or "turtle-crossing". */
async function submitScore(gameId, name, score) {
  const cleanName = sanitizeName(name);

  if (isConfigured) {
    const rows = (await loadAll(true)).slice();
    const idx = rows.findIndex((r) => r.game === gameId && r.name.toLowerCase() === cleanName.toLowerCase());
    if (idx >= 0) {
      if (score <= rows[idx].score) { notify(gameId); return; } // not a new best, nothing to write
      rows[idx] = { game: gameId, name: cleanName, score, date: Date.now() };
    } else {
      rows.push({ game: gameId, name: cleanName, score, date: Date.now() });
    }
    await saveAll(rows);
    notify(gameId);
    return;
  }

  const list = readLocal(gameId);
  const idx = list.findIndex((e) => e.name.toLowerCase() === cleanName.toLowerCase());
  if (idx >= 0) {
    if (score > list[idx].score) list[idx] = { name: cleanName, score, date: Date.now() };
  } else {
    list.push({ name: cleanName, score, date: Date.now() });
  }
  list.sort((a, b) => b.score - a.score);
  writeLocal(gameId, list.slice(0, 50));
  notify(gameId);
}

function currentList(gameId) {
  if (isConfigured) {
    return (cache || [])
      .filter((r) => r.game === gameId)
      .sort((a, b) => b.score - a.score)
      .map((r) => ({ name: r.name, score: r.score, date: r.date }));
  }
  return readLocal(gameId).sort((a, b) => b.score - a.score);
}

function notify(gameId) {
  (watchers[gameId] || []).forEach((cb) => cb(currentList(gameId)));
}

function startPolling() {
  if (pollHandle || !isConfigured) return;
  pollHandle = setInterval(async () => {
    await loadAll(true);
    Object.keys(watchers).forEach(notify);
  }, 20000); // check for friends' new scores every 20s
}

/** Subscribe to the leaderboard for a game. Calls callback(list) now and whenever it changes. */
function watchLeaderboard(gameId, callback) {
  watchers[gameId] = watchers[gameId] || [];
  watchers[gameId].push(callback);

  if (isConfigured) {
    loadAll().then(() => notify(gameId));
    startPolling();
  } else {
    callback(currentList(gameId));
  }
}

/** Simple name persistence (per-browser, not shared -- that's fine, it's just a preference). */
function getSavedName() {
  try { return localStorage.getItem("playername") || ""; } catch (e) { return ""; }
}
function saveName(name) {
  try { localStorage.setItem("playername", name); } catch (e) { /* ignore */ }
}

window.Leaderboard = {
  isConfigured,
  submitScore,
  watchLeaderboard,
  getSavedName,
  saveName
};
