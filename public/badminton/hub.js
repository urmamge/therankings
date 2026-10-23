// Badminton hub: each tile shows how many items its ranking has and what's on top.
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
