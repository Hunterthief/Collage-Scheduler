// Academic context: everything is fetched through the existing manifest-driven
// loader and composed with the shared scheduling engine. Nothing hardcoded.
import { DataLoader } from "../data/loader.js";
import { CONFIG } from "../config.js";
import { buildLookupOptions } from "../data/options.js";
import { resolveStudentId } from "../student/resolver.js";
import { findProgram, findAcademicYear } from "../data/programs.js";
import { composeSchedule, selectActiveSemester } from "../schedule/engine.js";
import { todayInTimeZone, startOfWeek, occursOnDay } from "../schedule/recurrence.js";
import { timeToMinutes } from "../schedule/sorting.js";
import { buildEventIndex, eventLabel, eventColor } from "../schedule/labels.js";
import { S, cohortKey } from "./store.js";
import { addD } from "./dates.js";

export const loader = new DataLoader();
const FALLBACK_HUES = ["#1a73e8", "#0b8043", "#8e24aa", "#e37400", "#d93025", "#009688", "#795548", "#c2185b"];

function toArray(v) {
  if (Array.isArray(v)) return v;
  if (v && Array.isArray(v.events)) return v.events;
  if (v && Array.isArray(v.courses)) return v.courses;
  return [];
}

export async function boot() {
  S.manifest = await loader.loadManifest();
  const programs = await loader.loadPrograms(S.manifest);
  S.inst = await loader.loadInstitutionData(S.manifest);
  S.options = await buildLookupOptions(loader, S.manifest);
  S.programsDoc = programs;
  S.tz = S.manifest.timezone || "Africa/Cairo";
  S.today = todayInTimeZone(S.tz);
  S.weekStartDay = S.inst.settings.weekStartDay || "Saturday";
  S.locale = S.inst.settings.defaultLocale || CONFIG.ui.defaultLocale || "en";
}

export function defaultCohort() {
  const p = S.options.programs[0];
  if (!p) return null;
  const y = p.years[0];
  const lv = y?.levels[0];
  const g = lv?.groups[0];
  return {
    programId: p.id, academicYearId: y?.id ?? null, yearLevel: lv?.level ?? null,
    practicalGroup: g?.practicalGroup ?? null, subdivision: g?.subdivision ?? null
  };
}

export async function setCohort(c) {
  S.cohort = c;
  const key = cohortKey(c);
  if (S.cache.has(key)) {
    const hit = S.cache.get(key);
    S.semester = hit.semester; S.datasets = hit.datasets; S.index = hit.index;
    S.schedule = hit.schedule; S.courseList = hit.courseList;
    return;
  }
  const program = findProgram(S.programsDoc, c.programId);
  const year = program ? findAcademicYear(program, c.academicYearId) : null;
  const scoped = year ? {
    ...year,
    semesters: (year.semesters || []).filter((s) =>
      s.status !== "draft" && (c.yearLevel == null || s.yearLevel == null || Number(s.yearLevel) === Number(c.yearLevel)))
  } : null;
  const semester = scoped ? selectActiveSemester(scoped, S.today, S.tz) : null;
  let datasets = null, schedule = { events: [] }, index = null, courseList = [];
  if (semester) {
    datasets = await loader.loadSemesterDatasets(semester, S.manifest);
    index = buildEventIndex(datasets);
    courseList = toArray(datasets.courses);
    schedule = composeSchedule({
      institutionId: S.inst.settings.institutionId,
      timezone: S.tz, settings: S.inst.settings, locations: S.inst.locations, semester,
      courses: datasets.courses, lectures: datasets.lectures, practicals: datasets.practicals,
      exams: datasets.exams, exceptions: datasets.exceptions, institutionEvents: S.inst.events,
      context: {
        programId: c.programId, academicYearId: c.academicYearId, yearLevel: c.yearLevel,
        practicalGroup: c.practicalGroup, subdivision: c.subdivision, semesterId: semester.id, today: S.today
      },
      locale: S.locale
    });
  }
  S.semester = semester; S.datasets = datasets; S.index = index;
  S.schedule = schedule; S.courseList = courseList;
  S.cache.set(key, { semester, datasets, index, schedule, courseList });
}

export async function cohortFromId(raw) {
  const a = resolveStudentId(raw, S.options.assignmentDocs);
  return {
    programId: a.programId, academicYearId: a.academicYearId, yearLevel: a.yearLevel ?? null,
    practicalGroup: a.practicalGroup, subdivision: a.subdivision ?? null
  };
}

export const courseById = (id) => S.courseList.find((c) => c.id === id) || null;
export function courseColor(id) {
  const c = courseById(id);
  if (c && typeof c.color === "string" && /^#[0-9a-fA-F]{6}$/.test(c.color)) return c.color;
  const i = S.courseList.findIndex((x) => x.id === id);
  return FALLBACK_HUES[(i < 0 ? 0 : i) % FALLBACK_HUES.length];
}
export const courseTitle = (id) => {
  const c = courseById(id);
  return c ? (c.title?.[S.locale] || c.title?.en || c.id) : id;
};
export const tint = (hex, a) => hex + a;

export const weekDates = () => Array.from({ length: 7 }, (_, i) => addD(S.anchor, i));
export const weekStartOf = (d) => startOfWeek(d, S.weekStartDay);

export function hm(s) { const [h, m] = s.split(":").map(Number); return h * 60 + m; }
export const winS = () => hm(S.plan.settings.dayStart);
export const winE = () => hm(S.plan.settings.dayEnd);

export function busyFor(dateISO) {
  const items = [];
  for (const e of S.schedule?.events || []) {
    if (!occursOnDay(e, dateISO)) continue;
    if (e.allDay) { items.push({ allDay: true, label: eventLabel(e, S.index, S.locale), type: e.type }); continue; }
    if (e.status !== "published" || !e.start || !e.end) continue;
    items.push({
      s: timeToMinutes(e.start), e: Math.max(timeToMinutes(e.end), timeToMinutes(e.start) + 1),
      label: eventLabel(e, S.index, S.locale), color: eventColor(e, S.index) || courseColor(e.courseId),
      type: e.type
    });
  }
  return items;
}

export function capacityFor(dateISO) {
  const items = busyFor(dateISO);
  const ws = winS(), we = winE();
  const timed = items.filter((i) => !i.allDay)
    .map((i) => ({ s: Math.max(i.s, ws), e: Math.min(i.e, we) }))
    .filter((i) => i.e > i.s).sort((a, b) => a.s - b.s);
  let busy = 0, cs = null, ce = null;
  for (const t of timed) {
    if (cs === null) { cs = t.s; ce = t.e; }
    else if (t.s <= ce) ce = Math.max(ce, t.e);
    else { busy += ce - cs; cs = t.s; ce = t.e; }
  }
  if (cs !== null) busy += ce - cs;
  return { items, free: Math.max(0, (we - ws) - busy), busy, win: we - ws };
}

export function nextExamFor(courseId) {
  const list = (S.schedule?.events || [])
    .filter((e) => e.type === "examination" && e.courseId === courseId && e.date >= S.today)
    .sort((a, b) => a.date.localeCompare(b.date));
  return list[0] || null;
}
export function deadlineFor(courseId) {
  return nextExamFor(courseId)?.date || S.semester?.validUntil || S.today;
}
export function upcomingExams(n) {
  const seen = new Set(); const out = [];
  for (const e of (S.schedule?.events || []).filter((x) => x.type === "examination" && x.date >= S.today).sort((a, b) => a.date.localeCompare(b.date))) {
    const k = e.courseId + "|" + e.date;
    if (seen.has(k)) continue;
    seen.add(k); out.push(e);
    if (out.length >= n) break;
  }
  return out;
}
