// Hand-off to the apps non-technical users already live in:
//  - .ics  -> Google Calendar (Import & export), Apple Calendar, Outlook
//  - .csv  -> Todoist / TickTick / any task app with CSV import
//  - one-click Google Calendar template link for a single lecture
//  - backup .json -> the WHOLE plan (lectures + views + settings + inbox +
//    manual minutes + review ritual + anchor), not just the sheet.
// Timed events reuse the repository's RFC-5545 writer (folding, UTC, alarms)
// and the free-gap clock times, so nothing lands on top of a real class.
import { S, byId, cohortKey, addD } from "./store.js";
import { courseTitle } from "./data.js";
import { timingsFor, lecTitle, fmt, hhmm, reviewQueue, currentStage } from "./planner.js";
import { eventsToIcs } from "../calendar/ics-generator.js";

const TZ = () => S.manifest?.timezone || "Africa/Cairo";
function download(name, text, mime) {
  const blob = new Blob([text], { type: mime + ";charset=utf-8" });
  const url = URL.createObjectURL(blob); const a = document.createElement("a");
  a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 400);
}
const label = (l) => `${courseTitle(l.c)} · Lec ${l.num}${l.title ? " — " + l.title : ""}`;

export function studyEvents() {
  const evs = [];
  for (const l of S.plan.lectures) {
    if (!l.day || l.status === "done") continue;
    const t = l.est > 0 ? timingsFor(l.day).get(l.id) : null;
    const base = { uid: `study:${cohortKey(S.cohort)}:${l.id}`, eventId: l.id, courseId: l.c, type: "lecture", title: { en: label(l) }, date: l.day, status: "published", location: null, sourceReview: [] };
    if (t) evs.push(Object.assign(base, { start: hhmm(t.s), end: hhmm(t.e), allDay: false, endDate: null, description: { en: `Study block · ${fmt(l.est)}${t.overflow ? " · outside your usual study window" : ""}${l.notes ? " · " + l.notes : ""}` } }));
    else evs.push(Object.assign(base, { start: null, end: null, allDay: true, endDate: l.day, description: { en: `Flexible study task — time not set yet.${l.notes ? " " + l.notes : ""}` } }));
  }
  return evs;
}

// Open Leitner recalls become quiet all-day calendar markers (no alarm, since
// the RFC-5545 writer skips alarms on all-day events). Gated by settings.
export function recallEvents() {
  if (!S.plan.settings?.icsRecalls) return [];
  const evs = [];
  for (const l of S.plan.lectures) {
    if (!l.reviews) continue;
    l.reviews.forEach((r, i) => {
      if (r.done) return;
      evs.push({
        uid: `study-recall:${cohortKey(S.cohort)}:${l.id}:${i}`, eventId: l.id + ":r" + i, courseId: l.c, type: "lecture",
        title: { en: `↻ Recall B${r.box} · ${courseTitle(l.c)} ${l.num}` }, date: r.due, endDate: r.due, allDay: true, start: null, end: null,
        status: "published", location: null, sourceReview: [],
        description: { en: `Spaced-repetition recall (box ${r.box}/5) for ${lecTitle(l)}.` }
      });
    });
  }
  return evs;
}

export function exportICS() {
  const evs = [...studyEvents(), ...recallEvents()];
  if (!evs.length) return 0;
  const ics = eventsToIcs(evs, { calendarName: { en: "Study Plan · " + (S.cohort ? S.cohort.programId : "") }, locale: "en", timezone: TZ(), institutionId: "study-plan", locations: { buildings: [] }, generatedAt: new Date(), alarms: true });
  download("study-plan.ics", ics, "text/calendar");
  return evs.length;
}

const csvCell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
export function exportCSV() {
  const rows = [["TYPE", "CONTENT", "DESCRIPTION", "PRIORITY", "INDENT", "AUTHOR", "RESPONSIBLE", "DATE", "DATE_LANG", "TIMEZONE"]];
  const pri = { must: 1, should: 2, could: 3 };
  for (const l of S.plan.lectures) rows.push(["task", label(l), `Subject: ${courseTitle(l.c)} · ${l.est ? fmt(l.est) : "time not set"} · ${l.status}${l.notes ? " · " + l.notes : ""}`, pri[l.pri] ?? 2, 1, "", "", l.day || "", "en", TZ()]);
  for (const t of (S.plan.inbox || [])) {
    if (t.done) continue;
    const desc = ["Inbox capture", t.ctx, t.imp ? "★ important" : null, t.two ? "2-minute rule" : null].filter(Boolean).join(" · ");
    rows.push(["task", "[Inbox] " + t.text, desc, t.imp ? 1 : 3, 1, "", "", t.due || "", "en", TZ()]);
  }
  if (rows.length === 1) return 0;
  download("study-plan.csv", rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n", "text/csv");
  return rows.length - 1;
}

const compact = (iso, min) => iso.replace(/-/g, "") + "T" + hhmm(min).replace(":", "") + "00";
export function gcalUrl(l) {
  if (!l || !l.day) return null;
  const t = l.est > 0 ? timingsFor(l.day).get(l.id) : null;
  const text = encodeURIComponent(label(l));
  const details = encodeURIComponent(`Study block · ${l.est ? fmt(l.est) : "time not set"}${l.notes ? "\n" + l.notes : ""}`);
  let dates;
  if (t) dates = compact(l.day, t.s) + "/" + compact(l.day, t.e);
  else dates = l.day.replace(/-/g, "") + "/" + addD(l.day, 1).replace(/-/g, "");
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${text}&dates=${dates}&ctz=${encodeURIComponent(TZ())}&details=${details}`;
}

export function exportBackup() {
  const payload = {
    app: "college-scheduler-study", version: 3, exportedAt: new Date().toISOString(),
    cohort: S.cohort, lectures: S.plan.lectures, views: S.plan.views, settings: S.plan.settings,
    anchor: S.anchor, inbox: S.plan.inbox || [], manual: S.plan.manual || {}, review: S.plan.review || { last: null, checks: {}, lapses: 0 }
  };
  download("study-plan-backup.json", JSON.stringify(payload, null, 2), "application/json");
  return S.plan.lectures.length;
}
