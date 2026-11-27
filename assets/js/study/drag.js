// Pointer-based drag & drop (mouse + touch): assign lectures to days,
// reorder within a day, drop on the library to unassign.
import { S, byId, snapshot, savePlan } from "./store.js";
import { renderAll, toast } from "./views.js";
import { snd } from "./timer.js";
import { weekdayName, parseDate } from "../schedule/recurrence.js";

let drag = null;
const MO = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const md = (s) => { const d = parseDate(s); return MO[d.getUTCMonth()] + " " + d.getUTCDate(); };

export function bindDrag() {
  document.addEventListener("pointerdown", (e) => {
    const g = e.target.closest("[data-drag]"); if (!g) return;
    const id = g.dataset.drag; if (!byId(id)) return;
    drag = { id, x: e.clientX, y: e.clientY, active: false, ghost: null, zone: null, before: null };
    try { g.setPointerCapture(e.pointerId); } catch {}
  });
  document.addEventListener("pointermove", (e) => {
    if (!drag) return;
    if (!drag.active) {
      if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 7) return;
      drag.active = true; document.body.classList.add("dragging");
      const src = document.querySelector('.lec-card[data-id="' + drag.id + '"], .wcard[data-id="' + drag.id + '"]');
      const gh = document.createElement("div"); gh.className = "ghost";
      gh.innerHTML = src ? src.outerHTML : "";
      gh.querySelectorAll("[data-action],[data-drag]").forEach((n) => { n.removeAttribute("data-action"); n.removeAttribute("data-drag"); });
      document.body.appendChild(gh); drag.ghost = gh;
      if (S.ui.view !== "week") { S.ui.view = "week"; renderAll(); }
    }
    drag.ghost.style.left = (e.clientX - 120) + "px";
    drag.ghost.style.top = (e.clientY - 18) + "px";
    document.querySelectorAll(".droptarget").forEach((n) => n.classList.remove("droptarget"));
    document.querySelectorAll(".insert-line").forEach((n) => n.remove());
    const under = document.elementFromPoint(e.clientX, e.clientY);
    const zone = under && under.closest("[data-drop]");
    drag.zone = zone ? zone.dataset.drop : null; drag.before = null;
    if (!zone) return;
    zone.classList.add("droptarget");
    if (drag.zone !== "unassign") {
      const holder = zone.querySelector("[data-cards]");
      if (holder) {
        const cards = [...holder.querySelectorAll(".wcard")].filter((c) => c.dataset.id !== drag.id);
        let before = null;
        for (const c of cards) { const r = c.getBoundingClientRect(); if (e.clientY < r.top + r.height / 2) { before = c; break; } }
        drag.before = before ? before.dataset.id : null;
        const line = document.createElement("div"); line.className = "insert-line";
        if (before) holder.insertBefore(line, before); else holder.appendChild(line);
      }
    }
  });
  document.addEventListener("pointerup", () => end(true));
  document.addEventListener("pointercancel", () => end(false));
}
function end(commit) {
  if (!drag) return;
  const d = drag; drag = null;
  document.body.classList.remove("dragging");
  if (d.ghost) d.ghost.remove();
  document.querySelectorAll(".droptarget").forEach((n) => n.classList.remove("droptarget"));
  document.querySelectorAll(".insert-line").forEach((n) => n.remove());
  if (!d.active || !commit) return;
  const l = byId(d.id); if (!l) return;
  if (d.zone === "unassign") {
    if (l.day) { snapshot("unassign"); l.day = null; savePlan(); renderAll(); snd.drop(); toast("Unassigned: " + l.title, { undo: true }); }
    return;
  }
  if (d.zone) {
    snapshot("move lecture");
    const sib = S.plan.lectures.filter((x) => x.day === d.zone && x.id !== l.id).sort((a, b) => a.order - b.order);
    let idx = d.before ? sib.findIndex((x) => x.id === d.before) : sib.length;
    if (idx < 0) idx = sib.length;
    const prev = sib[idx - 1], next = sib[idx];
    l.order = prev && next ? (prev.order + next.order) / 2 : prev ? prev.order + 1 : next ? next.order - 1 : 1;
    const changed = l.day !== d.zone; l.day = d.zone;
    savePlan(); renderAll(); snd.drop();
    toast((changed ? "Moved to " : "Reordered · ") + weekdayName(parseDate(d.zone)) + " " + md(d.zone), { kind: "success", undo: true });
  }
}
