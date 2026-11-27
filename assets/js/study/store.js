// Local study-plan state + the ONLY date arithmetic the study feature does.
// The sheet starts EMPTY by design: nothing is pre-filled, no times are
// guessed. Everything the user adds is persisted per cohort in localStorage,
// so closing the tab or reloading never loses their work.
import {
  parseDate,
  formatDate,
  addDays,
  startOfWeek
} from "../schedule/recurrence.js";

export const addD = (iso, n) => formatDate(addDays(parseDate(iso), n));
export const weekStartOf = (iso, weekStartDay) => startOfWeek(iso, weekStartDay);
export const wdIndex = (iso) => parseDate(iso).getUTCDay();
export const daysBetween = (a, b) =>
  Math.round((parseDate(b) - parseDate(a)) / 86400000);

export const LECTURES_PER_SUBJECT = 12;

export const DEFAULT_SETTINGS = {
  focus: 25, short: 5, long: 15, cycle: 4,
  dayStart: "09:00", dayEnd: "21:00", autoStart: false, sound: true
};

export const S = {
  manifest: null, inst: null, locations: null, institutionEvents: null,
  options: null, programsDoc: null,
  locale: "en", tz: "Africa/Cairo", today: null, weekStartDay: "Saturday",
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
const planKey = (c) => "cs-study-v2:" + cohortKey(c);

export function seedViews() {
  return [
    { id: "v-all", name: "All lectures", f: { q: "", subjects: [], status: "all", pri: "all", sort: "subject", view: "matrix", minEst: 0 } },
    { id: "v-crunch", name: "🔥 Exam crunch", f: { q: "", subjects: [], status: "undone", pri: "must", sort: "deadline", view: "week", minEst: 0 } },
    { id: "v-untimed", name: "⏳ Needs a time", f: { q: "", subjects: [], status: "undone", pri: "all", sort: "subject", view: "matrix", minEst: 0, untimed: true } }
  ];
}

// A blank lecture shell: no title, NO estimated time. The user names it and
// sets its length whenever they are ready.
export function blankLecture(courseId, num) {
  return {
    id: uid(), c: courseId, num, title: "", est: 0, pri: "should",
    status: "todo", day: null, order: num, actual: 0, notes: "",
    sessions: [], completedAt: null, reviews: null
  };
}

// User-initiated convenience: create the empty 1..12 slots for one subject.
// Skips numbers that already exist, never overwrites user work.
export function addLecturesForCourse(courseId, count = LECTURES_PER_SUBJECT) {
  const existing = new Set(S.plan.lectures.filter((l) => l.c === courseId).map((l) => l.num));
  let added = 0;
  for (let n = 1; n <= count; n++) {
    if (existing.has(n)) continue;
    S.plan.lectures.push(blankLecture(courseId, n));
    added++;
  }
  return added;
}

export function clearPlan() {
  snapshot("clear sheet");
  S.plan.lectures = [];
  S.ui.sel = new Set();
  savePlan();
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
    S.anchor = saved.anchor || addD(weekStartOf(today, weekStartDay), 7);
  } else {
    // BLANK start. No seeded records, no pre-allotted minutes.
    S.plan = { lectures: [], views: seedViews(), settings: Object.assign({}, DEFAULT_SETTINGS) };
    S.anchor = addD(weekStartOf(today, weekStartDay), 7);
  }
  S.ui.sel = new Set();
  S.ui.drawer = null;
  S.undo = [];
  savePlan();
}

export function savePlan() {
  if (!S.cohort || !S.plan) return;
  try {
    localStorage.setItem(planKey(S.cohort), JSON.stringify({
      lectures: S.plan.lectures, views: S.plan.views, settings: S.plan.settings, anchor: S.anchor
    }));
  } catch { /* private mode */ }
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
