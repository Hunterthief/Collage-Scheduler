// Pure plan logic: filter/sort, energy-aware auto-plan into real free gaps,
// Leitner spaced repetition, Eisenhower/pareto/frog scoring, pacing, wrap-up,
// summary, and computed clock times for export. No DOM.
import { S, snapshot, savePlan, addD, daysBetween, openInboxCount } from "./store.js";
import { weekDates, capacityFor, busyFor, deadlineFor, courseTitle, winS, winE, nextExamFor } from "./data.js";

export const PRI = { must: 0, should: 1, could: 2 };
export const DEMAND_RANK = { deep: 0, medium: 1, light: 2 };
export const lecTitle = (l) => l.title || `Lecture ${l.num}`;
export const BOX_DAYS = [1, 3, 7, 14, 30];
export const MAX_BOX = BOX_DAYS.length;

export function matches(l) {
  const u = S.ui;
  if (u.q) { const q = u.q.toLowerCase(); if (!(lecTitle(l).toLowerCase().includes(q) || courseTitle(l.c).toLowerCase().includes(q) || ("lec " + l.num).includes(q))) return false; }
  if (u.subjects.length && !u.subjects.includes(l.c)) return false;
  if (u.status === "undone") { if (l.status === "done") return false; } else if (u.status !== "all" && l.status !== u.status) return false;
  if (u.pri !== "all" && l.pri !== u.pri) return false;
  if (u.minEst && l.est < u.minEst) return false;
  if (u.untimed && l.est > 0) return false;
  return true;
}

export function filtered() {
  const arr = S.plan.lectures.filter(matches);
  const order = (id) => S.courseList.findIndex((c) => c.id === id);
  const s = S.ui.sort;
  arr.sort((a, b) => {
    if (s === "priority") return PRI[a.pri] - PRI[b.pri] || deadlineFor(a.c).localeCompare(deadlineFor(b.c)) || a.est - b.est;
    if (s === "deadline") return deadlineFor(a.c).localeCompare(deadlineFor(b.c)) || PRI[a.pri] - PRI[b.pri];
    if (s === "estimate") return b.est - a.est;
    return order(a.c) - order(b.c) || a.num - b.num;
  });
  return arr;
}

export function examDaysFor(courseId) {
  const ex = nextExamFor(courseId);
  if (!ex?.date) return null;
  const d = daysBetween(S.today, ex.date);
  return d < 0 ? null : d;
}

/* ---------- Leitner ---------- */
export function markDone(l) { l.status = "done"; l.completedAt = S.today; l.reviews = [{ box: 1, due: addD(S.today, BOX_DAYS[0]), done: null }]; }
export function unDone(l) { l.status = "todo"; l.completedAt = null; l.reviews = null; }
export function currentStage(l) { if (!l.reviews) return null; const i = l.reviews.findIndex((r) => !r.done); return i === -1 ? null : { i, r: l.reviews[i] }; }
export function revPass(l) {
  const cur = currentStage(l); if (!cur) return { mastered: true, next: null };
  cur.r.done = S.today;
  if (cur.r.box >= MAX_BOX) return { mastered: true, next: null };
  const next = { box: cur.r.box + 1, due: addD(S.today, BOX_DAYS[cur.r.box]), done: null };
  l.reviews.push(next); return { mastered: false, next };
}
export function revAgain(l) { l.reviews = [{ box: 1, due: addD(S.today, 1), done: null }]; if (S.plan.review) S.plan.review.lapses = (S.plan.review.lapses || 0) + 1; }
export function reviewQueue() {
  const due = [], soon = [], mastered = [];
  for (const l of S.plan.lectures) {
    if (!l.reviews) continue;
    const cur = currentStage(l);
    if (!cur) { if (l.reviews[l.reviews.length - 1]?.box >= MAX_BOX) mastered.push(l); continue; }
    const item = { l, i: cur.i, due: cur.r.due, box: cur.r.box, over: cur.r.due < S.today };
    (cur.r.due <= S.today ? due : soon).push(item);
  }
  due.sort((a, b) => a.due.localeCompare(b.due) || a.box - b.box);
  soon.sort((a, b) => a.due.localeCompare(b.due));
  return { due, soon, mastered };
}

/* ---------- Eisenhower / pareto / frog ---------- */
export function urgencyOf(it) {
  if (it.kind === "inbox") return !!it.due && daysBetween(S.today, it.due) <= 2;
  const ed = examDaysFor(it.c);
  if (ed != null && ed <= 7) return true;
  if (it.day) { const dd = daysBetween(S.today, it.day); if (dd >= 0 && dd <= 2) return true; }
  return false;
}
export function importanceOf(it) { return it.kind === "inbox" ? !!it.imp : it.pri === "must" || it.pri === "should"; }
export function quadrantOf(it) { const u = urgencyOf(it), i = importanceOf(it); return u && i ? 1 : !u && i ? 2 : u && !i ? 3 : 4; }
export function leverageOf(it) {
  if (it.kind === "inbox") { const dd = it.due ? daysBetween(S.today, it.due) : null; return (dd != null ? 30 - Math.min(Math.max(dd, 0), 30) : 4) + (it.imp ? 26 : 4) + (it.two ? 6 : 0); }
  const ed = examDaysFor(it.c);
  return (ed != null ? 30 - Math.min(ed, 30) : 6) + (it.pri === "must" ? 30 : it.pri === "should" ? 14 : 4) + Math.min(it.est || 0, 180) / 30;
}
export function frogPick() {
  const cands = [];
  S.plan.lectures.filter((l) => l.status !== "done").forEach((l) => cands.push({ kind: "lecture", it: l }));
  (S.plan.inbox || []).filter((t) => !t.done).forEach((t) => cands.push({ kind: "inbox", it: t }));
  if (!cands.length) return null;
  cands.sort((a, b) => leverageOf(b.it) - leverageOf(a.it));
  return cands[0];
}
export function prioritizeLists() {
  const cand = [
    ...S.plan.lectures.filter((l) => l.status !== "done").map((l) => ({ kind: "lecture", it: l })),
    ...(S.plan.inbox || []).filter((t) => !t.done).map((t) => ({ kind: "inbox", it: t }))
  ];
  const quads = { 1: [], 2: [], 3: [], 4: [] };
  cand.forEach((c) => quads[quadrantOf(c.it)].push(c));
  Object.values(quads).forEach((q) => q.sort((a, b) => leverageOf(b.it) - leverageOf(a.it)));
  const starN = Math.max(quads[1].length ? 1 : 0, Math.ceil(quads[1].length * 0.2));
  return { quads, starN };
}

/* ---------- peak window ---------- */
export function peakEndMin() { const s = winS(), e = winE(); return Math.round((s + (e - s) * 0.4) / 15) * 15; }
export const isPeak = (startMin) => startMin != null && startMin < peakEndMin();

/* ---------- free-gap clock times ---------- */
export function freeGapsFor(date) {
  const items = busyFor(date).filter((i) => !i.allDay && i.e > i.s);
  const sorted = items.map((i) => ({ s: Math.max(0, i.s), e: Math.min(1440, i.e) })).filter((i) => i.e > i.s).sort((a, b) => a.s - b.s);
  const union = [];
  for (const t of sorted) { const last = union[union.length - 1]; if (last && t.s <= last.e) last.e = Math.max(last.e, t.e); else union.push({ ...t }); }
  const gaps = []; let cur = 0;
  for (const b of union) { if (b.s > cur) gaps.push({ s: cur, e: b.s }); cur = Math.max(cur, b.e); }
  if (cur < 1440) gaps.push({ s: cur, e: 1440 });
  const ws = winS(), we = winE();
  const tag = (g) => ({ ...g, zone: g.s >= ws && g.e <= we ? 0 : (g.s >= we ? 1 : 2) });
  return gaps.map(tag).sort((a, b) => a.zone - b.zone || a.s - b.s);
}
export function timingsFor(date) {
  const out = new Map();
  const gaps = freeGapsFor(date);
  const list = S.plan.lectures.filter((l) => l.day === date && l.status !== "done" && l.est > 0).sort((a, b) => a.order - b.order);
  let idx = 0, cursor = gaps[0] ? gaps[0].s : winS(), zone = gaps[0] ? gaps[0].zone : 0;
  for (const l of list) {
    let placed = false;
    while (idx < gaps.length) {
      const g = gaps[idx];
      if (g.zone !== zone) { zone = g.zone; cursor = g.s; }
      const start = Math.max(cursor, g.s);
      if (g.e - start >= l.est) { out.set(l.id, { s: start, e: start + l.est, overflow: g.zone !== 0 }); cursor = start + l.est; placed = true; break; }
      idx++; if (idx < gaps.length) { cursor = gaps[idx].s; zone = gaps[idx].zone; }
    }
    if (!placed) { out.set(l.id, { s: cursor, e: cursor + l.est, overflow: true }); cursor += l.est; }
  }
  return out;
}

function interleaveQueue(list) {
  const pool = [...list]; const out = []; let last = null;
  while (pool.length) { let idx = pool.findIndex((x) => x.c !== last); if (idx === -1) idx = 0; const it = pool.splice(idx, 1)[0]; out.push(it); last = it.c; }
  return out;
}

export function autoPlan() {
  const days = weekDates().filter((d) => d >= S.today);
  if (!days.length) return { placed: 0, left: 0, past: true };
  let queue = S.plan.lectures.filter((l) => !l.day && l.status !== "done" && l.est > 0)
    .sort((a, b) => PRI[a.pri] - PRI[b.pri] || deadlineFor(a.c).localeCompare(deadlineFor(b.c)) || b.est - a.est);
  if (S.plan.settings.mix === "interleave") queue = interleaveQueue(queue);
  const untimed = S.plan.lectures.filter((l) => !l.day && l.status !== "done" && !l.est).length;
  if (!queue.length) return { placed: 0, left: 0, empty: true, untimed };
  snapshot("auto-plan");
  const rem = {};
  for (const d of days) rem[d] = capacityFor(d).free - S.plan.lectures.filter((l) => l.day === d && l.status !== "done").reduce((s, l) => s + l.est, 0);
  let placed = 0; const touched = new Set();
  for (const l of queue) {
    const d = days.find((x) => rem[x] >= l.est);
    if (d) { l.day = d; rem[d] -= l.est; placed++; touched.add(d); }
  }
  // Energy-aware ordering: deep first within each touched day, so timingsFor
  // (which walks `order` against earliest-first gaps) drops deep work into the
  // morning peak and pushes light work to later/overflow gaps.
  const cmp = (a, b) =>
    (S.plan.settings.energyPlan ? DEMAND_RANK[a.demand || "medium"] - DEMAND_RANK[b.demand || "medium"] : 0) ||
    PRI[a.pri] - PRI[b.pri] || deadlineFor(a.c).localeCompare(deadlineFor(b.c)) || a.num - b.num;
  for (const d of touched) S.plan.lectures.filter((l) => l.day === d && l.status !== "done").sort(cmp).forEach((l, i) => { l.order = i + 1; });
  savePlan();
  return { placed, left: queue.length - placed, untimed };
}

export function clearWeek() {
  const days = weekDates();
  const n = S.plan.lectures.filter((l) => days.includes(l.day)).length;
  if (!n) return 0;
  snapshot("clear week");
  S.plan.lectures.forEach((l) => { if (days.includes(l.day)) l.day = null; });
  savePlan(); return n;
}

export function wrapDay() {
  const undone = S.plan.lectures.filter((l) => l.day === S.today && l.status !== "done");
  const recalls = reviewQueue().due.filter((x) => x.over || x.due === S.today).length;
  if (!undone.length) return { n: 0, recalls };
  snapshot("wrap day");
  undone.forEach((l) => { l.day = null; });
  return { n: undone.length, recalls };
}

export function paceFor(courseId) {
  const daysTo = examDaysFor(courseId);
  if (daysTo == null) return null;
  const lecs = S.plan.lectures.filter((l) => l.c === courseId);
  const total = lecs.length; if (!total) return null;
  const done = lecs.filter((l) => l.status === "done").length;
  const remaining = total - done;
  const start = S.semester?.validFrom;
  const elapsed = start ? Math.max(0, daysBetween(start, S.today)) : 0;
  const span = elapsed + daysTo;
  const expected = span > 0 ? (total * elapsed) / span : 0;
  const weeks = Math.max(1, Math.ceil(daysTo / 7));
  return { total, done, remaining, daysTo, perWeek: Math.ceil(remaining / weeks), behind: remaining > 0 && done < expected - 0.5 && daysTo <= 30, ratio: expected > 0 ? done / expected : (done > 0 ? 1 : 0) };
}

export function summaryText() {
  const lines = ["STUDY PLAN — " + (S.cohort ? [S.cohort.programId, S.cohort.academicYearId, "Y" + (S.cohort.yearLevel ?? "?"), "G" + (S.cohort.practicalGroup ?? "?") + (S.cohort.subdivision || "")].join(" · ") : ""), ""];
  for (const c of S.courseList) {
    const ls = S.plan.lectures.filter((l) => l.c === c.id); if (!ls.length) continue;
    const timed = ls.filter((l) => l.est > 0).length; const p = paceFor(c.id);
    lines.push(courseTitle(c.id) + " — " + ls.length + " lec · " + fmt(ls.reduce((s, l) => s + l.est, 0)) + " (" + ls.filter((l) => l.status === "done").length + " done, " + timed + " with a time" + (p ? ", exam in " + p.daysTo + "d" + (p.behind ? " · BEHIND PACE" : "") : "") + ")");
  }
  const inboxOpen = openInboxCount(); if (inboxOpen) lines.push("", "INBOX: " + inboxOpen + " captured items waiting to be clarified");
  lines.push("", "WEEK " + S.anchor + " → " + addD(S.anchor, 6) + ":");
  for (const d of weekDates()) {
    const ls = S.plan.lectures.filter((l) => l.day === d).sort((a, b) => a.order - b.order); const tm = timingsFor(d);
    lines.push(d + ": " + (ls.length ? ls.map((l) => { const t = tm.get(l.id); return courseTitle(l.c) + " " + l.num + (t ? " (" + hhmm(t.s) + "–" + hhmm(t.e) + ")" : " (no time yet)"); }).join(", ") : "—") + " · free " + fmt(capacityFor(d).free));
  }
  const untimed = S.plan.lectures.filter((l) => !l.est).length;
  lines.push("", "TOTAL: " + S.plan.lectures.length + " lectures · " + fmt(S.plan.lectures.reduce((s, l) => s + l.est, 0)) + " · " + S.plan.lectures.filter((l) => l.status === "done").length + " done · " + untimed + " still need a time");
  return lines.join("\n");
}
export function fmt(m) { const h = Math.floor(m / 60), r = m % 60; return h ? (r ? h + "h " + r + "m" : h + "h") : (r ? r + "m" : "0m"); }
export function hhmm(m) { return String(Math.floor(m / 60) % 24).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0"); }
