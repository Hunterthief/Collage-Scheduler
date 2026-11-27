// Pure plan logic: filtering, sorting, auto-planning into real free hours,
// spaced-repetition queue and the text summary.
import { S, snapshot, savePlan } from "./store.js";
import { weekDates, capacityFor, deadlineFor, courseTitle } from "./data.js";
import { addD } from "./dates.js";

export const PRI = { must: 0, should: 1, could: 2 };

export function matches(l) {
  const u = S.ui;
  if (u.q) {
    const q = u.q.toLowerCase();
    if (!(l.title.toLowerCase().includes(q) || courseTitle(l.c).toLowerCase().includes(q) || ("lec " + l.num).includes(q))) return false;
  }
  if (u.subjects.length && !u.subjects.includes(l.c)) return false;
  if (u.status === "undone") { if (l.status === "done") return false; }
  else if (u.status !== "all" && l.status !== u.status) return false;
  if (u.pri !== "all" && l.pri !== u.pri) return false;
  if (u.minEst && l.est < u.minEst) return false;
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

export function autoPlan() {
  const days = weekDates().filter((d) => d >= S.today);
  if (!days.length) return { placed: 0, left: 0, past: true };
  const queue = S.plan.lectures.filter((l) => !l.day && l.status !== "done")
    .sort((a, b) => PRI[a.pri] - PRI[b.pri] || deadlineFor(a.c).localeCompare(deadlineFor(b.c)) || b.est - a.est);
  if (!queue.length) return { placed: 0, left: 0, empty: true };
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
  return { placed, left: queue.length - placed };
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
    lines.push(courseTitle(c.id) + " — " + ls.length + " lec · " + fmt(ls.reduce((s, l) => s + l.est, 0)) + " (" + ls.filter((l) => l.status === "done").length + " done)");
  }
  lines.push("", "WEEK " + S.anchor + " → " + addD(S.anchor, 6) + ":");
  for (const d of weekDates()) {
    const ls = S.plan.lectures.filter((l) => l.day === d).sort((a, b) => a.order - b.order);
    lines.push(d + ": " + (ls.length ? ls.map((l) => courseTitle(l.c) + " " + l.num + " (" + fmt(l.est) + ")").join(", ") : "—") + " · free " + fmt(capacityFor(d).free));
  }
  lines.push("", "TOTAL: " + S.plan.lectures.length + " lectures · " + fmt(S.plan.lectures.reduce((s, l) => s + l.est, 0)) + " · " + S.plan.lectures.filter((l) => l.status === "done").length + " done");
  return lines.join("\n");
}
function fmt(m) { const h = Math.floor(m / 60), r = m % 60; return h ? (r ? h + "h " + r + "m" : h + "h") : r + "m"; }
