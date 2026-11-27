// Local study-plan state + the ONLY date arithmetic the study feature does.
// Blank start by design. Everything persists per cohort under cs-study-v2:.
// Extras (GTD inbox, manual minutes, review ritual, Leitner migration, demand)
// live in the SAME record so one save/load cycle owns the whole plan.
import { parseDate, formatDate, addDays, startOfWeek } from "../schedule/recurrence.js";

export const addD = (iso, n) => formatDate(addDays(parseDate(iso), n));
export const weekStartOf = (iso, weekStartDay) => startOfWeek(iso, weekStartDay);
export const wdIndex = (iso) => parseDate(iso).getUTCDay();
export const daysBetween = (a, b) => Math.round((parseDate(b) - parseDate(a)) / 86400000);
export const LECTURES_PER_SUBJECT = 12;

export const DEFAULT_SETTINGS = {
  focus: 25, short: 5, long: 15, cycle: 4,
  dayStart: "09:00", dayEnd: "21:00", autoStart: false, sound: true,
  mix: "interleave", energyPlan: true, icsRecalls: true
};

export const S = {
  manifest: null, inst: null, locations: null, institutionEvents: null,
  options: null, programsDoc: null,
  locale: "en", tz: "Africa/Cairo", today: null, weekStartDay: "Saturday",
  cohort: null, semester: null, datasets: null, index: null, courseList: [], schedule: null,
  cache: new Map(), anchor: null, plan: null,
  ui: { view: "matrix", q: "", subjects: [], status: "all", pri: "all", sort: "subject", minEst: 0, sel: new Set(), drawer: null },
  undo: []
};

export const uid = () => "l" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
export const iid = () => "i" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
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

export function blankLecture(courseId, num) {
  return { id: uid(), c: courseId, num, title: "", est: 0, pri: "should", status: "todo", day: null, order: num, actual: 0, notes: "", demand: "medium", sessions: [], completedAt: null, reviews: null };
}

export function addLecturesForCourse(courseId, count = LECTURES_PER_SUBJECT) {
  const existing = new Set(S.plan.lectures.filter((l) => l.c === courseId).map((l) => l.num));
  let added = 0;
  for (let n = 1; n <= count; n++) { if (existing.has(n)) continue; S.plan.lectures.push(blankLecture(courseId, n)); added++; }
  return added;
}

export function clearPlan() { snapshot("clear sheet"); S.plan.lectures = []; S.ui.sel = new Set(); savePlan(); }

function freshExtras() { return { inbox: [], manual: {}, review: { last: null, checks: {}, lapses: 0 } }; }

function migrateLectures(arr) {
  arr.forEach((l) => {
    if (l.demand == null) l.demand = "medium";
    if (Array.isArray(l.reviews)) l.reviews.forEach((r, i) => { if (r.box == null) r.box = Math.min(5, i + 1); });
  });
  return arr;
}

export function loadPlan(cohort, courses, today, weekStartDay) {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(planKey(cohort)) || "null"); } catch { saved = null; }
  const ex = freshExtras();
  if (saved && Array.isArray(saved.lectures)) {
    S.plan = {
      lectures: migrateLectures(saved.lectures),
      views: Array.isArray(saved.views) && saved.views.length ? saved.views : seedViews(),
      settings: Object.assign({}, DEFAULT_SETTINGS, saved.settings || {}),
      inbox: Array.isArray(saved.inbox) ? saved.inbox : ex.inbox,
      manual: saved.manual && typeof saved.manual === "object" ? saved.manual : ex.manual,
      review: Object.assign(ex.review, saved.review || {})
    };
    S.anchor = saved.anchor || addD(weekStartOf(today, weekStartDay), 7);
  } else {
    S.plan = { lectures: [], views: seedViews(), settings: Object.assign({}, DEFAULT_SETTINGS), ...ex };
    S.anchor = addD(weekStartOf(today, weekStartDay), 7);
  }
  S.ui.sel = new Set(); S.ui.drawer = null; S.undo = [];
  savePlan();
}

export function savePlan() {
  if (!S.cohort || !S.plan) return;
  try {
    localStorage.setItem(planKey(S.cohort), JSON.stringify({
      lectures: S.plan.lectures, views: S.plan.views, settings: S.plan.settings,
      anchor: S.anchor, inbox: S.plan.inbox, manual: S.plan.manual, review: S.plan.review
    }));
  } catch { /* private mode */ }
}

export function snapshot(label) { S.undo.push({ label, snap: deep(S.plan.lectures) }); if (S.undo.length > 25) S.undo.shift(); }
export function popUndo() {
  const u = S.undo.pop(); if (!u) return null;
  S.plan.lectures = u.snap;
  S.ui.sel = new Set([...S.ui.sel].filter((id) => byId(id)));
  savePlan(); return u.label;
}

/* ---------- GTD inbox ---------- */
export function openInboxItem({ text, imp = false, two = false, ctx = "", due = "" }) {
  if (!S.plan.inbox) S.plan.inbox = [];
  S.plan.inbox.unshift({ id: iid(), text: String(text).slice(0, 200), imp: !!imp, two: !!two, ctx, due, done: false, doneAt: null });
}
export function addManual(date, min) {
  if (!S.plan.manual) S.plan.manual = {};
  S.plan.manual[date] = Math.max(0, (S.plan.manual[date] || 0) + min);
}
export function toggleInbox(id) {
  const it = (S.plan.inbox || []).find((x) => x.id === id); if (!it) return;
  it.done = !it.done; it.doneAt = it.done ? new Date().toISOString() : null;
  if (it.two) addManual(S.today, it.done ? 2 : -2); // 2-minute rule feeds the ledger
}
export function deleteInbox(id) { S.plan.inbox = (S.plan.inbox || []).filter((x) => x.id !== id); }
export const openInboxCount = () => (S.plan.inbox || []).filter((x) => !x.done).length;

/* ---------- time ledger: real sessions (timer always writes one) + manual ---------- */
export function dayMinutes(date) {
  let m = S.plan.manual?.[date] || 0;
  for (const l of S.plan.lectures) for (const s of l.sessions || []) if (s.date === date) m += s.min;
  return m;
}
export function streakDays() {
  if (!S.plan) return 0;
  let n = 0, cur = S.today;
  if (dayMinutes(cur) <= 0) cur = addD(cur, -1);
  while (dayMinutes(cur) > 0) { n++; cur = addD(cur, -1); }
  return n;
}
const WDS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export function auditDays(n = 7) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) { const d = addD(S.today, -i); out.push({ iso: d, lbl: WDS[wdIndex(d)], min: dayMinutes(d), today: i === 0 }); }
  return out;
}
export function weekMinutes() { const ws = weekStartOf(S.today, S.weekStartDay); let m = 0; for (let i = 0; i < 7; i++) m += dayMinutes(addD(ws, i)); return m; }

/* ---------- anchoring: median timed estimate of a subject ---------- */
export function suggestEst(courseId) {
  const vals = S.plan.lectures.filter((l) => l.c === courseId && l.est > 0).map((l) => l.est).sort((a, b) => a - b);
  if (!vals.length) return null;
  return vals[Math.floor(vals.length / 2)];
}
