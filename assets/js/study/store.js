// Local study-plan state. Academic data is never stored here — only the
// student's own plan (estimates, progress, day assignments), per cohort.
import { startOfWeek, addDays } from "../schedule/recurrence.js";

export const DEFAULT_SETTINGS = {
  focus: 25, short: 5, long: 15, cycle: 4,
  dayStart: "09:00", dayEnd: "21:00", autoStart: false, sound: true
};

export const S = {
  manifest: null, inst: null, locations: null, institutionEvents: null,
  options: null, locale: "en", tz: "Africa/Cairo", today: null, weekStartDay: "Saturday",
  cohort: null, semester: null, datasets: null, index: null, courseList: [], schedule: null,
  cache: new Map(),
  anchor: null,
  plan: null,
  ui: { view: "matrix", q: "", subjects: [], status: "all", pri: "all", sort: "subject", minEst: 0, sel: new Set(), drawer: null },
  undo: []
};

export const uid = () => "l" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
export const deep = (o) => JSON.parse(JSON.stringify(o));
export const byId = (id) => S.plan.lectures.find((l) => l.id === id);
export const cohortKey = (c) => [c.programId, c.academicYearId, c.yearLevel ?? "", c.practicalGroup ?? "", c.subdivision ?? ""].join("|");
const planKey = (c) => "cs-study-v1:" + cohortKey(c);

export function seedViews() {
  return [
    { id: "v-all", name: "All lectures", f: { q: "", subjects: [], status: "all", pri: "all", sort: "subject", view: "matrix", minEst: 0 } },
    { id: "v-crunch", name: "🔥 Exam crunch", f: { q: "", subjects: [], status: "undone", pri: "must", sort: "deadline", view: "week", minEst: 0 } },
    { id: "v-heavy", name: "🏋 Heavy lifts", f: { q: "", subjects: [], status: "all", pri: "all", sort: "estimate", view: "matrix", minEst: 120 } }
  ];
}

// Starter plan generated from the fetched course catalogue — no academic
// content is invented; titles are neutral and everything is editable.
export function seedLectures(courses, today, weekStartDay) {
  const out = [];
  const nextWeek = addDays(startOfWeek(today, weekStartDay), 7);
  const pri = ["must", "should", "could"];
  let assign = 0;
  courses.forEach((c, i) => {
    const count = 3 + (i % 2);
    for (let n = 1; n <= count; n++) {
      const est = 80 + ((i * 2 + n) % 5) * 15;
      const l = {
        id: uid(), c: c.id, num: n, title: "Lecture " + n + " — listen + revise",
        est, pri: pri[(i + n) % 3], status: "todo", day: null, order: n,
        actual: 0, notes: "", sessions: [], completedAt: null, reviews: null
      };
      if (i === 0 && n === 1) {
        l.status = "done"; l.actual = est - 10; l.completedAt = addDays(today, -3);
        l.reviews = [1, 3, 7].map((o, k) => ({ due: addDays(l.completedAt, o), done: k === 0 ? addDays(l.completedAt, 1) : null }));
      } else if (i === 1 && n === 1) {
        l.status = "doing"; l.actual = 25;
      } else if (assign < 2 && l.status === "todo") {
        l.day = addDays(nextWeek, assign); l.order = 1; assign++;
      }
      out.push(l);
    }
  });
  return out;
}

export function loadPlan(cohort, courses, today, weekStartDay) {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(planKey(cohort)) || "null"); } catch { saved = null; }
  if (saved && Array.isArray(saved.lectures)) {
    S.plan = {
      lectures: saved.lectures,
      views: Array.isArray(saved.views) && saved.views.length ? saved.views : seedViews(),
      settings: Object.assign({}, DEFAULT_SETTINGS, saved.settings || {})
    };
    S.anchor = saved.anchor || addDays(startOfWeek(today, weekStartDay), 7);
  } else {
    S.plan = { lectures: seedLectures(courses, today, weekStartDay), views: seedViews(), settings: Object.assign({}, DEFAULT_SETTINGS) };
    S.anchor = addDays(startOfWeek(today, weekStartDay), 7);
    savePlan();
  }
  S.ui.sel = new Set();
  S.ui.drawer = null;
  S.undo = [];
}

export function savePlan() {
  if (!S.cohort || !S.plan) return;
  try {
    localStorage.setItem(planKey(S.cohort), JSON.stringify({
      lectures: S.plan.lectures, views: S.plan.views, settings: S.plan.settings, anchor: S.anchor
    }));
  } catch { /* private mode */ }
}

export function resetSample(courses, today, weekStartDay) {
  snapshot("reset sample");
  S.plan.lectures = seedLectures(courses, today, weekStartDay);
  S.plan.views = seedViews();
  S.ui.sel = new Set();
  savePlan();
}

export function snapshot(label) {
  S.undo.push({ label, snap: deep(S.plan.lectures) });
  if (S.undo.length > 25) S.undo.shift();
}
export function popUndo() {
  const u = S.undo.pop();
  if (!u) return null;
  S.plan.lectures = u.snap;
  S.ui.sel = new Set([...S.ui.sel].filter((id) => byId(id)));
  savePlan();
  return u.label;
}
