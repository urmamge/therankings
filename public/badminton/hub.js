// Badminton hub: each tile shows how many items its ranking has and what's on top, and the front
// court lists what's in my bag.
import { api, esc } from "/shared/rankings.js";

const fmt = (n) => (n >= 10 ? "10" : (Math.round(n * 10) / 10).toFixed(1));

document.querySelectorAll("[data-facts]").forEach(async (el) => {
  try {
    const { entries } = await api(`/api/badminton-${el.dataset.facts}/entries`);
    if (!entries.length) return;
    const top = [...entries].sort((a, b) => b.overall - a.overall)[0];
    el.innerHTML = `${entries.length} ranked. Top: <strong>${esc(top.brand)} ${esc(top.location)}, ${fmt(top.overall)}</strong>`;
  } catch {}
});

// Kit names, in the order they're listed in the bag.
const KIT = [["racquets", "Racquet"], ["strings", "String"], ["shuttles", "Shuttle"], ["shoes", "Shoes"], ["grips", "Grip"]];

(async () => {
  let items;
  try {
    ({ items } = await api("/api/badminton/bag"));
  } catch {
    return;
  }
  if (!items.length) return;
  const rows = KIT.flatMap(([key, label]) =>
    items.filter((e) => e.ranking === `badminton-${key}`).map((e) => `<li><a href="/badminton/${key}/?item=${encodeURIComponent(e.id)}">
      <span class="bag-kind">${label}</span>
      <span class="bag-name">${esc(e.brand)} ${esc(e.location)}</span>
      <span class="bag-score">${fmt(e.overall)}</span>
    </a></li>`)
  );
  document.getElementById("bag-list").innerHTML = rows.join("");
})();
