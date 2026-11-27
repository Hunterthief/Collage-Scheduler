// Pure plan logic: filtering, sorting, auto-planning into real free hours,
// spaced-repetition queue, text summary, and computed clock times for export.
import { S, snapshot, savePlan, addD } from "./store.js";
import { weekDates, capacityFor, busyFor, deadlineFor, courseTitle, winS, winE } from "./data.js";

export const PRI = { must: 0, should: 1, could: 2 };
export const lecTitle = (l) => l.title || `Lecture ${l.num}`;

export function matches(l) {
  const u = S.ui;
  if (u.q) {
    const q = u.q.toLowerCase();
    if (!(lecTitle(l).toLowerCase().includes(q) || courseTitle(l.c).toLowerCase().includes(q) || ("lec " + l.num).includes(q))) return false;
  }
  if (u.subjects.length && !u.subjects.includes(l.c)) return false;
  if (u.status === "undone") { if (l.status === "done") return false; }
  else if (u.status !== "all" && l.status !== u.status) return false;
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

export function markDone(l) {
  l.status = "done";
  l.completedAt = S.today;
  l.reviews = [1, 3, 7].map((o) => ({ due: addD(S.today, o), done: null }));
}
export function unDone(l) { l.status = "todo"; l.completedAt = null; l.reviews = null; }

// ---- Free-gap clock times -------------------------------------------------
// Complement of the cohort's real class busy-blocks over the whole day.
// Gaps inside the user's study window come first, then after it, then before.
export function freeGapsFor(date) {
  const items = busyFor(date).filter((i) => !i.allDay && i.e > i.s);
  const sorted = items.map((i) => ({ s: Math.max(0, i.s), e: Math.min(1440, i.e) }))
    .filter((i) => i.e > i.s).sort((a, b) => a.s - b.s);
  const union = [];
  for (const t of sorted) {
    const last = union[union.length - 1];
    if (last && t.s <= last.e) last.e = Math.max(last.e, t.e);
    else union.push({ ...t });
  }
  const gaps = [];
  let cur = 0;
  for (const b of union) {
    if (b.s > cur) gaps.push({ s: cur, e: b.s });
    cur = Math.max(cur, b.e);
  }
  if (cur < 1440) gaps.push({ s: cur, e: 1440 });
  const ws = winS(), we = winE();
  const tag = (g) => ({ ...g, zone: g.s >= ws && g.e <= we ? 0 : (g.s >= we ? 1 : 2) });
  return gaps.map(tag).sort((a, b) => a.zone - b.zone || a.s - b.s);
}

// Sequentially place each timed, undoned lecture of a day into free gaps so
// exported calendar events never sit on top of a real class.
export function timingsFor(date) {
  const out = new Map();
  const gaps = freeGapsFor(date);
  const list = S.plan.lectures
    .filter((l) => l.day === date && l.status !== "done" && l.est > 0)
    .sort((a, b) => a.order - b.order);
  let idx = 0, cursor = gaps[0] ? gaps[0].s : winS(), zone = gaps[0] ? gaps[0].zone : 0;
  for (const l of list) {
    let placed = false;
    while (idx < gaps.length) {
      const g = gaps[idx];
      if (g.zone !== zone) { zone = g.zone; cursor = g.s; }
      const start = Math.max(cursor, g.s);
      if (g.e - start >= l.est) {
        out.set(l.id, { s: start, e: start + l.est, overflow: g.zone !== 0 });
        cursor = start + l.est;
        placed = true;
        break;
      }
      idx++;
      if (idx < gaps.length) { cursor = gaps[idx].s; zone = gaps[idx].zone; }
    }
    if (!placed) {
      out.set(l.id, { s: cursor, e: cursor + l.est, overflow: true });
      cursor += l.est;
    }
  }
  return out;
}

export function autoPlan() {
  const days = weekDates().filter((d) => d >= S.today);
  if (!days.length) return { placed: 0, left: 0, past: true };
  const queue = S.plan.lectures.filter((l) => !l.day && l.status !== "done" && l.est > 0)
    .sort((a, b) => PRI[a.pri] - PRI[b.pri] || deadlineFor(a.c).localeCompare(deadlineFor(b.c)) || b.est - a.est);
  const untimed = S.plan.lectures.filter((l) => !l.day && l.status !== "done" && !l.est).length;
  if (!queue.length) return { placed: 0, left: 0, empty: true, untimed };
  snapshot("auto-plan");
  const rem = {};
  for (const d of days) {
    rem[d] = capacityFor(d).free - S.plan.lectures.filter((l) => l.day === d && l.status !== "done").reduce((s, l) => s + l.est, 0);
  }
  let placed = 0;
  for (const l of queue) {
    const d = days.find((x) => rem[x] >= l.est);
    if (d) {
      l.day = d;
      l.order = Math.max(0, ...S.plan.lectures.filter((x) => x.day === d).map((x) => x.order)) + 1;
      rem[d] -= l.est; placed++;
    }
  }
  savePlan();
  return { placed, left: queue.length - placed, untimed };
}

export function clearWeek() {
  const days = weekDates();
  const n = S.plan.lectures.filter((l) => days.includes(l.day)).length;
  if (!n) return 0;
  snapshot("clear week");
  S.plan.lectures.forEach((l) => { if (days.includes(l.day)) l.day = null; });
  savePlan();
  return n;
}

export function reviewQueue() {
  const due = [], soon = [], mastered = [];
  for (const l of S.plan.lectures) {
    if (!l.reviews) continue;
    let all = true;
    l.reviews.forEach((r, i) => {
      if (r.done) return;
      all = false;
      const item = { l, i, due: r.due, over: r.due < S.today };
      (r.due <= S.today ? due : soon).push(item);
    });
    if (all && l.reviews.length) mastered.push(l);
  }
  due.sort((a, b) => a.due.localeCompare(b.due));
  soon.sort((a, b) => a.due.localeCompare(b.due));
  return { due, soon, mastered };
}

export function summaryText() {
  const lines = ["STUDY PLAN — " + (S.cohort ? [S.cohort.programId, S.cohort.academicYearId, "Y" + (S.cohort.yearLevel ?? "?"), "G" + (S.cohort.practicalGroup ?? "?") + (S.cohort.subdivision || "")].join(" · ") : ""), ""];
  for (const c of S.courseList) {
    const ls = S.plan.lectures.filter((l) => l.c === c.id);
    if (!ls.length) continue;
    const timed = ls.filter((l) => l.est > 0).length;
    lines.push(courseTitle(c.id) + " — " + ls.length + " lec · " + fmt(ls.reduce((s, l) => s + l.est, 0)) + " (" + ls.filter((l) => l.status === "done").length + " done, " + timed + " with a time)");
  }
  lines.push("", "WEEK " + S.anchor + " → " + addD(S.anchor, 6) + ":");
  for (const d of weekDates()) {
    const ls = S.plan.lectures.filter((l) => l.day === d).sort((a, b) => a.order - b.order);
    const tm = timingsFor(d);
    lines.push(d + ": " + (ls.length ? ls.map((l) => {
      const t = tm.get(l.id);
      return courseTitle(l.c) + " " + l.num + (t ? " (" + hhmm(t.s) + "–" + hhmm(t.e) + ")" : " (no time yet)");
    }).join(", ") : "—") + " · free " + fmt(capacityFor(d).free));
  }
  const untimed = S.plan.lectures.filter((l) => !l.est).length;
  lines.push("", "TOTAL: " + S.plan.lectures.length + " lectures · " + fmt(S.plan.lectures.reduce((s, l) => s + l.est, 0)) + " · " + S.plan.lectures.filter((l) => l.status === "done").length + " done · " + untimed + " still need a time");
  return lines.join("\n");
}
export function fmt(m) { const h = Math.floor(m / 60), r = m % 60; return h ? (r ? h + "h " + r + "m" : h + "h") : (r ? r + "m" : "0m"); }
export function hhmm(m) { return String(Math.floor(m / 60) % 24).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0"); }
