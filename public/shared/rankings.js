// Shared by every ranking page: API calls, login, signed-in devices and photo uploads.
// Each page styles the dialogs itself; the markup uses the rk- class names below.

export async function api(path, { method = "GET", body, raw, type } = {}) {
  const opts = { method, headers: {} };
  if (raw) {
    opts.body = raw;
    opts.headers["content-type"] = type;
  } else if (body !== undefined) {
    opts.body = JSON.stringify(body);
    opts.headers["content-type"] = "application/json";
  }
  let res;
  try {
    res = await fetch(path, opts);
  } catch {
    throw new Error("Couldn't reach the server. Check your connection and try again.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `The server said ${res.status}.`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export function formatDate(ms) {
  return new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

// ---------- signed-in state ----------

// role is "owner" (logged in with the permanent code) or "editor" (an approved person).
// pending is how many access requests are waiting, for the owner.
const listeners = new Set();
export const auth = { signedIn: false, role: null, email: null, pending: 0 };

export function onAuthChange(fn) {
  listeners.add(fn);
}

function setAuth(data) {
  Object.assign(auth, { signedIn: false, role: null, email: null, pending: 0 }, data);
  listeners.forEach((fn) => fn(auth));
}

export async function checkAuth() {
  try {
    setAuth(await api("/api/auth/me"));
  } catch {
    setAuth({});
  }
}

export async function logOut() {
  await api("/api/auth/logout", { method: "POST" });
  setAuth({});
}

// ---------- dialogs ----------

function dialog(className, html) {
  const d = document.createElement("dialog");
  d.className = `rk-dialog ${className}`;
  d.innerHTML = html;
  document.body.append(d);
  d.addEventListener("close", () => d.remove());
  // Clicking the dim backdrop closes it.
  d.addEventListener("click", (e) => {
    if (e.target === d) d.close();
  });
  d.showModal();
  return d;
}

// Resolves true once logged in, false if the dialog is closed first.
export function openLogin() {
  return new Promise((resolve) => {
    const d = dialog(
      "rk-login",
      `<form method="dialog" class="rk-panel">
        <button class="rk-close" value="cancel" aria-label="Close">×</button>
        <h2>Log in to edit</h2>
        <section class="rk-block">
          <h3>Got a code?</h3>
          <p>Enter the code from your email, or your permanent code.</p>
          <div class="rk-pair">
            <input class="rk-input rk-code" autocomplete="one-time-code" autocapitalize="characters" spellcheck="false" placeholder="ABCDE-FGHJK" aria-label="Your code">
            <button type="button" class="rk-btn rk-primary" data-code-login>Log in</button>
          </div>
          <label class="rk-check"><input type="checkbox" checked> Remember this device</label>
        </section>
        <section class="rk-block">
          <h3>Need a code?</h3>
          <p>Enter your email to ask for access. Once you've been verified you'll receive an email with your code. Codes don't expire, so it's fine if verifying takes a while.</p>
          <div class="rk-pair">
            <input class="rk-input rk-email" type="email" autocomplete="email" placeholder="you@example.com" aria-label="Your email">
            <button type="button" class="rk-btn" data-request>Request access</button>
          </div>
          <p class="rk-sent" role="status" hidden></p>
        </section>
        <p class="rk-error" role="alert" hidden></p>
      </form>`
    );
    const $ = (s) => d.querySelector(s);
    const error = $(".rk-error");
    let done = false;

    const run = async (btn, fn) => {
      error.hidden = true;
      btn.disabled = true;
      try {
        await fn();
      } catch (e) {
        error.textContent = e.message;
        error.hidden = false;
      } finally {
        btn.disabled = false;
      }
    };

    const logIn = () =>
      run($("[data-code-login]"), async () => {
        const res = await api("/api/auth/login", { method: "POST", body: { code: $(".rk-code").value, remember: $(".rk-check input").checked } });
        done = true;
        await checkAuth();
        d.close();
        return res;
      });
    $("[data-code-login]").addEventListener("click", logIn);
    $(".rk-code").addEventListener("keydown", (e) => e.key === "Enter" && (e.preventDefault(), logIn()));

    const request = () =>
      run($("[data-request]"), async () => {
        const res = await api("/api/auth/request", { method: "POST", body: { email: $(".rk-email").value } });
        $(".rk-sent").textContent = res.message;
        $(".rk-sent").hidden = false;
      });
    $("[data-request]").addEventListener("click", request);
    $(".rk-email").addEventListener("keydown", (e) => e.key === "Enter" && (e.preventDefault(), request()));

    d.addEventListener("close", () => resolve(done));
    $(".rk-code").focus();
  });
}

export function openDevices() {
  const d = dialog(
    "rk-devices",
    `<form method="dialog" class="rk-panel">
      <button class="rk-close" value="cancel" aria-label="Close">×</button>
      <h2>Logged-in devices</h2>
      <ul class="rk-list"><li>Loading…</li></ul>
      <p class="rk-error" role="alert" hidden></p>
      <button type="button" class="rk-btn" data-logout>Log out on this device</button>
    </form>`
  );
  const list = d.querySelector(".rk-list");
  const error = d.querySelector(".rk-error");
  const showError = (msg) => {
    error.textContent = msg;
    error.hidden = false;
  };
  const load = async () => {
    try {
      const { devices } = await api("/api/auth/devices");
      list.innerHTML = devices
        .map(
          (dev) => `<li>
            <div><strong>${esc(dev.label)}</strong>${dev.current ? ' <span class="rk-tag">This device</span>' : ""}
            <small>${dev.email ? esc(dev.email) : "Permanent code"}</small>
            <small>Logged in ${formatDate(dev.createdAt)}, last used ${formatDate(dev.lastSeen)}${dev.remember ? "" : ", this session only"}</small></div>
            ${dev.current ? "" : `<button type="button" class="rk-link" data-remove="${dev.id}">Log out</button>`}
          </li>`
        )
        .join("");
    } catch (e) {
      showError(e.message);
    }
  };
  list.addEventListener("click", async (e) => {
    const id = e.target.dataset?.remove;
    if (!id) return;
    e.target.disabled = true;
    await api(`/api/auth/devices/${id}`, { method: "DELETE" }).catch((err) => showError(err.message));
    load();
  });
  d.querySelector("[data-logout]").addEventListener("click", async () => {
    await logOut();
    d.close();
  });
  load();
}

// The owner's list of people who asked for access.
export function openRequests() {
  const d = dialog(
    "rk-requests",
    `<form method="dialog" class="rk-panel">
      <button class="rk-close" value="cancel" aria-label="Close">×</button>
      <h2>Access requests</h2>
      <p>Approving someone makes them a one-time code for you to email them. They can add and edit spots, but not delete them.</p>
      <div class="rk-send" hidden></div>
      <div class="rk-groups"><p>Loading…</p></div>
      <p class="rk-error" role="alert" hidden></p>
    </form>`
  );
  const groups = d.querySelector(".rk-groups");
  const error = d.querySelector(".rk-error");
  const send = d.querySelector(".rk-send");

  // The code is only shown once, so show it with the draft email ready to send.
  const showSend = ({ email, code, subject, body }) => {
    const gmail = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(email)}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    const mailto = `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    send.innerHTML = `<h3>Email ${esc(email)} their code</h3>
      <p class="rk-code-show">${esc(code)}</p>
      <p>This is the only time it's shown. If it gets lost, make a new code.</p>
      <div class="rk-actions">
        <a class="rk-btn rk-primary" href="${esc(gmail)}" target="_blank" rel="noopener">Open in Gmail</a>
        <button type="button" class="rk-btn" data-copy>Copy email</button>
        <a class="rk-btn" href="${esc(mailto)}">Other email app</a>
      </div>`;
    send.hidden = false;
    send.querySelector("[data-copy]").addEventListener("click", async (e) => {
      try {
        await navigator.clipboard.writeText(`Subject: ${subject}

${body}`);
        e.target.textContent = "Copied";
      } catch {
        e.target.textContent = "Couldn't copy";
      }
    });
    send.scrollIntoView({ block: "nearest" });
  };

  const row = (r, buttons) => `<li>
      <div><strong>${esc(r.email)}</strong>${r.wantsCode ? ' <span class="rk-tag">Wants a new code</span>' : ""}<small>Asked ${formatDate(r.createdAt)}${r.decidedAt ? `, ${{ approved: "approved", declined: "declined", revoked: "removed" }[r.status]} ${formatDate(r.decidedAt)}` : ""}</small></div>
      <div class="rk-actions">${buttons.map(([action, label, cls]) => `<button type="button" class="rk-btn ${cls || ""}" data-email="${esc(r.email)}" data-action="${action}">${label}</button>`).join("")}</div>
    </li>`;
  const group = (title, items, buttons, empty) => `<section class="rk-group"><h3>${title}</h3>
      ${items.length ? `<ul class="rk-list">${items.map((r) => row(r, buttons)).join("")}</ul>` : `<p class="rk-none">${empty}</p>`}</section>`;

  const load = async () => {
    try {
      const { requests } = await api("/api/auth/requests");
      const by = (...statuses) => requests.filter((r) => statuses.includes(r.status));
      groups.innerHTML =
        group("Waiting", by("pending"), [["approve", "Approve", "rk-primary"], ["decline", "Decline"]], "No one's waiting.") +
        group("Approved", by("approved"), [["approve", "Make new code"], ["remove", "Remove access", "rk-quiet"]], "No one yet.") +
        (by("declined", "revoked").length ? group("Declined or removed", by("declined", "revoked"), [["approve", "Approve"]], "") : "");
      auth.pending = by("pending").length + requests.filter((r) => r.wantsCode).length;
      listeners.forEach((fn) => fn(auth));
    } catch (e) {
      error.textContent = e.message;
      error.hidden = false;
    }
  };

  groups.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const { email, action } = btn.dataset;
    if (action === "remove" && !(await confirmDialog({ title: `Remove ${email}?`, text: "They'll be logged out everywhere and their unused codes stop working.", yes: "Remove access" }))) return;
    btn.disabled = true;
    error.hidden = true;
    try {
      const res = await api(`/api/auth/requests/${encodeURIComponent(email)}`, { method: "POST", body: { action } });
      if (res.code) showSend(res);
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
    }
    load();
  });
  load();
}

export function confirmDialog({ title, text, yes, no = "Cancel" }) {
  return new Promise((resolve) => {
    const d = dialog(
      "rk-confirm",
      `<form method="dialog" class="rk-panel">
        <h2>${esc(title)}</h2>
        <p>${esc(text)}</p>
        <div class="rk-row">
          <button class="rk-btn" value="no">${esc(no)}</button>
          <button class="rk-btn rk-danger" value="yes">${esc(yes)}</button>
        </div>
      </form>`
    );
    d.addEventListener("close", () => resolve(d.returnValue === "yes"));
  });
}

// ---------- photos ----------

// Shrinks the photo to at most 1600px on its long side and uploads it. Resolves to its key.
export async function uploadPhoto(file) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error(`${file.name} couldn't be opened. Use a JPEG or PNG photo.`);
  }
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.85));
  const { key } = await api("/api/photos", { method: "POST", raw: blob, type: "image/jpeg" });
  return key;
}

export const photoUrl = (key) => `/photos/${key}`;
