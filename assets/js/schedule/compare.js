import { composeSchedule } from "./engine.js";
import { occursOnDay, parseDate, formatDate, addDays, weekdayName, todayInTimeZone } from "./recurrence.js";
import { timeToMinutes } from "./sorting.js";
import { findProgram, findAcademicYear } from "../data/programs.js";

// A "cohort" is a resolved class group descriptor, not a student. Enumerated
// from the assignment manifests so it can never drift from the seat data.
export function cohortKey(c) {
  return [c.programId, c.academicYearId, c.yearLevel ?? "", c.practicalGroup ?? "", c.subdivision ?? ""].join("|");
}

export function cohortLabel(c, programLabel) {
  const lvl = c.yearLevel == null ? "" : ` · Yr ${c.yearLevel}`;
  const grp = c.practicalGroup == null ? "" : ` · G${c.practicalGroup}${c.subdivision ? c.subdivision : ""}`;
  return `${programLabel ?? c.programId}${lvl}${grp}`;
}

export async function enumerateCohorts(loader, manifest, programs) {
  const out = [];
  for (const entry of manifest.assignments ?? []) {
    const doc = await loader.loadJson(entry.path).catch(() => null);
    if (!doc) continue;
    const programId = entry.programId ?? doc.programId;
    const academicYearId = entry.academicYearId ?? doc.academicYearId;
    const rawLevel = entry.yearLevel ?? doc.yearLevel ?? null;
    const yearLevel = rawLevel == null || rawLevel === "" ? null : Number(rawLevel);
    const program = findProgram(programs, programId);
    const programLabel = program?.name?.en ?? programId;
    for (const rule of doc.rules ?? []) {
      const group = rule.practicalGroup;
      if (group == null) continue;
      out.push(mk(programId, academicYearId, yearLevel, group, null, programLabel));
      for (const sub of rule.subdivisions ?? []) {
        const name = String(sub.name ?? "").trim().toUpperCase();
        if (name) out.push(mk(programId, academicYearId, yearLevel, group, name, programLabel));
      }
    }
  }
  return out;
  function mk(programId, academicYearId, yearLevel, practicalGroup, subdivision, programLabel) {
    const c = { programId, academicYearId, yearLevel, practicalGroup, subdivision, programLabel };
    c.key = cohortKey(c);
    c.label = cohortLabel(c, programLabel);
    return c;
  }
}

function semesterFor(programs, cohort) {
  const program = findProgram(programs, cohort.programId);
  if (!program) return null;
  const year = findAcademicYear(program, cohort.academicYearId);
  if (!year) return null;
  const list = (year.semesters ?? []).filter(
    (s) => s.status !== "draft" &&
      (cohort.yearLevel == null || s.yearLevel == null || Number(s.yearLevel) === Number(cohort.yearLevel))
  );
  return list[0] ?? null;
}

// Compose one cohort's occurrences across the whole semester. Memoized by the
// caller; events carry absolute dates so a single compose answers ANY date.
export async function composeCohortEvents(loader, manifest, programs, institution, cohort, today, locale, cache) {
  const key = cohort.key ?? cohortKey(cohort);
  if (cache?.has(key)) return cache.get(key);
  const semester = semesterFor(programs, cohort);
  if (!semester) { const empty = { events: [], semester: null, loaded: false }; cache?.set(key, empty); return empty; }
  const datasets = await loader.loadSemesterDatasets(semester, manifest);
  const result = composeSchedule({
    institutionId: institution.settings.institutionId,
    timezone: manifest.timezone,
    settings: institution.settings,
    locations: institution.locations,
    semester,
    courses: datasets.courses,
    lectures: datasets.lectures,
    practicals: datasets.practicals,
    exams: datasets.exams,
    exceptions: datasets.exceptions,
    institutionEvents: institution.events,
    context: {
      programId: cohort.programId,
      academicYearId: cohort.academicYearId,
      yearLevel: cohort.yearLevel,
      practicalGroup: cohort.practicalGroup,
      subdivision: cohort.subdivision,
      semesterId: semester.id,
      today
    },
    locale
  });
  const packed = { events: result.events ?? [], semester, loaded: (result.events ?? []).length > 0, diagnostics: result.diagnostics };
  cache?.set(key, packed);
  return packed;
}

export function eventsOnDate(events, date) {
  return (events ?? []).filter((e) => occursOnDay(e, date));
}
export function timedEventsOnDate(events, date) {
  return eventsOnDate(events, date).filter((e) => !e.allDay && e.start && e.end);
}
export function allDayEventsOnDate(events, date) {
  return eventsOnDate(events, date).filter((e) => e.allDay);
}
export function overlaps(aStartMin, aEndMin, bStartMin, bEndMin) {
  return aStartMin < bEndMin && bStartMin < aEndMin;
}
export function busyEventsAt(events, date, startMin, endMin) {
  return timedEventsOnDate(events, date).filter((e) =>
    overlaps(timeToMinutes(e.start), Math.max(timeToMinutes(e.end), timeToMinutes(e.start) + 1), startMin, endMin)
  );
}

// status is 'free' | 'busy' | 'nodata'. 'nodata' means the cohort has NO
// published schedule at all — it must never be shown as Free.
export function slotRows(cohorts, composedByKey, date, startMin, endMin) {
  const rows = [];
  for (const c of cohorts) {
    const packed = composedByKey.get(c.key);
    const events = packed?.events ?? [];
    if (!packed || !packed.loaded || events.length === 0) {
      rows.push({ cohort: c, status: "nodata", free: false, blocking: [] });
      continue;
    }
    const blocking = busyEventsAt(events, date, startMin, endMin);
    rows.push({ cohort: c, status: blocking.length ? "busy" : "free", free: blocking.length === 0, blocking });
  }
  const rank = { free: 0, busy: 1, nodata: 2 };
  rows.sort((a, b) => (rank[a.status] - rank[b.status]) || a.cohort.label.localeCompare(b.cohort.label));
  return rows;
}

export function dayBounds(eventsByCohort, date) {
  let lo = Infinity, hi = -Infinity;
  for (const events of eventsByCohort.values()) {
    for (const e of timedEventsOnDate(events, date)) {
      lo = Math.min(lo, timeToMinutes(e.start));
      hi = Math.max(hi, Math.max(timeToMinutes(e.end), timeToMinutes(e.start) + 1));
    }
  }
  if (!Number.isFinite(lo)) { lo = 8 * 60; hi = 20 * 60; }
  lo = Math.max(0, Math.floor((lo - 30) / 30) * 30);
  hi = Math.min(24 * 60, Math.ceil((hi + 30) / 30) * 30);
  if (hi <= lo) { lo = 8 * 60; hi = 20 * 60; }
  return { lo, hi };
}

export function buildGridMarks(eventsByCohort, date, lo, hi) {
  const marks = new Set([lo, hi]);
  for (const events of eventsByCohort.values()) {
    for (const e of timedEventsOnDate(events, date)) {
      const s = timeToMinutes(e.start), en = Math.max(timeToMinutes(e.end), s + 1);
      if (s >= lo && s <= hi) marks.add(s);
      if (en >= lo && en <= hi) marks.add(en);
    }
  }
  return Array.from(marks).sort((a, b) => a - b);
}

export function sideMatrix(cohorts, eventsByCohort, date, referenceKey) {
  const { lo, hi } = dayBounds(eventsByCohort, date);
  const marks = buildGridMarks(eventsByCohort, date, lo, hi);
  const rows = [];
  for (let i = 0; i < marks.length - 1; i++) {
    const s = marks[i], e = marks[i + 1];
    if (e - s < 1) continue;
    const cells = cohorts.map((c) => {
      const packed = eventsByCohort.get(c.key);
      const evs = packed?.events ?? [];
      const loaded = packed?.loaded ?? false;
      const busy = busyEventsAt(evs, date, s, e);
      const refEvents = referenceKey ? busyEventsAt(eventsByCohort.get(referenceKey)?.events ?? [], date, s, e) : [];
      return {
        cohort: c,
        loaded,
        events: busy,
        free: loaded && busy.length === 0,
        nodata: !loaded,
        refFree: referenceKey ? refEvents.length === 0 : null
      };
    });
    rows.push({ start: s, end: e, cells, busyCount: cells.filter((x) => !x.free && !x.nodata).length });
  }
  return { lo, hi, rows };
}

export function commonFreeWindows(cohorts, eventsByCohort, date, lo, hi) {
  const span = hi - lo;
  if (span <= 0) return [];
  const busy = new Uint8Array(span);
  for (const c of cohorts) {
    const packed = eventsByCohort.get(c.key);
    if (!packed?.loaded) continue;
    for (const e of timedEventsOnDate(packed.events ?? [], date)) {
      const s = Math.max(0, timeToMinutes(e.start) - lo);
      const en = Math.min(span, Math.max(timeToMinutes(e.end), timeToMinutes(e.start) + 1) - lo);
      for (let m = s; m < en; m++) busy[m] = 1;
    }
  }
  const out = [];
  let runStart = -1;
  for (let m = 0; m <= span; m++) {
    const free = m < span && busy[m] === 0;
    if (free && runStart === -1) runStart = m;
    if (!free && runStart !== -1) {
      if (m - runStart >= 15) out.push({ start: lo + runStart, end: lo + m });
      runStart = -1;
    }
  }
  return out;
}

export function minutesToHHMM(min) {
  const h = Math.floor(min / 60), m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
export function nextOccurringWeekday(fromDate, weekday) {
  let cursor = fromDate;
  for (let i = 0; i < 7; i++) {
    if (weekdayName(cursor, "Africa/Cairo") === weekday) return cursor;
    cursor = formatDate(addDays(parseDate(cursor), 1));
  }
  return fromDate;
}
export { todayInTimeZone };
