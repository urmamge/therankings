import { api, esc, formatDate, auth, onAuthChange, checkAuth, openLogin, openDevices, openRequests, confirmDialog, uploadPhoto, photoUrl } from "/shared/rankings.js";

const RANKING = "takeaway";

const ICONS = {
  food: '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M5 14c0-5 5-8 11-8s11 3 11 8z"/><path d="M4 18h24"/><path d="M5 22h22c0 2.5-2 4-4.5 4h-13C7 26 5 24.5 5 22z"/></svg>',
  drive: '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M5 20l2.5-7c.5-1.3 1.5-2 3-2h11c1.5 0 2.5.7 3 2L27 20"/><rect x="3" y="20" width="26" height="6" rx="2"/><circle cx="9" cy="26" r="2"/><circle cx="23" cy="26" r="2"/></svg>',
  sitin: '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M4 12h24"/><path d="M8 12l-2 14M24 12l2 14"/><path d="M11 6c0 2 2 2 2 4M16 5c0 2 2 2 2 4M21 6c0 2 2 2 2 4"/></svg>',
  app: '<svg viewBox="0 0 32 32" aria-hidden="true"><rect x="9" y="3" width="14" height="26" rx="3"/><path d="M14 25h4"/><path d="M13 11l2.5 2.5L20 9"/></svg>',
};

const CATS = [
  { key: "food", label: "Food", short: "FOOD" },
  { key: "drive", label: "Drive thru", short: "DRIVE THRU" },
  { key: "sitin", label: "Sit in", short: "SIT IN" },
  { key: "app", label: "App experience", short: "APP" },
];

const WEIGHTS = [
  { value: 0.5, label: "Less" },
  { value: 1, label: "Normal" },
  { value: 2, label: "More" },
  { value: 3, label: "Most" },
];

// Brand colours, so each chain's cards look like its packaging. Anything else gets a colour from its name.
const BRANDS = {
  mcdonalds: ["#DA291C", "#FFC72C"],
  kfc: ["#A3080C", "#FFFFFF"],
  burgerking: ["#F5EBDC", "#D62300"],
  subway: ["#008938", "#FFCE00"],
  dominos: ["#006491", "#FFFFFF"],
  fiveguys: ["#C8102E", "#FFFFFF"],
  nandos: ["#000000", "#E40046"],
  greggs: ["#00558F", "#FDB913"],
  supermacs: ["#E31837", "#FFFFFF"],
  papajohns: ["#00573F", "#FFFFFF"],
  wendys: ["#E2203D", "#FFFFFF"],
  tacobell: ["#702082", "#FFFFFF"],
  pizzahut: ["#EE3124", "#FFFFFF"],
  timhortons: ["#C8102E", "#FFFFFF"],
  starbucks: ["#00704A", "#FFFFFF"],
  popeyes: ["#FF7900", "#FFFFFF"],
  wingstop: ["#00563F", "#FFFFFF"],
  chickfila: ["#DD0031", "#FFFFFF"],
  leon: ["#1D1D1B", "#FFFFFF"],
};

const brandKey = (b) => b.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]/g, "");

function brandColours(brand) {
  const known = BRANDS[brandKey(brand)];
  if (known) return known;
  let h = 0;
  for (const c of brandKey(brand)) h = (h * 31 + c.charCodeAt(0)) % 360;
  return [`hsl(${h} 70% 42%)`, "#FFFFFF"];
}

// Chip dots use the brand colour, or its text colour when the brand colour is too pale to see.
function brandDot(brand) {
  const [bg, ink] = brandColours(brand);
  const m = /^#(..)(..)(..)$/.exec(bg);
  const light = m && (parseInt(m[1], 16) * 299 + parseInt(m[2], 16) * 587 + parseInt(m[3], 16) * 114) / 1000 > 200;
  return light ? ink : bg;
}

// The brand name sized to fit across its plate.
const plate = (brand) => `<span class="plate" aria-hidden="true" style="--len:${Math.max(brand.length, 4)}">${esc(brand)}</span>`;

const title = (e) => `${e.brand} ${e.location}`;
const fmt = (n) => (n == null ? "–" : n >= 10 ? "10" : (Math.round(n * 10) / 10).toFixed(1));
const tier = (n) => (n >= 8 ? "great" : n >= 6 ? "good" : n >= 4 ? "meh" : "bad");

function overallOf(ratings) {
  let sum = 0;
  let weights = 0;
  for (const { score, weight } of Object.values(ratings)) {
    sum += score * weight;
    weights += weight;
  }
  return weights ? sum / weights : null;
}

// ---------- state ----------

const state = { entries: [], q: "", brand: "", sort: "rating-desc", view: "spots" };
const $ = (s, root = document) => root.querySelector(s);

try {
  state.sort = localStorage.getItem("rk-takeaway-sort") || state.sort;
} catch {}
$("#sort").value = state.sort;

async function load() {
  try {
    state.entries = (await api(`/api/${RANKING}/entries`)).entries;
  } catch (e) {
    $("#grid").innerHTML = `<div class="empty"><h2>The rankings didn't load.</h2><p>${esc(e.message)}</p><button class="btn" data-retry>Try again</button></div>`;
    return;
  }
  render();
}

// Leaderboard order: best first, ties share a rank (1, 1, 3).
function ranked() {
  const sorted = [...state.entries].sort((a, b) => b.overall - a.overall || title(a).localeCompare(title(b)));
  let rank = 0;
  return sorted.map((e, i) => {
    if (i === 0 || e.overall !== sorted[i - 1].overall) rank = i + 1;
    return { ...e, rank };
  });
}

function render() {
  renderAccount();
  renderChamp();
  renderBrands();
  renderGrid();
  renderBoard();
}

function renderAccount() {
  $("#account").innerHTML = auth.signedIn
    ? `<button class="btn btn-add" data-add>Add a spot</button>${auth.role === "owner"
        ? `<button class="btn btn-ghost" data-requests>Requests${auth.pending ? ` <span class="count">${auth.pending}</span>` : ""}</button>` : ""}<button class="btn btn-ghost" data-devices>Devices</button>`
    : `<button class="btn btn-ghost" data-login>Log in to edit</button>`;
}

function renderChamp() {
  const top = ranked()[0];
  const champ = $("#champ");
  champ.hidden = !top;
  if (!top) return;
  champ.dataset.open = top.id;
  champ.setAttribute("aria-label", `Number one: ${title(top)}, ${fmt(top.overall)} out of 10`);
  champ.innerHTML = `<span class="champ-label">Number one right now</span>
    <span class="champ-score">${fmt(top.overall)}</span>
    <span class="champ-name">${esc(title(top))}</span>`;
}

function brandGroups() {
  const groups = new Map();
  for (const e of state.entries) {
    const k = brandKey(e.brand);
    if (!groups.has(k)) groups.set(k, { name: e.brand, count: 0 });
    groups.get(k).count++;
  }
  return [...groups.entries()].sort((a, b) => b[1].count - a[1].count || a[1].name.localeCompare(b[1].name));
}

function renderBrands() {
  const groups = brandGroups();
  if (state.brand && !groups.some(([k]) => k === state.brand)) state.brand = "";
  $("#brands").innerHTML = groups.length < 2 ? "" : [
    `<button class="chip" data-brand="" aria-pressed="${!state.brand}">All <span>${state.entries.length}</span></button>`,
    ...groups.map(([k, g]) => {
      return `<button class="chip" data-brand="${esc(k)}" aria-pressed="${state.brand === k}" style="--dot:${brandDot(g.name)}">
        <i></i>${esc(g.name)} <span>${g.count}</span></button>`;
    }),
  ].join("");
}

function visible() {
  const q = state.q.trim().toLowerCase();
  const list = state.entries.filter(
    (e) => (!state.brand || brandKey(e.brand) === state.brand) && (!q || e.location.toLowerCase().includes(q) || title(e).toLowerCase().includes(q))
  );
  const byName = (a, b) => title(a).localeCompare(title(b), "en", { sensitivity: "base" });
  const sorts = {
    "rating-desc": (a, b) => b.overall - a.overall || byName(a, b),
    "rating-asc": (a, b) => a.overall - b.overall || byName(a, b),
    az: byName,
    za: (a, b) => byName(b, a),
  };
  return list.sort(sorts[state.sort]);
}

function card(e) {
  const [bg, ink] = brandColours(e.brand);
  const top = e.photos.length
    ? `<img src="${photoUrl(e.photos[0])}" alt="" loading="lazy">`
    : plate(e.brand);
  return `<a class="card" href="?spot=${encodeURIComponent(e.id)}" data-open="${esc(e.id)}" style="--brand:${bg};--brand-ink:${ink}">
    <div class="card-top${e.photos.length ? " has-photo" : ""}">${top}</div>
    <div class="card-body">
      <p class="card-brand">${esc(e.brand)}</p>
      <h3>${esc(e.location)}</h3>
      ${e.description ? `<p class="card-desc">${esc(e.description)}</p>` : ""}
    </div>
    <div class="stamp tier-${tier(e.overall)}" aria-label="${fmt(e.overall)} out of 10"><b>${fmt(e.overall)}</b><small>/10</small></div>
  </a>`;
}

function renderGrid() {
  const grid = $("#grid");
  if (!state.entries.length) {
    grid.innerHTML = `<div class="empty">
      <h2>No spots yet.</h2>
      <p>${auth.signedIn ? "Add the first place you've eaten at." : "Log in to add the first place you've eaten at."}</p>
      <button class="btn btn-add" ${auth.signedIn ? "data-add" : "data-login"}>${auth.signedIn ? "Add a spot" : "Log in to edit"}</button>
    </div>`;
    return;
  }
  const list = visible();
  grid.innerHTML = list.length
    ? list.map(card).join("")
    : `<div class="empty"><h2>Nothing matches.</h2><p>No spots match ${state.q ? `“${esc(state.q)}”` : "that brand"}${state.q && state.brand ? " for that brand" : ""}.</p>
       <button class="btn" data-clear>Clear filters</button></div>`;
}

function renderBoard() {
  const list = ranked();
  $("#board-list").innerHTML = list.length
    ? list.map((e) => `<li class="${e.rank === 1 ? "first" : ""}"><a href="?spot=${encodeURIComponent(e.id)}" data-open="${esc(e.id)}">
        <span class="rank">${e.rank}</span><span class="name">${esc(title(e))}</span><span class="leader" aria-hidden="true"></span><span class="score">${fmt(e.overall)}</span>
      </a></li>`).join("")
    : `<li class="board-empty">The board fills up once spots are added.</li>`;
}

// ---------- detail (the receipt) ----------

let openDialog = null;

function closeOpen() {
  if (openDialog?.open) openDialog.close();
}

function showDetail(id, { push = true } = {}) {
  const e = state.entries.find((x) => x.id === id);
  if (!e) return;
  closeOpen();
  if (push) history.pushState({ spot: id }, "", `?spot=${encodeURIComponent(id)}`);
  document.title = `${title(e)} | The Rankings`;

  const rank = ranked().find((x) => x.id === id).rank;
  const [bg, ink] = brandColours(e.brand);
  const rows = CATS.map(({ key, short }) => {
    const r = e.ratings[key];
    return r
      ? `<li><span>${short}</span><span class="w">×${r.weight}</span><span>${fmt(r.score)}</span></li>`
      : `<li class="unrated"><span>${short}</span><span class="w"></span><span>not rated</span></li>`;
  }).join("");

  const d = document.createElement("dialog");
  d.className = "detail";
  d.style.cssText = `--brand:${bg};--brand-ink:${ink}`;
  d.innerHTML = `
    <div class="detail-inner">
      <button class="detail-close" aria-label="Close">×</button>
      <div class="detail-main">
        ${e.photos.length ? `<div class="photos">${e.photos.map((p) => `<img src="${photoUrl(p)}" alt="Photo from ${esc(title(e))}">`).join("")}</div>`
          : `<div class="photos photos-none">${plate(e.brand)}</div>`}
        <div class="detail-title">
          <div><p class="detail-brand">${esc(e.brand)}</p><h2>${esc(e.location)}</h2></div>
          <div class="stamp tier-${tier(e.overall)}" aria-hidden="true"><b>${fmt(e.overall)}</b><small>/10</small></div>
        </div>
        ${e.description ? `<div class="verdict">${esc(e.description).split(/\n{2,}/).map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`).join("")}</div>` : ""}
        <div class="history" hidden></div>
      </div>
      <aside class="receipt" aria-label="Scores"><div class="paper">
        <p class="r-head">THE TAKEAWAY RANKINGS</p>
        <p class="r-center">${esc(e.brand.toUpperCase())}<br>${esc(e.location.toUpperCase())}</p>
        <p class="r-meta"><span>RANK ${rank} OF ${state.entries.length}</span><span>${formatDate(e.updatedAt).toUpperCase()}</span></p>
        <ul class="r-lines">${rows}</ul>
        <p class="r-total"><span>TOTAL</span><span><b>${fmt(e.overall)}</b>/10</span></p>
        <p class="r-foot">THANK YOU FOR EATING HERE<br>PLEASE COME AGAIN (MAYBE)</p>
      </div></aside>
      ${auth.signedIn ? `<div class="detail-actions"><button class="btn btn-add" data-edit="${esc(e.id)}">Edit this spot</button></div>` : ""}
    </div>`;
  document.body.append(d);
  openDialog = d;
  d.querySelector(".detail-close").addEventListener("click", () => d.close());
  d.addEventListener("click", (ev) => ev.target === d && d.close());
  d.addEventListener("close", () => {
    d.remove();
    if (openDialog === d) {
      openDialog = null;
      document.title = "Takeaways | The Rankings";
    }
    if (new URLSearchParams(location.search).get("spot") === id) history.pushState({}, "", location.pathname);
  });
  d.showModal();
  loadHistory(e, d.querySelector(".history"));
}

function describeChange(prev, next) {
  const bits = [];
  for (const { key, label } of CATS) {
    const a = prev.ratings[key];
    const b = next.ratings[key];
    if (!a && b) bits.push(`${label} rated ${fmt(b.score)}`);
    else if (a && !b) bits.push(`${label} rating removed`);
    else if (a && b && a.score !== b.score) bits.push(`${label} ${fmt(a.score)} to ${fmt(b.score)}`);
    if (a && b && a.weight !== b.weight) bits.push(`${label} weight ${WEIGHTS.find((w) => w.value === a.weight).label.toLowerCase()} to ${WEIGHTS.find((w) => w.value === b.weight).label.toLowerCase()}`);
  }
  if (prev.description !== next.description) bits.push("write-up changed");
  const added = next.photos.filter((p) => !prev.photos.includes(p)).length;
  const removed = prev.photos.filter((p) => !next.photos.includes(p)).length;
  if (added) bits.push(`${added} photo${added > 1 ? "s" : ""} added`);
  if (removed) bits.push(`${removed} photo${removed > 1 ? "s" : ""} removed`);
  if (prev.brand !== next.brand || prev.location !== next.location) bits.push(`renamed from ${title(prev)}`);
  return bits;
}

async function loadHistory(entry, el) {
  let history;
  try {
    ({ history } = await api(`/api/${RANKING}/entries/${encodeURIComponent(entry.id)}/history`));
  } catch {
    return;
  }
  const events = history.filter((h) => h.action !== "deleted");
  if (events.length < 2) {
    if (events[0]) {
      el.hidden = false;
      el.innerHTML = `<p class="history-one">First rated ${formatDate(events[0].changedAt)}</p>`;
    }
    return;
  }
  const items = events.map((h, i) => {
    const by = h.editor ? `<small>By ${h.editor === "owner" ? "you" : esc(h.editor)}</small>` : "";
    if (i === 0) return `<li><b>${formatDate(h.changedAt)}</b> First rated ${fmt(h.entry.overall)}${by}</li>`;
    const prev = events[i - 1].entry;
    const scoreBit = prev.overall !== h.entry.overall ? `${fmt(prev.overall)} to ${fmt(h.entry.overall)}` : `Still ${fmt(h.entry.overall)}`;
    const bits = describeChange(prev, h.entry);
    return `<li><b>${formatDate(h.changedAt)}</b> ${scoreBit}${bits.length ? `<small>${esc(bits.join(", "))}</small>` : ""}${by}</li>`;
  }).reverse();
  el.hidden = false;
  el.innerHTML = `<details><summary>Edited ${events.length - 1} time${events.length > 2 ? "s" : ""}</summary><ol>${items.join("")}</ol></details>`;
}

// ---------- editor ----------

function knownBrandNames() {
  const names = new Map();
  for (const e of state.entries) names.set(brandKey(e.brand), e.brand);
  for (const n of ["McDonald's", "KFC", "Burger King", "Subway", "Domino's", "Five Guys", "Nando's", "Greggs", "Supermac's", "Papa John's", "Wendy's", "Taco Bell", "Pizza Hut", "Popeyes"]) {
    if (!names.has(brandKey(n))) names.set(brandKey(n), n);
  }
  return [...names.values()];
}

function openEditor(existing) {
  closeOpen();
  const draft = existing
    ? structuredClone({ brand: existing.brand, location: existing.location, description: existing.description, ratings: existing.ratings, photos: existing.photos })
    : { brand: "", location: "", description: "", ratings: {}, photos: [] };
  let uploading = 0;

  const d = document.createElement("dialog");
  d.className = "editor";
  d.innerHTML = `
    <form class="editor-inner" novalidate>
      <button type="button" class="detail-close" aria-label="Close">×</button>
      <h2>${existing ? `Edit ${esc(title(existing))}` : "Add a spot"}</h2>
      <div class="field-row">
        <label class="field"><span>Brand</span>
          <input name="brand" list="brand-list" required maxlength="60" placeholder="McDonald's" value="${esc(draft.brand)}" autocomplete="off">
          <datalist id="brand-list">${knownBrandNames().map((n) => `<option value="${esc(n)}">`).join("")}</datalist>
        </label>
        <label class="field"><span>Location</span>
          <input name="location" required maxlength="80" placeholder="Botanic Avenue" value="${esc(draft.location)}" autocomplete="off">
        </label>
      </div>

      <h3 class="editor-sub">Ratings</h3>
      <p class="editor-hint">Rate whichever apply. The weight decides how much each one counts towards the overall score.</p>
      <div class="rates">${CATS.map(({ key, label }) => `
        <fieldset class="rate" data-cat="${key}">
          <legend>${ICONS[key]}${label}</legend>
          <button type="button" class="rate-start">Rate ${label.toLowerCase()}</button>
          <div class="rate-body">
            <div class="rate-score">
              <button type="button" class="step" data-step="-0.5" aria-label="Lower ${label} score">−</button>
              <output></output>
              <button type="button" class="step" data-step="0.5" aria-label="Raise ${label} score">+</button>
            </div>
            <input type="range" min="0" max="10" step="0.5" aria-label="${label} score">
            <div class="weights" role="radiogroup" aria-label="${label} weight">
              ${WEIGHTS.map((w) => `<button type="button" role="radio" data-weight="${w.value}">${w.label}</button>`).join("")}
            </div>
            <button type="button" class="rate-clear">Don't rate ${label.toLowerCase()}</button>
          </div>
        </fieldset>`).join("")}
      </div>

      <div class="live-total">
        <div><span>Overall</span><small class="plain"></small></div>
        <b class="live-score"></b>
      </div>

      <label class="field"><span>Why this score</span>
        <textarea name="description" rows="5" maxlength="4000" placeholder="What made it good or bad?">${esc(draft.description)}</textarea>
      </label>

      <div class="field"><span>Photos</span>
        <div class="photo-edit">
          <div class="thumbs"></div>
          <label class="add-photo"><input type="file" accept="image/jpeg,image/png,image/webp,image/*" multiple hidden>Add photos</label>
        </div>
      </div>

      <p class="form-error" role="alert" hidden></p>
      <div class="editor-actions">
        ${existing && auth.role === "owner" ? `<button type="button" class="btn btn-danger" data-delete>Delete spot</button>` : ""}
        <span></span>
        <button type="button" class="btn btn-ghost" data-cancel>Cancel</button>
        <button type="submit" class="btn btn-add">${existing ? "Save changes" : "Add spot"}</button>
      </div>
    </form>`;
  document.body.append(d);
  openDialog = d;
  const form = d.querySelector("form");
  const error = d.querySelector(".form-error");

  const showError = (msg) => {
    error.textContent = msg;
    error.hidden = !msg;
  };

  function paintRate(fs) {
    const key = fs.dataset.cat;
    const r = draft.ratings[key];
    fs.classList.toggle("on", !!r);
    if (!r) return;
    fs.querySelector("output").textContent = fmt(r.score);
    fs.querySelector("output").className = `tier-${tier(r.score)}`;
    const range = fs.querySelector("input[type=range]");
    range.value = r.score;
    range.style.setProperty("--fill", `${r.score * 10}%`);
    fs.querySelectorAll("[data-weight]").forEach((b) => b.setAttribute("aria-checked", Number(b.dataset.weight) === r.weight));
  }

  function paintTotal() {
    const vals = Object.values(draft.ratings);
    const overall = overallOf(draft.ratings);
    const live = d.querySelector(".live-score");
    live.textContent = fmt(overall);
    live.className = `live-score${overall == null ? "" : ` tier-${tier(overall)}`}`;
    const plain = vals.length ? vals.reduce((s, r) => s + r.score, 0) / vals.length : null;
    const weighted = vals.some((r) => r.weight !== vals[0].weight);
    d.querySelector(".plain").textContent = overall == null ? "Rate at least one category"
      : weighted && fmt(plain) !== fmt(overall) ? `Without weights it would be ${fmt(plain)}` : "";
  }

  d.querySelectorAll(".rate").forEach((fs) => {
    const key = fs.dataset.cat;
    const set = (score) => {
      draft.ratings[key].score = Math.max(0, Math.min(10, Math.round(score * 2) / 2));
      paintRate(fs);
      paintTotal();
    };
    fs.querySelector(".rate-start").addEventListener("click", () => {
      draft.ratings[key] = { score: 5, weight: 1 };
      paintRate(fs);
      paintTotal();
      fs.querySelector("input[type=range]").focus();
    });
    fs.querySelector(".rate-clear").addEventListener("click", () => {
      delete draft.ratings[key];
      paintRate(fs);
      paintTotal();
    });
    fs.querySelector("input[type=range]").addEventListener("input", (e) => set(Number(e.target.value)));
    fs.querySelectorAll(".step").forEach((b) => b.addEventListener("click", () => set(draft.ratings[key].score + Number(b.dataset.step))));
    fs.querySelectorAll("[data-weight]").forEach((b) =>
      b.addEventListener("click", () => {
        draft.ratings[key].weight = Number(b.dataset.weight);
        paintRate(fs);
        paintTotal();
      })
    );
    paintRate(fs);
  });
  paintTotal();

  const thumbs = d.querySelector(".thumbs");
  function paintPhotos() {
    thumbs.innerHTML = draft.photos.map((p, i) => `<figure><img src="${photoUrl(p)}" alt="Photo ${i + 1}">
      <button type="button" data-remove="${i}" aria-label="Remove photo ${i + 1}">×</button></figure>`).join("")
      + Array.from({ length: uploading }, () => '<figure class="uploading"><span>Uploading…</span></figure>').join("");
  }
  thumbs.addEventListener("click", (e) => {
    const i = e.target.dataset?.remove;
    if (i === undefined) return;
    draft.photos.splice(Number(i), 1);
    paintPhotos();
  });
  d.querySelector(".add-photo input").addEventListener("change", async (e) => {
    const files = [...e.target.files];
    e.target.value = "";
    uploading += files.length;
    paintPhotos();
    await Promise.all(files.map(async (f) => {
      try {
        draft.photos.push(await uploadPhoto(f));
      } catch (err) {
        showError(err.message);
      } finally {
        uploading--;
        paintPhotos();
      }
    }));
  });
  paintPhotos();

  const close = () => d.close();
  d.querySelector(".detail-close").addEventListener("click", close);
  d.querySelector("[data-cancel]").addEventListener("click", close);
  d.addEventListener("close", () => {
    d.remove();
    if (openDialog === d) openDialog = null;
  });

  d.querySelector("[data-delete]")?.addEventListener("click", async () => {
    const ok = await confirmDialog({ title: `Delete ${title(existing)}?`, text: "It comes off the rankings. Its edit history is kept.", yes: "Delete spot" });
    if (!ok) return;
    try {
      await api(`/api/${RANKING}/entries/${encodeURIComponent(existing.id)}`, { method: "DELETE" });
      d.close();
      history.replaceState({}, "", location.pathname);
      await load();
    } catch (err) {
      handleAuthError(err);
      showError(err.message);
    }
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    showError("");
    if (uploading) return showError("Wait for the photos to finish uploading.");
    draft.brand = form.brand.value;
    draft.location = form.location.value;
    draft.description = form.description.value;
    const btn = form.querySelector("[type=submit]");
    btn.disabled = true;
    try {
      const { entry } = existing
        ? await api(`/api/${RANKING}/entries/${encodeURIComponent(existing.id)}`, { method: "PUT", body: draft })
        : await api(`/api/${RANKING}/entries`, { method: "POST", body: draft });
      d.close();
      await load();
      showDetail(entry.id);
    } catch (err) {
      handleAuthError(err);
      showError(err.message);
    } finally {
      btn.disabled = false;
    }
  });

  d.showModal();
  if (!existing) form.brand.focus();
}

// A 401 means the login ran out: show it as logged out so the next step is clear.
function handleAuthError(err) {
  if (err.status === 401) {
    auth.signedIn = false;
    renderAccount();
  }
}

async function requireLogin() {
  return auth.signedIn || openLogin();
}

// ---------- events ----------

document.addEventListener("click", async (e) => {
  const t = e.target.closest("[data-open],[data-add],[data-edit],[data-login],[data-devices],[data-requests],[data-brand],[data-clear],[data-retry]");
  if (!t) return;
  if (t.dataset.open !== undefined) {
    if (e.metaKey || e.ctrlKey || e.shiftKey) return; // let new-tab clicks through
    e.preventDefault();
    showDetail(t.dataset.open);
  } else if (t.dataset.add !== undefined) {
    if (await requireLogin()) openEditor(null);
  } else if (t.dataset.edit !== undefined) {
    const entry = state.entries.find((x) => x.id === t.dataset.edit);
    if (entry && (await requireLogin())) openEditor(entry);
  } else if (t.dataset.login !== undefined) {
    openLogin();
  } else if (t.dataset.devices !== undefined) {
    openDevices();
  } else if (t.dataset.requests !== undefined) {
    openRequests();
  } else if (t.dataset.brand !== undefined) {
    state.brand = t.dataset.brand;
    renderBrands();
    renderGrid();
  } else if (t.dataset.clear !== undefined) {
    state.q = "";
    state.brand = "";
    $("#search").value = "";
    renderBrands();
    renderGrid();
  } else if (t.dataset.retry !== undefined) {
    load();
  }
});

$("#search").addEventListener("input", (e) => {
  state.q = e.target.value;
  renderGrid();
});

$("#sort").addEventListener("change", (e) => {
  state.sort = e.target.value;
  try {
    localStorage.setItem("rk-takeaway-sort", state.sort);
  } catch {}
  renderGrid();
});

const tabs = [$("#tab-spots"), $("#tab-board")];
function setView(view) {
  state.view = view;
  tabs.forEach((t) => t.setAttribute("aria-selected", t.id === `tab-${view}`));
  $("#spots").hidden = view !== "spots";
  $("#board").hidden = view !== "board";
}
tabs.forEach((t) => t.addEventListener("click", () => setView(t.id.slice(4))));
tabs.forEach((t, i) =>
  t.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    const next = tabs[(i + 1) % 2];
    next.focus();
    setView(next.id.slice(4));
  })
);

window.addEventListener("popstate", () => {
  const spot = new URLSearchParams(location.search).get("spot");
  if (spot) showDetail(spot, { push: false });
  else closeOpen();
});

onAuthChange(() => render());

await Promise.all([checkAuth(), load()]);
const startSpot = new URLSearchParams(location.search).get("spot");
if (startSpot) showDetail(startSpot, { push: false });
