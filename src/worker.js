// The Rankings: API for every ranking page, plus photo serving. The pages themselves are static
// files in public/ and never reach this code.

// The owner's draft verification email. Gitignored, so it has to exist locally to build or deploy.
import VERIFICATION_EMAIL from "../verification-email.txt";

// Each ranking's rating categories, the name of its second field (the takeaway's location, a
// racquet's model) and any info tags with their allowed values. A new ranking needs an entry here
// and a folder in public/.
const RANKINGS = {
  takeaway: { categories: ["food", "drive", "sitin", "app"], name: "location", example: "McDonald's" },
  "badminton-shuttles": {
    categories: ["flight", "durability", "feel", "value"], name: "model", example: "Yonex",
    tags: { type: ["Feather", "Nylon"] },
  },
  "badminton-racquets": {
    categories: ["power", "control", "handling", "value"], name: "model", example: "Yonex",
    tags: { weight: ["2U", "3U", "4U", "5U", "6U"], balance: ["Head-heavy", "Even", "Head-light"] },
  },
  "badminton-strings": {
    categories: ["power", "control", "durability", "feel"], name: "model", example: "Yonex",
    tags: { gauge: ["0.60mm", "0.61mm", "0.62mm", "0.63mm", "0.64mm", "0.65mm", "0.66mm", "0.67mm", "0.68mm", "0.69mm", "0.70mm", "0.71mm", "0.72mm"] },
  },
  "badminton-shoes": { categories: ["comfort", "grip", "support", "durability"], name: "model", example: "Yonex" },
  "badminton-grips": { categories: ["tack", "comfort", "sweat", "durability"], name: "model", example: "Yonex" },
};
const WEIGHTS = [0.5, 1, 2, 3];

const SESSION_TTL = 24 * 60 * 60 * 1000; // "just this session" logins
const REMEMBER_TTL = 400 * 24 * 60 * 60 * 1000; // remembered devices (the browser cookie cap)
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
const COOKIE = "rk_session";

export default {
  async fetch(req, env) {
    try {
      return await route(req, env);
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, err.status);
      console.error(err);
      return json({ error: "Something went wrong on the server." }, 500);
    }
  },
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function route(req, env) {
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method;

  if (method !== "GET" && method !== "HEAD") checkOrigin(req, url);

  if (path.startsWith("/photos/") && method === "GET") return getPhoto(env, path.slice(8));

  if (path === "/api/auth/me") return me(req, env);
  if (path === "/api/auth/request" && method === "POST") return requestAccess(req, env, url);
  if (path === "/api/auth/login" && method === "POST") return login(req, env, url);
  if (path === "/api/auth/requests" && method === "GET") return listRequests(req, env);
  let m = path.match(/^\/api\/auth\/requests\/([^/]+)$/);
  if (m && method === "POST") return decideRequest(req, env, url, decodeURIComponent(m[1]));
  if (path === "/api/auth/logout" && method === "POST") return logout(req, env, url);
  if (path === "/api/auth/devices" && method === "GET") return listDevices(req, env);
  m = path.match(/^\/api\/auth\/devices\/([a-f0-9]{64})$/);
  if (m && method === "DELETE") return removeDevice(req, env, m[1]);

  if (path === "/api/photos" && method === "POST") return uploadPhoto(req, env);

  m = path.match(/^\/api\/([a-z-]+)\/entries(?:\/([a-z0-9-]+))?(\/history)?$/);
  if (m && RANKINGS[m[1]]) {
    const [, ranking, id, history] = m;
    if (!id && method === "GET") return listEntries(env, ranking);
    if (!id && method === "POST") return saveEntry(req, env, ranking, null);
    if (id && history && method === "GET") return entryHistory(req, env, ranking, id);
    if (id && !history && method === "PUT") return saveEntry(req, env, ranking, id);
    if (id && !history && method === "DELETE") return deleteEntry(req, env, ranking, id);
  }

  throw new HttpError(404, "Not found.");
}

// ---------- entries ----------

function rowToEntry(row) {
  return {
    id: row.id,
    brand: row.brand,
    location: row.location,
    description: row.description,
    ratings: JSON.parse(row.ratings),
    overall: row.overall,
    photos: JSON.parse(row.photos),
    tags: JSON.parse(row.tags || "{}"),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    edits: row.edits ?? 0,
  };
}

async function listEntries(env, ranking) {
  const { results } = await env.DB.prepare(
    `SELECT e.*, (SELECT COUNT(*) FROM entry_history h WHERE h.entry_id = e.id AND h.action = 'edited') AS edits
     FROM entries e WHERE e.ranking = ?`
  ).bind(ranking).all();
  return json({ entries: results.map(rowToEntry) });
}

// Who made each change is only shown to the owner.
async function entryHistory(req, env, ranking, id) {
  const owner = (await session(req, env))?.role === "owner";
  const { results } = await env.DB.prepare(
    "SELECT action, snapshot, changed_at, editor FROM entry_history WHERE entry_id = ? AND ranking = ? ORDER BY changed_at, id"
  ).bind(id, ranking).all();
  return json({
    history: results.map((r) => ({
      action: r.action, changedAt: r.changed_at, entry: JSON.parse(r.snapshot), ...(owner && { editor: r.editor || "owner" }),
    })),
  });
}

// Weighted average of whichever categories were rated.
function overallOf(ratings) {
  let sum = 0;
  let weights = 0;
  for (const { score, weight } of Object.values(ratings)) {
    sum += score * weight;
    weights += weight;
  }
  return weights ? Math.round((sum / weights) * 100) / 100 : null;
}

function cleanEntry(body, ranking) {
  const text = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const config = RANKINGS[ranking];
  const brand = text(body.brand, 60);
  const location = text(body.location, 80);
  if (!brand) throw new HttpError(400, `Add the brand, like ${config.example}.`);
  if (!location) throw new HttpError(400, `Add the ${config.name}.`);

  const ratings = {};
  for (const cat of config.categories) {
    const r = body.ratings?.[cat];
    if (!r) continue;
    const score = Number(r.score);
    const weight = Number(r.weight);
    if (!(score >= 0 && score <= 10) || (score * 2) % 1 !== 0) throw new HttpError(400, `The ${cat} score must be 0 to 10 in half points.`);
    if (!WEIGHTS.includes(weight)) throw new HttpError(400, `The ${cat} weight isn't one of the options.`);
    ratings[cat] = { score, weight };
  }
  if (!Object.keys(ratings).length) throw new HttpError(400, "Rate at least one category.");

  const photos = Array.isArray(body.photos)
    ? body.photos.filter((k) => typeof k === "string" && /^[a-z0-9-]+\.(jpg|webp|png)$/.test(k)).slice(0, 20)
    : [];

  // Tags are optional; anything not in the allowed list is dropped.
  const tags = {};
  for (const [key, allowed] of Object.entries(config.tags || {})) {
    if (allowed.includes(body.tags?.[key])) tags[key] = body.tags[key];
  }

  return { brand, location, description: text(body.description, 4000), ratings, overall: overallOf(ratings), photos, tags };
}

function slugify(s) {
  return s.toLowerCase().normalize("NFKD").replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "spot";
}

async function saveEntry(req, env, ranking, id) {
  const editor = editorName(await requireSession(req, env));
  const data = cleanEntry(await req.json(), ranking);
  const now = Date.now();

  const isNew = !id;
  let createdAt = now;
  if (id) {
    const existing = await env.DB.prepare("SELECT created_at FROM entries WHERE id = ? AND ranking = ?").bind(id, ranking).first();
    if (!existing) throw new HttpError(404, "That entry doesn't exist any more.");
    createdAt = existing.created_at;
  } else {
    // Readable ids for share links: mcdonalds-botanic-avenue, then -2, -3 for repeats.
    const base = slugify(`${data.brand} ${data.location}`);
    id = base;
    for (let n = 2; await env.DB.prepare("SELECT 1 FROM entries WHERE id = ?").bind(id).first(); n++) id = `${base}-${n}`;
  }

  const entry = { id, ...data, createdAt, updatedAt: now };
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO entries (id, ranking, brand, location, description, ratings, overall, photos, tags, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET brand = excluded.brand, location = excluded.location, description = excluded.description,
         ratings = excluded.ratings, overall = excluded.overall, photos = excluded.photos, tags = excluded.tags, updated_at = excluded.updated_at`
    ).bind(id, ranking, data.brand, data.location, data.description, JSON.stringify(data.ratings), data.overall, JSON.stringify(data.photos),
      JSON.stringify(data.tags), createdAt, now),
    historyRow(env, ranking, entry, isNew ? "created" : "edited", now, editor),
  ]);
  return json({ entry });
}

// Only the owner can delete; approved editors can add and edit.
async function deleteEntry(req, env, ranking, id) {
  const editor = editorName(await requireOwner(req, env));
  const row = await env.DB.prepare("SELECT * FROM entries WHERE id = ? AND ranking = ?").bind(id, ranking).first();
  if (!row) throw new HttpError(404, "That entry doesn't exist any more.");
  await env.DB.batch([
    env.DB.prepare("DELETE FROM entries WHERE id = ?").bind(id),
    historyRow(env, ranking, rowToEntry(row), "deleted", Date.now(), editor),
  ]);
  return json({ ok: true });
}

const editorName = (s) => (s.role === "owner" ? "owner" : s.email);

function historyRow(env, ranking, entry, action, at, editor) {
  const { edits, ...snapshot } = entry;
  return env.DB.prepare("INSERT INTO entry_history (entry_id, ranking, action, snapshot, changed_at, editor) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(entry.id, ranking, action, JSON.stringify(snapshot), at, editor);
}

// ---------- photos ----------

const PHOTO_TYPES = { "image/jpeg": "jpg", "image/webp": "webp", "image/png": "png" };

async function uploadPhoto(req, env) {
  await requireSession(req, env);
  const ext = PHOTO_TYPES[req.headers.get("content-type")];
  if (!ext) throw new HttpError(400, "Photos must be JPEG, WebP or PNG.");
  const body = await req.arrayBuffer();
  if (body.byteLength > MAX_PHOTO_BYTES) throw new HttpError(413, "That photo is over 8 MB.");
  const key = `${crypto.randomUUID()}.${ext}`;
  await env.PHOTOS.put(key, body, { metadata: { contentType: req.headers.get("content-type") } });
  return json({ key });
}

async function getPhoto(env, key) {
  if (!/^[a-z0-9-]+\.(jpg|webp|png)$/.test(key)) throw new HttpError(404, "Not found.");
  const { value, metadata } = await env.PHOTOS.getWithMetadata(key, "stream");
  if (!value) throw new HttpError(404, "Not found.");
  return new Response(value, {
    headers: {
      "content-type": metadata?.contentType || "image/jpeg",
      "cache-control": "public, max-age=31536000, immutable",
    },
  });
}

// ---------- login ----------

async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function randomHex(bytes) {
  return [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Allow `limit` hits per `windowMs` for this key.
async function throttle(env, key, limit, windowMs, message) {
  const now = Date.now();
  const row = await env.DB.prepare("SELECT count, window_start FROM throttle WHERE key = ?").bind(key).first();
  if (!row || now - row.window_start > windowMs) {
    await env.DB.prepare("INSERT OR REPLACE INTO throttle (key, count, window_start) VALUES (?, 1, ?)").bind(key, now).run();
    return;
  }
  if (row.count >= limit) throw new HttpError(429, message);
  await env.DB.prepare("UPDATE throttle SET count = count + 1 WHERE key = ?").bind(key).run();
}

function clientIp(req) {
  return req.headers.get("cf-connecting-ip") || "local";
}

// Codes use letters and digits that can't be mixed up (no O/0, I/1/L).
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function newCode(length) {
  let out = "";
  while (out.length < length) {
    for (const b of crypto.getRandomValues(new Uint8Array(length))) {
      // 248 is the largest multiple of 31 under 256, so every character is equally likely.
      if (b < 248 && out.length < length) out += CODE_ALPHABET[b % 31];
    }
  }
  return out;
}

const normaliseCode = (code) => String(code || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const formatCode = (code) => `${code.slice(0, 5)}-${code.slice(5)}`;

// The only email the site sends: telling the owner someone wants access. Cloudflare's own email
// can send to the owner's verified address. Codes are emailed by the owner by hand.
async function notifyOwner(env, subject, text) {
  if (env.DEV_MODE === "1") {
    console.log(`[email to owner] ${subject}\n${text}`);
    return;
  }
  if (!env.EMAIL) return; // not set up: the Requests count on the site still shows it
  try {
    // Loaded here because the local dev runtime doesn't have it.
    const { EmailMessage } = await import("cloudflare:email");
    const from = env.EMAIL_FROM;
    const raw = [
      `From: The Rankings <${from}>`,
      `To: ${env.NOTIFY_EMAIL}`,
      `Subject: ${subject}`,
      `Message-ID: <${randomHex(12)}@${from.split("@")[1]}>`,
      `Date: ${new Date().toUTCString()}`,
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=utf-8",
      "",
      text,
    ].join("\r\n");
    await env.EMAIL.send(new EmailMessage(from, env.NOTIFY_EMAIL, raw));
  } catch (err) {
    console.error("Owner email failed:", err);
  }
}

// The owner's draft verification email (verification-email.txt, gitignored), filled in.
function verificationEmail(origin, code) {
  const filled = VERIFICATION_EMAIL.replaceAll("{{code}}", code).replaceAll("{{link}}", origin);
  const m = filled.match(/^Subject:\s*(.*)\r?\n\r?\n?/);
  return m ? { subject: m[1].trim(), body: filled.slice(m[0].length).trim() } : { subject: "Your code for The Rankings", body: filled.trim() };
}

// Makes a new one-time code for an approved person. Only its hash is stored, so this is the one
// chance to see it: it goes back to the owner with the filled-in email to send.
async function issueCode(env, origin, email) {
  const code = formatCode(newCode(10));
  await env.DB.batch([
    env.DB.prepare("INSERT INTO login_codes (code_hash, email, created_at) VALUES (?, ?, ?)").bind(await sha256(normaliseCode(code)), email, Date.now()),
    env.DB.prepare("UPDATE access_requests SET wants_code = 0 WHERE email = ?").bind(email),
  ]);
  return { code, ...verificationEmail(origin, code) };
}

const REQUEST_SENT = "Request sent. Once you've been verified you'll receive an email with your code.";

async function requestAccess(req, env, url) {
  const email = String((await req.json()).email || "").trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, "Enter a valid email address.");
  await throttle(env, `request:${clientIp(req)}`, 5, 60 * 60 * 1000, "Too many requests from here. Try again in an hour.");
  await throttle(env, "request-hour", 30, 60 * 60 * 1000, "Too many requests right now. Try again in an hour.");

  // Every case gets the same reply, so the form doesn't reveal anyone's status.
  const existing = await env.DB.prepare("SELECT status, wants_code FROM access_requests WHERE email = ?").bind(email).first();
  if (existing?.status === "approved" && !existing.wants_code) {
    // Already verified and asking again (a new device): flag it for a new code.
    await env.DB.prepare("UPDATE access_requests SET wants_code = 1 WHERE email = ?").bind(email).run();
    await notifyOwner(env, `New code wanted by ${email}`,
      `${email} is already approved and has asked for a new code.\n\nMake one at ${url.origin}/takeaway/ (log in, then open Requests).`);
  } else if (!existing) {
    await env.DB.prepare("INSERT INTO access_requests (email, status, created_at) VALUES (?, 'pending', ?)").bind(email, Date.now()).run();
    await notifyOwner(env, `Access request from ${email}`,
      `${email} has asked for editing access to The Rankings.\n\nApprove or decline it at ${url.origin}/takeaway/ (log in, then open Requests).`);
  }
  return json({ message: REQUEST_SENT });
}

async function login(req, env, url) {
  await throttle(env, `login:${clientIp(req)}`, 20, 60 * 60 * 1000, "Too many tries. Wait an hour and try again.");
  const body = await req.json();
  const code = normaliseCode(body.code);
  if (!code) throw new HttpError(400, "Enter your code.");
  const hash = await sha256(code);

  // Comparing hashes keeps the check the same length whatever was typed.
  if (env.PERMANENT_CODE && hash === (await sha256(normaliseCode(env.PERMANENT_CODE)))) {
    return startSession(req, env, url, !!body.remember, "owner", null);
  }

  const row = await env.DB.prepare(
    `SELECT c.email FROM login_codes c JOIN access_requests a ON a.email = c.email
     WHERE c.code_hash = ? AND c.used = 0 AND a.status = 'approved'`
  ).bind(hash).first();
  if (!row) throw new HttpError(400, "That code isn't right, or it's already been used. Each emailed code works once.");
  await env.DB.prepare("UPDATE login_codes SET used = 1 WHERE code_hash = ?").bind(hash).run();
  return startSession(req, env, url, !!body.remember, "editor", row.email);
}

async function me(req, env) {
  const s = await session(req, env);
  if (!s) return json({ signedIn: false });
  const pending = s.role === "owner"
    ? (await env.DB.prepare("SELECT COUNT(*) AS n FROM access_requests WHERE status = 'pending' OR (status = 'approved' AND wants_code = 1)").first()).n
    : 0;
  return json({ signedIn: true, role: s.role, email: s.email, pending });
}

async function listRequests(req, env) {
  await requireOwner(req, env);
  const { results } = await env.DB.prepare("SELECT * FROM access_requests ORDER BY created_at DESC").all();
  return json({
    requests: results.map((r) => ({ email: r.email, status: r.status, wantsCode: !!r.wants_code, createdAt: r.created_at, decidedAt: r.decided_at })),
  });
}

// approve (also makes a new code for someone already approved), decline, or remove someone's access.
async function decideRequest(req, env, url, email) {
  await requireOwner(req, env);
  const { action } = await req.json();
  const row = await env.DB.prepare("SELECT status FROM access_requests WHERE email = ?").bind(email).first();
  if (!row) throw new HttpError(404, "There's no request from that email.");
  const now = Date.now();

  if (action === "approve") {
    if (row.status !== "approved") {
      await env.DB.prepare("UPDATE access_requests SET status = 'approved', decided_at = ? WHERE email = ?").bind(now, email).run();
    }
    return json({ ok: true, email, ...(await issueCode(env, url.origin, email)) });
  }
  if (action === "decline" || action === "remove") {
    await env.DB.batch([
      env.DB.prepare("UPDATE access_requests SET status = ?, wants_code = 0, decided_at = ? WHERE email = ?").bind(action === "decline" ? "declined" : "revoked", now, email),
      env.DB.prepare("UPDATE login_codes SET used = 1 WHERE email = ?").bind(email),
      env.DB.prepare("DELETE FROM sessions WHERE email = ?").bind(email),
    ]);
    return json({ ok: true });
  }
  throw new HttpError(400, "Unknown action.");
}

function deviceLabel(ua = "") {
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Firefox\//.test(ua) ? "Firefox"
    : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android"
    : /Windows/.test(ua) ? "Windows" : /Mac OS X/.test(ua) ? "Mac" : /Linux/.test(ua) ? "Linux" : "unknown device";
  return `${browser} on ${os}`;
}

async function startSession(req, env, url, remember, role, email) {
  const token = randomHex(32);
  const now = Date.now();
  const ttl = remember ? REMEMBER_TTL : SESSION_TTL;
  await env.DB.prepare("INSERT INTO sessions (id, label, remember, created_at, last_seen, expires_at, role, email) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(await sha256(token), deviceLabel(req.headers.get("user-agent") || ""), remember ? 1 : 0, now, now, now + ttl, role, email).run();
  const parts = [`${COOKIE}=${token}`, "Path=/", "HttpOnly", "SameSite=Lax"];
  if (url.protocol === "https:") parts.push("Secure");
  if (remember) parts.push(`Max-Age=${Math.floor(ttl / 1000)}`);
  return json({ signedIn: true, role, email }, 200, { "set-cookie": parts.join("; ") });
}

function cookieToken(req) {
  const m = (req.headers.get("cookie") || "").match(new RegExp(`(?:^|;\\s*)${COOKIE}=([a-f0-9]{64})`));
  return m ? m[1] : null;
}

async function session(req, env) {
  const token = cookieToken(req);
  if (!token) return null;
  const id = await sha256(token);
  const row = await env.DB.prepare("SELECT * FROM sessions WHERE id = ?").bind(id).first();
  if (!row || row.expires_at < Date.now()) return null;
  if (Date.now() - row.last_seen > 60 * 60 * 1000) {
    await env.DB.prepare("UPDATE sessions SET last_seen = ? WHERE id = ?").bind(Date.now(), id).run();
  }
  return row;
}

async function requireSession(req, env) {
  const s = await session(req, env);
  if (!s) throw new HttpError(401, "Log in to make changes.");
  return s;
}

async function requireOwner(req, env) {
  const s = await requireSession(req, env);
  if (s.role !== "owner") throw new HttpError(403, "Only the site owner can do that.");
  return s;
}

async function logout(req, env, url) {
  const token = cookieToken(req);
  if (token) await env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(await sha256(token)).run();
  const parts = [`${COOKIE}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (url.protocol === "https:") parts.push("Secure");
  return json({ signedIn: false }, 200, { "set-cookie": parts.join("; ") });
}

// The owner sees every logged-in device; an editor sees only their own.
async function listDevices(req, env) {
  const current = await requireSession(req, env);
  const { results } = current.role === "owner"
    ? await env.DB.prepare("SELECT * FROM sessions WHERE expires_at > ? ORDER BY last_seen DESC").bind(Date.now()).all()
    : await env.DB.prepare("SELECT * FROM sessions WHERE expires_at > ? AND email = ? ORDER BY last_seen DESC").bind(Date.now(), current.email).all();
  return json({
    devices: results.map((r) => ({
      id: r.id, label: r.label, email: r.email, remember: !!r.remember, createdAt: r.created_at, lastSeen: r.last_seen, current: r.id === current.id,
    })),
  });
}

async function removeDevice(req, env, id) {
  const s = await requireSession(req, env);
  if (s.role === "owner") await env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(id).run();
  else await env.DB.prepare("DELETE FROM sessions WHERE id = ? AND email = ?").bind(id, s.email).run();
  return json({ ok: true });
}

// ---------- helpers ----------

// Changes must come from the site itself, not a form on another site.
function checkOrigin(req, url) {
  const origin = req.headers.get("origin");
  if (origin && origin !== url.origin) throw new HttpError(403, "Changes must be made from the site itself.");
}

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}
