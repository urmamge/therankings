// One badminton ranking page (shuttles, racquets, ...). The page says which one with
// <body data-ranking="racquets">; everything else comes from RANKINGS below.
import { api, esc, formatDate, auth, onAuthChange, checkAuth, openLogin, openDevices, openRequests, confirmDialog, uploadPhoto, photoUrl } from "/shared/rankings.js";

const gauges = Array.from({ length: 13 }, (_, i) => `0.${60 + i}mm`);

// Keys must match RANKINGS in src/worker.js.
const RANKINGS = {
  shuttles: {
    slug: "badminton-shuttles", title: "Shuttles", one: "shuttle", sub: "Every shuttle I've played with, scored out of 10.",
    example: ["Yonex", "Aerosensa 50"],
    cats: [["flight", "Flight"], ["durability", "Durability"], ["feel", "Feel"], ["value", "Value"]],
    tags: [{ key: "type", label: "Type", options: ["Feather", "Hybrid", "Nylon"] }],
  },
  racquets: {
    slug: "badminton-racquets", title: "Racquets", one: "racquet", sub: "Every racquet I've played with, scored out of 10.",
    example: ["Yonex", "Astrox 88D Pro"],
    cats: [["power", "Power"], ["control", "Control"], ["handling", "Handling"], ["value", "Value"]],
    tags: [
      { key: "weight", label: "Weight", options: ["2U", "3U", "4U", "5U", "6U"] },
      { key: "balance", label: "Balance", options: ["Head-heavy", "Even", "Head-light"] },
    ],
  },
  strings: {
    slug: "badminton-strings", title: "Strings", one: "string", sub: "Every string I've played with, scored out of 10.",
    example: ["Yonex", "BG80"],
    cats: [["power", "Power"], ["control", "Control"], ["durability", "Durability"], ["feel", "Feel"]],
    tags: [{ key: "gauge", label: "Gauge", options: gauges }],
  },
  shoes: {
    slug: "badminton-shoes", title: "Shoes", one: "pair of shoes", sub: "Every pair of court shoes I've played in, scored out of 10.",
    example: ["Yonex", "Power Cushion 65 Z3"],
    cats: [["comfort", "Comfort"], ["grip", "Grip"], ["support", "Support"], ["durability", "Durability"]],
    tags: [],
  },
  grips: {
    slug: "badminton-grips", title: "Grips", one: "grip", sub: "Every grip I've wrapped a handle with, scored out of 10.",
    example: ["Yonex", "Super Grap"],
    cats: [["tack", "Tack"], ["comfort", "Comfort"], ["sweat", "Sweat absorption"], ["durability", "Durability"]],
    tags: [],
  },
};

const R = RANKINGS[document.body.dataset.ranking];
const PAGE_TITLE = `${R.title} | Badminton | The Rankings`;

const WEIGHTS = [
  { value: 0.5, label: "Less" },
  { value: 1, label: "Normal" },
  { value: 2, label: "More" },
  { value: 3, label: "Most" },
];

// Brand colours for the cards. Anything else gets a colour from its name.
const BRANDS = {
  yonex: ["#00965E", "#FFFFFF"],
  lining: ["#C8102E", "#FFFFFF"],
  victor: ["#003C8F", "#FFD100"],
  babolat: ["#1C75BC", "#FFFFFF"],
  ashaway: ["#E30613", "#FFFFFF"],
  apacs: ["#111111", "#E2001A"],
  carlton: ["#E4002B", "#FFFFFF"],
  forza: ["#111111", "#FFFFFF"],
  fzforza: ["#111111", "#FFFFFF"],
  rsl: ["#E20613", "#FFFFFF"],
  kawasaki: ["#5CB82E", "#FFFFFF"],
  mizuno: ["#001E62", "#FFFFFF"],
  asics: ["#002F87", "#FFFFFF"],
  kumpoo: ["#E60012", "#FFFFFF"],
  felet: ["#0057B8", "#FFFFFF"],
  adidas: ["#000000", "#FFFFFF"],
};
const BRAND_NAMES = ["Yonex", "Li-Ning", "Victor", "Babolat", "Ashaway", "Apacs", "Carlton", "FZ Forza", "RSL", "Kawasaki", "Mizuno", "Asics", "Kumpoo", "Felet", "Adidas"];

const brandKey = (b) => b.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]/g, "");

function brandColours(brand) {
  const known = BRANDS[brandKey(brand)];
  if (known) return known;
  let h = 0;
  for (const c of brandKey(brand)) h = (h * 31 + c.charCodeAt(0)) % 360;
  return [`hsl(${h} 60% 38%)`, "#FFFFFF"];
}

// The brand name sized to fit across its plate.
const plate = (brand) => `<span class="plate" aria-hidden="true" style="--len:${Math.max(brand.length, 4)}">${esc(brand)}</span>`;

// Entries store the model in the shared "location" field.
const title = (e) => `${e.brand} ${e.location}`;
const fmt = (n) => (n == null ? "–" : n >= 10 ? "10" : (Math.round(n * 10) / 10).toFixed(1));
const tier = (n) => (n >= 8 ? "great" : n >= 6 ? "good" : n >= 4 ? "meh" : "bad");
const tagList = (e) => R.tags.filter((t) => e.tags?.[t.key]).map((t) => e.tags[t.key]);

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

const state = { entries: [], q: "", brand: "", tagFilters: {}, sort: "rating-desc" };
const $ = (s, root = document) => root.querySelector(s);
const sortKey = `rk-${R.slug}-sort`;

try {
  state.sort = localStorage.getItem(sortKey) || state.sort;
} catch {}

function renderShell() {
  document.title = PAGE_TITLE;
  $("#title").textContent = R.title;
  $("#sub").textContent = R.sub;
  $("#search").placeholder = "Filter by brand or model";
  $("#sort").value = state.sort;
  $("#tag-filters").innerHTML = R.tags
    .map((t) => `<label class="sort"><span class="visually-hidden">${esc(t.label)}</span>
      <select data-tag-filter="${t.key}"><option value="">Any ${esc(t.label.toLowerCase())}</option>
      ${t.options.map((o) => `<option>${esc(o)}</option>`).join("")}</select></label>`)
    .join("");
}

async function load() {
  try {
    state.entries = (await api(`/api/${R.slug}/entries`)).entries;
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
    ? `<button class="btn btn-add" data-add>Add a ${esc(R.one)}</button>${auth.role === "owner"
        ? `<button class="btn btn-ghost" data-requests>Requests${auth.pending ? ` <span class="count">${auth.pending}</span>` : ""}</button>` : ""}<button class="btn btn-ghost" data-devices>Devices</button>`
    : `<button class="btn btn-ghost" data-login>Log in to edit</button>`;
}

function renderChamp() {
  const top = ranked()[0];
  const champ = $("#champ");
  champ.hidden = !top;
  if (!top) return;
  champ.dataset.open = top.id;
  champ.setAttribute("aria-label", `Top of the table: ${title(top)}, ${fmt(top.overall)} out of 10`);
  champ.innerHTML = `<span class="champ-label">Top of the table</span>
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
    ...groups.map(([k, g]) => `<button class="chip" data-brand="${esc(k)}" aria-pressed="${state.brand === k}" style="--dot:${brandColours(g.name)[0]}">
        <i></i>${esc(g.name)} <span>${g.count}</span></button>`),
  ].join("");
}

function visible() {
  const q = state.q.trim().toLowerCase();
  const list = state.entries.filter(
    (e) => (!state.brand || brandKey(e.brand) === state.brand)
      && (!q || title(e).toLowerCase().includes(q))
      && Object.entries(state.tagFilters).every(([k, v]) => !v || e.tags?.[k] === v)
  );
  const byName = (a, b) => title(a).localeCompare(title(b), "en", { sensitivity: "base", numeric: true });
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
  const tags = tagList(e);
  return `<a class="card" href="?item=${encodeURIComponent(e.id)}" data-open="${esc(e.id)}" style="--brand:${bg};--brand-ink:${ink}">
    <div class="card-top${e.photos.length ? " has-photo" : ""}">${e.photos.length ? `<img src="${photoUrl(e.photos[0])}" alt="" loading="lazy">` : plate(e.brand)}</div>
    <div class="card-body">
      <p class="card-brand">${esc(e.brand)}</p>
      <h3>${esc(e.location)}</h3>
      ${tags.length || e.inBag ? `<p class="tags">${e.inBag ? '<span class="bag-tag">In my bag</span>' : ""}${tags.map((t) => `<span>${esc(t)}</span>`).join("")}</p>` : ""}
      ${e.description ? `<p class="card-desc">${esc(e.description)}</p>` : ""}
    </div>
    <div class="badge tier-${tier(e.overall)}" aria-label="${fmt(e.overall)} out of 10"><b>${fmt(e.overall)}</b></div>
  </a>`;
}

function renderGrid() {
  const grid = $("#grid");
  if (!state.entries.length) {
    grid.innerHTML = `<div class="empty">
      <h2>Nothing ranked yet.</h2>
      <p>${auth.signedIn ? `Add the first ${esc(R.one)}.` : `Log in to add the first ${esc(R.one)}.`}</p>
      <button class="btn btn-add" ${auth.signedIn ? "data-add" : "data-login"}>${auth.signedIn ? `Add a ${esc(R.one)}` : "Log in to edit"}</button>
    </div>`;
    return;
  }
  const list = visible();
  grid.innerHTML = list.length
    ? list.map(card).join("")
    : `<div class="empty"><h2>Nothing matches.</h2><p>Nothing matches those filters.</p><button class="btn" data-clear>Clear filters</button></div>`;
}

function renderBoard() {
  const list = ranked();
  const digits = (n) => [...fmt(n)].map((c) => `<span class="${c === "." ? "dot" : "digit"}">${c}</span>`).join("");
  $("#board-list").innerHTML = list.length
    ? list.map((e) => `<li class="${e.rank === 1 ? "first" : ""}"><a href="?item=${encodeURIComponent(e.id)}" data-open="${esc(e.id)}">
        <span class="rank">${e.rank}</span><span class="name">${esc(title(e))}</span><span class="leader" aria-hidden="true"></span>
        <span class="score" aria-label="${fmt(e.overall)}">${digits(e.overall)}</span>
      </a></li>`).join("")
    : `<li class="board-empty">The scoreboard fills up once ${esc(R.title.toLowerCase())} are added.</li>`;
}

// ---------- detail (the scorecard) ----------

let openDialog = null;

function closeOpen() {
  if (openDialog?.open) openDialog.close();
}

function showDetail(id, { push = true } = {}) {
  const e = state.entries.find((x) => x.id === id);
  if (!e) return;
  closeOpen();
  if (push) history.pushState({ item: id }, "", `?item=${encodeURIComponent(id)}`);
  document.title = `${title(e)} | The Rankings`;

  const rank = ranked().find((x) => x.id === id).rank;
  const [bg, ink] = brandColours(e.brand);
  const rows = R.cats.map(([key, label]) => {
    const r = e.ratings[key];
    return r
      ? `<tr><th scope="row">${esc(label)}</th><td class="w">×${r.weight}</td><td class="s">${fmt(r.score)}</td></tr>`
      : `<tr class="unrated"><th scope="row">${esc(label)}</th><td class="w"></td><td class="s">Not rated</td></tr>`;
  }).join("");
  const specs = R.tags.filter((t) => e.tags?.[t.key]).map((t) => `<div><dt>${esc(t.label)}</dt><dd>${esc(e.tags[t.key])}</dd></div>`).join("");

  const d = document.createElement("dialog");
  d.className = "detail";
  d.style.cssText = `--brand:${bg};--brand-ink:${ink}`;
  d.innerHTML = `
    <div class="detail-inner">
      <button class="detail-close" aria-label="Close">×</button>
      <div class="detail-main">
        ${e.photos.length ? `<div class="photos">${e.photos.map((p) => `<img src="${photoUrl(p)}" alt="Photo of ${esc(title(e))}">`).join("")}</div>`
          : `<div class="photos photos-none">${plate(e.brand)}</div>`}
        <div class="detail-title">
          <div><p class="detail-brand">${esc(e.brand)}</p><h2>${esc(e.location)}</h2></div>
          <div class="badge tier-${tier(e.overall)}" aria-hidden="true"><b>${fmt(e.overall)}</b></div>
        </div>
        ${e.description ? `<div class="verdict">${esc(e.description).split(/\n{2,}/).map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`).join("")}</div>` : ""}
        <div class="history" hidden></div>
      </div>
      <aside class="scorecard" aria-label="Scores">
        ${e.inBag ? `<p class="sc-bag">In my bag: I'm using this ${esc(R.one)} right now</p>` : ""}
        <div class="sc-head"><span>Scorecard</span><span>${rank} of ${state.entries.length}</span></div>
        <table>
          <thead><tr><th scope="col">Category</th><th scope="col" class="w">Weight</th><th scope="col" class="s">Score</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <div class="sc-total"><span>Overall</span><b>${fmt(e.overall)}</b><small>/10</small></div>
        ${specs ? `<dl class="specs">${specs}</dl>` : ""}
        <p class="sc-foot">Last updated ${formatDate(e.updatedAt)}</p>
      </aside>
      ${auth.signedIn ? `<div class="detail-actions"><button class="btn btn-add" data-edit="${esc(e.id)}">Edit this ${esc(R.one)}</button></div>` : ""}
    </div>`;
  document.body.append(d);
  openDialog = d;
  d.querySelector(".detail-close").addEventListener("click", () => d.close());
  d.addEventListener("click", (ev) => ev.target === d && d.close());
  d.addEventListener("close", () => {
    d.remove();
    if (openDialog === d) {
      openDialog = null;
      document.title = PAGE_TITLE;
    }
    if (new URLSearchParams(location.search).get("item") === id) history.pushState({}, "", location.pathname);
  });
  d.showModal();
  loadHistory(e, d.querySelector(".history"));
}

function describeChange(prev, next) {
  const bits = [];
  const weightName = (v) => WEIGHTS.find((w) => w.value === v).label.toLowerCase();
  for (const [key, label] of R.cats) {
    const a = prev.ratings[key];
    const b = next.ratings[key];
    if (!a && b) bits.push(`${label} rated ${fmt(b.score)}`);
    else if (a && !b) bits.push(`${label} rating removed`);
    else if (a && b && a.score !== b.score) bits.push(`${label} ${fmt(a.score)} to ${fmt(b.score)}`);
    if (a && b && a.weight !== b.weight) bits.push(`${label} weight ${weightName(a.weight)} to ${weightName(b.weight)}`);
  }
  for (const t of R.tags) {
    const a = prev.tags?.[t.key];
    const b = next.tags?.[t.key];
    if (a !== b) bits.push(b ? `${t.label.toLowerCase()} set to ${b}` : `${t.label.toLowerCase()} removed`);
  }
  if (!!prev.inBag !== !!next.inBag) bits.push(next.inBag ? "put in my bag" : "taken out of my bag");
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
    ({ history } = await api(`/api/${R.slug}/entries/${encodeURIComponent(entry.id)}/history`));
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
  for (const n of BRAND_NAMES) if (!names.has(brandKey(n))) names.set(brandKey(n), n);
  return [...names.values()];
}

// A tag with a few options is a row of buttons (tap again to clear); a long list is a dropdown.
function tagField(t, value) {
  if (t.options.length > 6) {
    return `<label class="field"><span>${esc(t.label)} <em>optional</em></span>
      <select data-tag="${t.key}"><option value="">Not set</option>${t.options.map((o) => `<option${o === value ? " selected" : ""}>${esc(o)}</option>`).join("")}</select></label>`;
  }
  return `<div class="field"><span>${esc(t.label)} <em>optional</em></span>
    <div class="segments" role="radiogroup" aria-label="${esc(t.label)}" data-tag="${t.key}">
      ${t.options.map((o) => `<button type="button" role="radio" aria-checked="${o === value}" data-value="${esc(o)}">${esc(o)}</button>`).join("")}
    </div></div>`;
}

function openEditor(existing) {
  closeOpen();
  const draft = existing
    ? structuredClone({ brand: existing.brand, location: existing.location, description: existing.description, ratings: existing.ratings, photos: existing.photos, tags: existing.tags || {}, inBag: !!existing.inBag })
    : { brand: "", location: "", description: "", ratings: {}, photos: [], tags: {}, inBag: false };
  let uploading = 0;

  const d = document.createElement("dialog");
  d.className = "editor";
  d.innerHTML = `
    <form class="editor-inner" novalidate>
      <button type="button" class="detail-close" aria-label="Close">×</button>
      <h2>${existing ? `Edit ${esc(title(existing))}` : `Add a ${esc(R.one)}`}</h2>
      <div class="field-row">
        <label class="field"><span>Brand</span>
          <input name="brand" list="brand-list" required maxlength="60" placeholder="${esc(R.example[0])}" value="${esc(draft.brand)}" autocomplete="off">
          <datalist id="brand-list">${knownBrandNames().map((n) => `<option value="${esc(n)}">`).join("")}</datalist>
        </label>
        <label class="field"><span>Model</span>
          <input name="location" required maxlength="80" placeholder="${esc(R.example[1])}" value="${esc(draft.location)}" autocomplete="off">
        </label>
      </div>
      ${R.tags.length ? `<div class="field-row">${R.tags.map((t) => tagField(t, draft.tags[t.key])).join("")}</div>` : ""}
      ${auth.role === "owner" ? `<label class="bag-switch"><input type="checkbox" name="inBag"${draft.inBag ? " checked" : ""}>
        <span><strong>In my bag</strong> I'm using this ${esc(R.one)} right now. It shows on the badminton page.</span></label>` : ""}

      <h3 class="editor-sub">Ratings</h3>
      <p class="editor-hint">Rate whichever apply. The weight decides how much each one counts towards the overall score.</p>
      <div class="rates">${R.cats.map(([key, label]) => `
        <fieldset class="rate" data-cat="${key}">
          <legend>${esc(label)}</legend>
          <button type="button" class="rate-start">Rate ${esc(label.toLowerCase())}</button>
          <div class="rate-body">
            <div class="rate-score">
              <button type="button" class="step" data-step="-0.5" aria-label="Lower ${esc(label)} score">−</button>
              <output></output>
              <button type="button" class="step" data-step="0.5" aria-label="Raise ${esc(label)} score">+</button>
            </div>
            <input type="range" min="0" max="10" step="0.5" aria-label="${esc(label)} score">
            <div class="weights" role="radiogroup" aria-label="${esc(label)} weight">
              ${WEIGHTS.map((w) => `<button type="button" role="radio" data-weight="${w.value}">${w.label}</button>`).join("")}
            </div>
            <button type="button" class="rate-clear">Don't rate ${esc(label.toLowerCase())}</button>
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
        ${existing && auth.role === "owner" ? `<button type="button" class="btn btn-danger" data-delete>Delete</button>` : ""}
        <span></span>
        <button type="button" class="btn btn-ghost" data-cancel>Cancel</button>
        <button type="submit" class="btn btn-add">${existing ? "Save changes" : `Add ${esc(R.one)}`}</button>
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

  d.querySelectorAll(".segments").forEach((group) =>
    group.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-value]");
      if (!btn) return;
      const key = group.dataset.tag;
      draft.tags[key] = draft.tags[key] === btn.dataset.value ? undefined : btn.dataset.value;
      group.querySelectorAll("[data-value]").forEach((b) => b.setAttribute("aria-checked", b.dataset.value === draft.tags[key]));
    })
  );
  d.querySelectorAll("select[data-tag]").forEach((sel) => sel.addEventListener("change", () => (draft.tags[sel.dataset.tag] = sel.value || undefined)));

  function paintRate(fs) {
    const r = draft.ratings[fs.dataset.cat];
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
    const ok = await confirmDialog({ title: `Delete ${title(existing)}?`, text: "It comes off the rankings. Its edit history is kept.", yes: "Delete" });
    if (!ok) return;
    try {
      await api(`/api/${R.slug}/entries/${encodeURIComponent(existing.id)}`, { method: "DELETE" });
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
    if (form.inBag) draft.inBag = form.inBag.checked;
    const btn = form.querySelector("[type=submit]");
    btn.disabled = true;
    try {
      const { entry } = existing
        ? await api(`/api/${R.slug}/entries/${encodeURIComponent(existing.id)}`, { method: "PUT", body: draft })
        : await api(`/api/${R.slug}/entries`, { method: "POST", body: draft });
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
    state.tagFilters = {};
    $("#search").value = "";
    document.querySelectorAll("[data-tag-filter]").forEach((s) => (s.value = ""));
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
    localStorage.setItem(sortKey, state.sort);
  } catch {}
  renderGrid();
});

document.addEventListener("change", (e) => {
  const key = e.target.dataset?.tagFilter;
  if (!key) return;
  state.tagFilters[key] = e.target.value;
  renderGrid();
});

const tabs = [$("#tab-items"), $("#tab-board")];
function setView(view) {
  tabs.forEach((t) => t.setAttribute("aria-selected", t.id === `tab-${view}`));
  $("#items").hidden = view !== "items";
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
  const item = new URLSearchParams(location.search).get("item");
  if (item) showDetail(item, { push: false });
  else closeOpen();
});

onAuthChange(() => render());

renderShell();
await Promise.all([checkAuth(), load()]);
const startItem = new URLSearchParams(location.search).get("item");
if (startItem) showDetail(startItem, { push: false });
