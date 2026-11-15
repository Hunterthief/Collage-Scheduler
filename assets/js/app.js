import { CONFIG } from "./config.js";
import { DataLoader } from "./data/loader.js";
import { findProgram, findAcademicYear } from "./data/programs.js";
import { loadAssignmentDocuments } from "./student/assignments.js";
import { buildLookupOptions, yearLevelLabel } from "./data/options.js";
import {
  resolveStudentId,
  StudentNotFoundError,
  DataIntegrityError
} from "./student/resolver.js";
import { composeSchedule, selectActiveSemester, mergeOccurrences } from "./schedule/engine.js";
import {
  todayInTimeZone,
  startOfWeek,
  endOfWeek,
  parseDate,
  formatDate,
  addDays,
  occursOnDay,
  occursInRange,
  weekdayName
} from "./schedule/recurrence.js";
import { timeToMinutes, sortOccurrences } from "./schedule/sorting.js";
import {
  buildFeedUrl,
  buildElectiveFeedUrl,
  googleCalendarSubscribeUrl,
  googleCalendarAddByUrlUrl
} from "./calendar/calendar-links.js";
import {
  loadElectiveCatalog,
  eligibleElectives,
  mergeSelectedElectives,
  electiveColorMap
} from "./schedule/electives.js";
import {
  enumerateCohorts,
  composeCohortEvents,
  slotRows,
  sideMatrix,
  commonFreeWindows,
  busyEventsAt,
  timedEventsOnDate,
  allDayEventsOnDate,
  minutesToHHMM,
  nextOccurringWeekday
} from "./schedule/compare.js";
import { eventsToIcs, formatLocation } from "./calendar/ics-generator.js";
import {
  buildEventIndex,
  eventLabel,
  eventFullTitle,
  eventColor,
  eventShorthand
} from "./schedule/labels.js";
import { buildReminderPlan, ReminderScheduler } from "./schedule/reminders.js";
import { localize } from "./i18n.js";

const loader = new DataLoader();

const els = {
  modeButtons: document.querySelectorAll(".segment"),
  idForm: document.getElementById("id-form"),
  manualForm: document.getElementById("manual-form"),
  compareForm: document.getElementById("compare-form"),
  studentId: document.getElementById("student-id"),
  programSelect: document.getElementById("program-select"),
  yearSelect: document.getElementById("year-select"),
  levelSelect: document.getElementById("level-select"),
  groupSelect: document.getElementById("group-select"),
  status: document.getElementById("status"),
  result: document.getElementById("result"),
  periodHeading: document.getElementById("period-heading"),
  prevPeriod: document.getElementById("prev-period"),
  nextPeriod: document.getElementById("next-period"),
  todayBtn: document.getElementById("today-btn"),
  viewButtons: document.querySelectorAll(".view-btn"),
  assignmentSummary: document.getElementById("assignment-summary"),
  timetable: document.getElementById("timetable"),
  calendarLinks: document.getElementById("calendar-links"),
  siteTitle: document.getElementById("site-title"),
  privacyNotice: document.getElementById("privacy-notice")
};

const MONTHS_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const MONTHS_LONG = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const WEEKDAYS_SHORT = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const WEEKDAYS_LONG = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];

let currentState = null;
let lookupOptions = null;
let reminderScheduler = null;
let electiveCatalogCache = null;

// ---- Compare state (ephemeral; not persisted, holds no personal data) ------
const compareState = {
  mode: "slot",
  universe: null,          // enumerated cohorts
  universePromise: null,
  composedCache: new Map(),// cohortKey -> {events, semester}
  programs: null,
  institution: null,
  manifest: null,
  today: null,
  locale: "en",
  chips: [],               // cohort descriptors added for side-by-side
  referenceKey: null,      // starred cohort for swap checks
  slot: { scope: "all", gran: "group", date: null, start: "17:00", end: "18:00" },
  sideDate: null,
  picker: { programId: null, academicYearId: null, yearLevel: null, practicalGroup: null, subdivision: "" }
};

function electiveStorageKey(state) {
  const a = state.assignment;
  const id = a.studentId
    ? `id:${a.studentId}`
    : `sel:${a.programId}|${a.academicYearId}|${a.yearLevel}|${a.practicalGroup}|${a.subdivision ?? ""}`;
  return `college-schedule-electives:${id}`;
}
function loadSelection(state) {
  try { return JSON.parse(localStorage.getItem(electiveStorageKey(state)) ?? "[]"); }
  catch { return []; }
}
function saveSelection(state, slugs) {
  try { localStorage.setItem(electiveStorageKey(state), JSON.stringify(slugs)); } catch {}
}
init();

async function init() {
  bindEvents();
  setMode("id");
  try { els.studentId?.focus({ preventScroll: true }); } catch {}
  try { await ensureOptions(); }
  catch (err) { setStatus(`Could not load lookup options: ${err.message}`, "error"); }

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) reminderScheduler?.reschedule();
  });
}

function bindEvents() {
  els.modeButtons.forEach((btn) => btn.addEventListener("click", () => setMode(btn.dataset.mode)));
  els.idForm.addEventListener("submit", onIdSubmit);
  els.manualForm.addEventListener("submit", onManualSubmit);
  els.compareForm.addEventListener("submit", onCompareSubmit);
  els.programSelect.addEventListener("change", () => { populateYears(); });
  els.yearSelect.addEventListener("change", () => { populateLevels(); });
  els.levelSelect.addEventListener("change", () => { populateGroups(); });
  els.viewButtons.forEach((btn) => btn.addEventListener("click", () => {
    if (currentState) renderView(currentState, btn.dataset.view);
  }));
  els.prevPeriod.addEventListener("click", () => navigate(-1));
  els.nextPeriod.addEventListener("click", () => navigate(1));
  els.todayBtn.addEventListener("click", goToday);
  bindCompareEvents();
}

function setMode(mode) {
  els.modeButtons.forEach((btn) => {
    const active = btn.dataset.mode === mode;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-pressed", String(active));
  });
  els.idForm.hidden = mode !== "id";
  els.manualForm.hidden = mode !== "manual";
  els.compareForm.hidden = mode !== "compare";
  if (mode === "manual") {
    ensureOptions().catch((err) => setStatus(`Could not load year/group options: ${err.message}`, "error"));
  } else if (mode === "compare") {
    ensureCompare().catch((err) => setStatus(`Could not load comparison data: ${err.message}`, "error"));
  } else {
    els.studentId?.focus({ preventScroll: true });
  }
}

async function ensureOptions() {
  if (lookupOptions) return lookupOptions;
  const manifest = await loader.loadManifest();
  const [options, settings] = await Promise.all([
    buildLookupOptions(loader, manifest),
    loader.loadJson(manifest.paths.settings)
  ]);
  lookupOptions = { ...options, settings, manifest };
  applyBranding(settings);
  populatePrograms(options.programs);
  return lookupOptions;
}

function applyBranding(settings) {
  const locale = settings.defaultLocale ?? CONFIG.ui.defaultLocale ?? "en";
  const title = localize(settings.calendarName, locale) || "College Scheduler";
  const privacy = localize(settings.privacy?.notice, locale);
  if (els.siteTitle) els.siteTitle.textContent = title;
  document.title = title;
  if (privacy && els.privacyNotice) els.privacyNotice.textContent = privacy;
}

function populatePrograms(programs) {
  els.programSelect.innerHTML = "";
  if (!programs.length) {
    clearSelect(els.programSelect, "No programs available");
    clearSelect(els.yearSelect, "No academic years");
    clearSelect(els.levelSelect, "No years");
    clearSelect(els.groupSelect, "No groups available");
    return;
  }
  for (const program of programs) addOption(els.programSelect, program.id, program.name);
  els.programSelect.value = programs[0].id;
  populateYears();
}

function selectedProgram() {
  return lookupOptions?.programs.find((p) => p.id === els.programSelect.value) ?? null;
}

function selectedYear() {
  return selectedProgram()?.years.find((y) => y.id === els.yearSelect.value) ?? null;
}

function selectedLevel() {
  return selectedYear()?.levels.find((l) => String(l.level ?? "") === els.levelSelect.value) ?? null;
}

function populateYears() {
  const program = selectedProgram();
  clearSelect(els.yearSelect, program?.years?.length ? "Select academic year" : "No academic years");
  if (!program) return;
  for (const year of program.years) addOption(els.yearSelect, year.id, year.name);
  if (program.years.length === 1) els.yearSelect.value = program.years[0].id;
  populateLevels();
}

function populateLevels() {
  const year = selectedYear();
  clearSelect(els.levelSelect, year?.levels?.length ? "Select year" : "No years");
  if (!year) return;
  for (const level of year.levels) {
    addOption(els.levelSelect, String(level.level ?? ""), level.label);
  }
  if (year.levels.length === 1) els.levelSelect.value = String(year.levels[0].level ?? "");
  populateGroups();
}

function populateGroups() {
  const level = selectedLevel();
  clearSelect(els.groupSelect, level?.groups?.length ? "Select practical group" : "No groups available");
  if (!level) return;
  for (const group of level.groups) addOption(els.groupSelect, group.value, group.label);
  if (level.groups.length === 1) els.groupSelect.value = level.groups[0].value;
}

function clearSelect(select, placeholder) {
  select.innerHTML = "";
  const option = document.createElement("option");
  option.value = "";
  option.textContent = placeholder;
  option.disabled = true;
  option.selected = true;
  select.appendChild(option);
}

function addOption(select, value, label) {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = label;
  select.appendChild(option);
}

async function onIdSubmit(event) {
  event.preventDefault();
  setStatus("Searching…");
  try {
    const manifest = await loader.loadManifest();
    checkForUpdate(manifest.dataVersion);
    const assignmentDocs = await loadAssignmentDocuments(loader, manifest);
    const assignment = resolveStudentId(els.studentId.value, assignmentDocs);
    assignment.lookupMethod = "Student ID";
    assignment.displayId = maskStudentId(assignment.studentId);
    assignment.groupLabel = formatGroupLabel(assignment);
    await loadAndRenderSchedule(assignment, manifest);
  } catch (err) { renderError(err); }
}

async function onManualSubmit(event) {
  event.preventDefault();
  setStatus("Searching…");
  try {
    await ensureOptions();
    const programId = els.programSelect.value;
    const academicYearId = els.yearSelect.value;
    const levelValue = els.levelSelect.value;
    const groupValue = els.groupSelect.value;

    if (!programId || !academicYearId || levelValue === "" || !groupValue) {
      setStatus("Select a program, academic year, year, and practical group.", "error");
      return;
    }

    const level = selectedLevel();
    const groupOption = level?.groups.find((g) => g.value === groupValue);
    if (!groupOption) throw new Error("Selected group is no longer available. Reload the page.");

    const assignment = {
      studentId: null,
      displayId: null,
      programId,
      academicYearId,
      yearLevel: level?.level ?? null,
      practicalGroup: groupOption.practicalGroup,
      subdivision: groupOption.subdivision ?? null,
      subdivisionStatus: groupOption.subdivision ? "resolved" : "not-applicable",
      groupLabel: groupOption.label,
      source: "manual",
      lookupMethod: "Year & group",
      warnings: []
    };

    const manifest = await loader.loadManifest();
    checkForUpdate(manifest.dataVersion);
    await loadAndRenderSchedule(assignment, manifest);
  } catch (err) { renderError(err); }
}

function maskStudentId(id) {
  if (!id) return "";
  if (id.length <= 4) return id;
  return "•".repeat(id.length - 4) + id.slice(-4);
}

function formatGroupLabel(assignment) {
  if (assignment.practicalGroup == null) return "Unresolved";
  if (assignment.subdivision) return `${assignment.practicalGroup}${assignment.subdivision}`;
  return String(assignment.practicalGroup);
}

async function loadAndRenderSchedule(assignment, manifest) {
  const programs = await loader.loadPrograms(manifest);
  const program = findProgram(programs, assignment.programId);
  if (!program) throw new DataIntegrityError(`Unknown program: ${assignment.programId}`);
  const year = findAcademicYear(program, assignment.academicYearId);
  if (!year) throw new DataIntegrityError(`Unknown academic year: ${assignment.academicYearId}`);

  const scopedYear = {
    ...year,
    semesters: (year.semesters ?? []).filter(
      (s) => assignment.yearLevel == null || s.yearLevel == null || s.yearLevel === assignment.yearLevel
    )
  };

  const institution = await loader.loadInstitutionData(manifest);
  const locale = institution.settings.defaultLocale ?? CONFIG.ui.defaultLocale ?? "en";
  const today = todayInTimeZone(manifest.timezone);

  const semester = selectActiveSemester(scopedYear, today, manifest.timezone);
  if (!semester) {
    throw new Error(
      `No active or upcoming published semester is available for ${yearLevelLabel(assignment.yearLevel)} in this academic year.`
    );
  }

  const datasets = await loader.loadSemesterDatasets(semester, manifest);
  const labelIndex = buildEventIndex(datasets);

  const schedule = composeSchedule({
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
    context: { ...assignment, semesterId: semester.id, today },
    locale
  });

  // Electives: load catalog once, filter to eligibility, merge the student's
  // locally-recorded registrations into the event list before sorting/reminders.
  if (!electiveCatalogCache) {
    try { electiveCatalogCache = await loadElectiveCatalog(loader, manifest); }
    catch { electiveCatalogCache = []; }
  }
  const provisional = {
    manifest, institution, program, year, semester,
    assignment, schedule, today, locale,
    courses: Array.isArray(datasets.courses) ? datasets.courses : datasets.courses?.courses ?? [],
    labelIndex,
    electiveCatalog: electiveCatalogCache,
    anchorDate: today,
    view: "weekly"
  };
  const eligible = eligibleElectives(electiveCatalogCache, { programId: assignment.programId, yearLevel: assignment.yearLevel });
  const selected = loadSelection(provisional);
  const mergedEvents = mergeSelectedElectives(schedule.events, electiveCatalogCache, selected, {
    timezone: manifest.timezone,
    institutionId: institution.settings.institutionId,
    locale,
    context: { programId: assignment.programId, yearLevel: assignment.yearLevel }
  });
  // Reconcile + sort the combined list with a throwaway diagnostics bag so base
  // conflicts (already recorded by composeSchedule) are not pushed twice; only
  // genuinely-new messages (overlaps involving an elective) are folded in.
  const electiveDiag = { errors: [], warnings: [] };
  const sortedEvents = sortOccurrences(mergeOccurrences(mergedEvents, electiveDiag), locale);
  schedule.events = sortedEvents;
  foldNewDiagnostics(schedule.diagnostics, electiveDiag);

  const issues = [
    ...schedule.diagnostics.errors.map((message) => ({ level: "error", message })),
    ...schedule.diagnostics.warnings.map((message) => ({ level: "warning", message }))
  ];

  currentState = {
    ...provisional,
    issues,
    electiveCatalog: electiveCatalogCache,
    eligibleElectives: eligible,
    selectedElectives: selected,
    electiveColorById: electiveColorMap(electiveCatalogCache),
    reminderPlan: buildReminderPlan(sortedEvents)
  };

  renderAll(currentState);
  const hasErrors = issues.some((i) => i.level === "error");
  setStatus(hasErrors ? "Schedule loaded, but data issues were detected." : "Schedule loaded.",
    hasErrors ? "error" : "success");
}

function foldNewDiagnostics(target, incoming) {
  const seenErrors = new Set(target.errors ?? []);
  const seenWarnings = new Set(target.warnings ?? []);
  for (const m of incoming.errors ?? []) if (!seenErrors.has(m)) target.errors.push(m);
  for (const m of incoming.warnings ?? []) if (!seenWarnings.has(m)) target.warnings.push(m);
}

function checkForUpdate(dataVersion) {
  const key = "college-schedule-data-version";
  let previous = null;
  try { previous = localStorage.getItem(key); } catch { previous = null; }
  if (previous && previous !== dataVersion) {
    loader.cache?.clear();
    lookupOptions = null;
    compareState.universe = null;       // seat universe may have changed
    compareState.universePromise = null;
    compareState.composedCache = new Map();
    setStatus("Published data changed. Cached files were cleared. Reload if anything looks stale.", "info");
  }
  try { localStorage.setItem(key, dataVersion); } catch {}
}

function setStatus(message, kind = "info") {
  els.status.textContent = message;
  els.status.className = `status ${kind}`;
}

function renderAll(state) {
  els.result.hidden = false;
  renderAssignmentSummary(state);
  renderView(state, state.view);
  renderCalendar(state);
  // Reminder card is created BEFORE the electives card on purpose: the reminder
  // card anchors on the static .subscription-card (always present in index.html),
  // and the electives card then anchors on #reminder-card. Creating them in the
  // opposite order made the electives card look up a sibling that did not exist
  // yet and throw "anchor is null".
  renderReminderCard(state);
  renderElectivesCard(state);
}

function navigate(delta) {
  if (!currentState) return;
  const days = currentState.view === "weekly" ? 7 : currentState.view === "daily" ? 1 : CONFIG.ui.upcomingDays;
  currentState.anchorDate = formatDate(addDays(parseDate(currentState.anchorDate), delta * days));
  renderView(currentState, currentState.view);
}

function goToday() {
  if (!currentState) return;
  currentState.anchorDate = currentState.today;
  renderView(currentState, currentState.view);
}

function renderView(state, view) {
  state.view = view;
  els.viewButtons.forEach((btn) => btn.classList.toggle("active", btn.dataset.view === view));
  const range = getVisibleRange(state, view);
  els.periodHeading.textContent = formatPeriodHeading(view, range.start, range.end);
  if (view === "upcoming") renderUpcomingList(state, range.start, range.end);
  else renderGoogleStyleCalendar(state, range.days);
}

function getVisibleRange(state, view) {
  const weekStartDay = state.institution.settings.weekStartDay ?? "Saturday";
  if (view === "weekly") {
    const start = startOfWeek(state.anchorDate, weekStartDay);
    const end = endOfWeek(start);
    const days = [];
    let cursor = start;
    while (cursor <= end) { days.push(cursor); cursor = formatDate(addDays(parseDate(cursor), 1)); }
    return { start, end, days };
  }
  if (view === "daily") return { start: state.anchorDate, end: state.anchorDate, days: [state.anchorDate] };
  const start = state.anchorDate;
  const end = formatDate(addDays(parseDate(start), Math.max(0, CONFIG.ui.upcomingDays - 1)));
  return { start, end, days: [] };
}

function formatPeriodHeading(view, start, end) {
  if (view === "daily") return formatLongDate(start);
  if (view === "upcoming") return `Upcoming · ${formatShortDate(start)} – ${formatShortDate(end)}`;
  return formatRangeHeading(start, end);
}

function formatRangeHeading(start, end) {
  const s = parseDate(start);
  const e = parseDate(end);
  const sameYear = s.getUTCFullYear() === e.getUTCFullYear();
  const sameMonth = sameYear && s.getUTCMonth() === e.getUTCMonth();
  if (sameMonth) return `${MONTHS_LONG[s.getUTCMonth()]} ${s.getUTCDate()}–${e.getUTCDate()}, ${s.getUTCFullYear()}`;
  if (sameYear) return `${MONTHS_SHORT[s.getUTCMonth()]} ${s.getUTCDate()} – ${MONTHS_SHORT[e.getUTCMonth()]} ${e.getUTCDate()}, ${s.getUTCFullYear()}`;
  return `${MONTHS_SHORT[s.getUTCMonth()]} ${s.getUTCDate()}, ${s.getUTCFullYear()} – ${MONTHS_SHORT[e.getUTCMonth()]} ${e.getUTCDate()}, ${e.getUTCFullYear()}`;
}

function formatLongDate(dateStr) {
  const d = parseDate(dateStr);
  return `${WEEKDAYS_LONG[d.getUTCDay()]}, ${MONTHS_LONG[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

function formatShortDate(dateStr) {
  const d = parseDate(dateStr);
  return `${MONTHS_SHORT[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

function formatTime12(time) {
  if (!time) return "";
  const [h, m] = time.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, "0")} ${period}`;
}

function formatTimeRange(start, end) {
  if (!start && !end) return "All day";
  if (!end) return formatTime12(start);
  return `${formatTime12(start)} – ${formatTime12(end)}`;
}

function formatHourLabel(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const period = h >= 12 ? "PM" : "AM";
  const hour = h % 12 || 12;
  if (m === 0) return `${hour} ${period}`;
  return `${hour}:${String(m).padStart(2, "0")} ${period}`;
}

function formatEventTime(event) {
  if (event.allDay) {
    if (event.endDate && event.endDate !== event.date) return `${formatShortDate(event.date)} – ${formatShortDate(event.endDate)}`;
    return "All day";
  }
  return formatTimeRange(event.start, event.end);
}

function nowMinutesInTimeZone(timeZone) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date());
  const get = (type) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  let hour = get("hour");
  if (hour === 24) hour = 0;
  return hour * 60 + get("minute");
}

function evLabel(state, event) {
  return eventLabel(event, state.labelIndex, state.locale);
}

function evColor(state, event) {
  return eventColor(event, state.labelIndex) || state.electiveColorById?.[event.courseId] || event.color || null;
}

function colorStyle(color, kind) {
  if (!color) return "";
  if (kind === "block") {
    return `background:${color}1a;border-color:${color}59;border-left-color:${color};color:${color};`;
  }
  return `background:${color}1a;border-color:${color}59;color:${color};`;
}

function reminderLabel(minutes) {
  return minutes === 60 ? "1 hour before" : `${minutes} min before`;
}

function renderAssignmentSummary(state) {
  const a = state.assignment;
  const locale = state.locale;
  const pills = [];

  if (a.displayId) pills.push({ label: "ID", value: a.displayId });
  pills.push({ label: "Lookup", value: a.lookupMethod ?? "Student ID" });
  pills.push({ label: "Program", value: localize(state.program.name, locale) || state.program.id });
  pills.push({ label: "Academic year", value: localize(state.year.name, locale) || state.year.id });
  if (a.yearLevel != null) pills.push({ label: "Year", value: yearLevelLabel(a.yearLevel), className: "group" });
  pills.push({ label: "Semester", value: localize(state.semester.name, locale) || state.semester.id });
  pills.push({ label: "Group", value: a.groupLabel ?? formatGroupLabel(a), className: "group" });
  if (a.subdivision) pills.push({ label: "Subdivision", value: a.subdivision });

  let html = `<div class="summary-pills">`;
  for (const pill of pills) {
    html += `<span class="pill ${escapeHtml(pill.className ?? "")}"><span>${escapeHtml(pill.label)}</span> ${escapeHtml(String(pill.value))}</span>`;
  }
  html += `</div>`;

  const legend = (state.courses ?? []).filter((c) => c?.color);
  if (legend.length) {
    html += `<div class="summary-pills" style="margin-top:8px;">`;
    for (const course of legend) {
      html += `<span class="pill"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${escapeHtml(course.color)};margin-right:6px;"></span>${escapeHtml(localize(course.title, locale))}</span>`;
    }
    html += `</div>`;
  }

  const notes = [...(a.warnings ?? []), ...(state.issues ?? []).map((i) => i.message)].filter(Boolean);
  if (notes.length) {
    const visible = notes.slice(0, 4).join(" · ");
    const extra = notes.length > 4 ? " …" : "";
    html += `<div class="summary-notes"><strong>Data notes:</strong> ${escapeHtml(visible + extra)}</div>`;
  }

  els.assignmentSummary.innerHTML = html;
}

function renderGoogleStyleCalendar(state, days) {
  const today = state.today;
  const timezone = state.manifest.timezone;
  const hourHeight = 56;

  const visibleEvents = state.schedule.events.filter((event) => occursInRange(event, days[0], days[days.length - 1]));

  const allDayByDay = days.map((day) =>
    visibleEvents
      .filter((event) => event.allDay && occursOnDay(event, day))
      .sort((a, b) => evLabel(state, a).localeCompare(evLabel(state, b)))
  );

  const timedByDay = days.map((day) =>
    visibleEvents
      .filter((event) => !event.allDay && occursOnDay(event, day) && event.start && event.end)
      .map((event) => ({
        ...event,
        _start: timeToMinutes(event.start),
        _end: Math.max(timeToMinutes(event.end), timeToMinutes(event.start) + 15)
      }))
  );

  const allTimed = timedByDay.flat();
  let rangeStart = 7 * 60;
  let rangeEnd = 20 * 60;

  if (allTimed.length) {
    const minStart = Math.min(...allTimed.map((e) => e._start));
    const maxEnd = Math.max(...allTimed.map((e) => e._end));
    rangeStart = Math.max(0, Math.floor((minStart - 60) / 60) * 60);
    rangeEnd = Math.min(24 * 60, Math.ceil((maxEnd + 60) / 60) * 60);
    if (rangeEnd <= rangeStart) { rangeStart = 7 * 60; rangeEnd = 20 * 60; }
  }

  const laidOutDays = timedByDay.map(layoutTimedEvents);
  const nowMinutes = nowMinutesInTimeZone(timezone);
  const showNowLine = days.includes(today) && nowMinutes >= rangeStart && nowMinutes <= rangeEnd;
  const nowTop = ((nowMinutes - rangeStart) / 60) * hourHeight;

  let html = `<div class="gc-calendar" style="--day-count:${days.length}; --hour-height:${hourHeight}px; --range-start:${rangeStart}; --range-end:${rangeEnd};">`;

  html += `<div class="gc-row gc-header-row"><div class="gc-corner"></div><div class="gc-day-heads">`;
  for (const day of days) {
    const d = parseDate(day);
    const isToday = day === today;
    html += `<div class="gc-day-head ${isToday ? "today" : ""}"><span class="gc-weekday">${escapeHtml(WEEKDAYS_SHORT[d.getUTCDay()])}</span><span class="gc-daynum">${d.getUTCDate()}</span></div>`;
  }
  html += `</div></div>`;

  html += `<div class="gc-row gc-allday-row"><div class="gc-allday-label">All day</div><div class="gc-allday-cells">`;
  for (const dayEvents of allDayByDay) {
    html += `<div class="gc-allday-cell">`;
    for (const event of dayEvents) {
      const label = evLabel(state, event);
      const color = evColor(state, event);
      const type = event.type ?? "college-event";
      html += `<div class="gc-allday-chip type-${escapeHtml(type)}" style="${colorStyle(color, "chip")}" title="${escapeHtml(`${label} · All day`)}">${escapeHtml(label)}</div>`;
    }
    html += `</div>`;
  }
  html += `</div></div>`;

  html += `<div class="gc-row gc-body-row"><div class="gc-time-gutter">`;
  for (let m = rangeStart; m < rangeEnd; m += 60) {
    const top = ((m - rangeStart) / 60) * hourHeight;
    html += `<div class="gc-hour-label" style="top:${top}px;">${escapeHtml(formatHourLabel(m))}</div>`;
  }
  html += `</div><div class="gc-columns">`;

  for (let i = 0; i < days.length; i++) {
    const day = days[i];
    const isToday = day === today;
    html += `<div class="gc-day-column ${isToday ? "today" : ""}">`;

    for (const event of laidOutDays[i]) {
      const top = ((event._start - rangeStart) / 60) * hourHeight;
      const height = Math.max(22, ((event._end - event._start) / 60) * hourHeight - 2);
      const widthPercent = 100 / (event._total || 1);
      const leftPercent = (event._col || 0) * widthPercent;

      const label = evLabel(state, event);
      const full = eventFullTitle(event, state.locale);
      const time = formatTimeRange(event.start, event.end);
      const location = formatLocation(event.location, state.institution.locations.buildings, state.locale);
      const color = evColor(state, event);
      const mins = state.reminderPlan.get(event.uid);
      const tooltip = [label, full !== label ? full : null, time, location, mins ? `Reminder ${reminderLabel(mins)}` : null].filter(Boolean).join(" · ");

      html += `<div class="gc-event type-${escapeHtml(event.type)} status-${escapeHtml(event.status)}" style="top:${top}px; height:${height}px; left:calc(${leftPercent}% + 2px); width:calc(${widthPercent}% - 4px); ${colorStyle(color, "block")}" title="${escapeHtml(tooltip)}"><div class="gc-event-title">${escapeHtml(label)}</div><div class="gc-event-time">${escapeHtml(time)}${mins ? ` · 🔔 ${mins === 60 ? "1h" : "15m"}` : ""}</div></div>`;
    }

    html += `</div>`;
  }

  if (showNowLine) html += `<div class="gc-now-line" style="top:${nowTop}px;"></div>`;

  html += `</div></div></div>`;
  els.timetable.innerHTML = html;
}

function layoutTimedEvents(events) {
  const items = [...events].sort((a, b) => {
    const startDiff = a._start - b._start;
    if (startDiff !== 0) return startDiff;
    const durationDiff = (b._end - b._start) - (a._end - a._start);
    if (durationDiff !== 0) return durationDiff;
    return String(a.eventId).localeCompare(String(b.eventId));
  });

  const clusters = [];
  let currentCluster = [];
  let clusterEnd = -1;

  for (const item of items) {
    if (currentCluster.length && item._start >= clusterEnd) {
      clusters.push(currentCluster);
      currentCluster = [];
      clusterEnd = -1;
    }
    currentCluster.push(item);
    clusterEnd = Math.max(clusterEnd, item._end);
  }
  if (currentCluster.length) clusters.push(currentCluster);

  for (const cluster of clusters) {
    const columnEnds = [];
    for (const item of cluster) {
      let placed = false;
      for (let i = 0; i < columnEnds.length; i++) {
        if (columnEnds[i] <= item._start) {
          item._col = i;
          columnEnds[i] = item._end;
          placed = true;
          break;
        }
      }
      if (!placed) {
        item._col = columnEnds.length;
        columnEnds.push(item._end);
      }
    }
    const total = columnEnds.length || 1;
    for (const item of cluster) item._total = total;
  }

  return items;
}

function renderUpcomingList(state, start, end) {
  const events = state.schedule.events
    .filter((event) => occursInRange(event, start, end))
    .sort((a, b) => {
      const dateCmp = a.date.localeCompare(b.date);
      if (dateCmp !== 0) return dateCmp;
      if (!!a.allDay !== !!b.allDay) return a.allDay ? -1 : 1;
      const startCmp = timeToMinutes(a.start) - timeToMinutes(b.start);
      if (startCmp !== 0) return startCmp;
      return evLabel(state, a).localeCompare(evLabel(state, b));
    });

  if (!events.length) {
    els.timetable.innerHTML = `<div class="empty-state">Nothing scheduled in this range.</div>`;
    return;
  }

  const grouped = new Map();
  for (const event of events) {
    if (event.allDay && event.endDate && event.endDate !== event.date) {
      let cursor = event.date > start ? event.date : start;
      const stop = event.endDate < end ? event.endDate : end;
      while (cursor <= stop) {
        if (!grouped.has(cursor)) grouped.set(cursor, []);
        grouped.get(cursor).push({ ...event, displayDate: cursor, displayWhen: "All day" });
        cursor = formatDate(addDays(parseDate(cursor), 1));
      }
      continue;
    }
    const day = event.date;
    if (!grouped.has(day)) grouped.set(day, []);
    grouped.get(day).push({ ...event, displayDate: day, displayWhen: formatEventTime(event) });
  }

  const buildings = state.institution.locations.buildings;
  const sortedDays = Array.from(grouped.entries()).sort((a, b) => a[0].localeCompare(b[0]));

  let html = `<div class="agenda">`;
  for (const [date, dayEvents] of sortedDays) {
    html += `<section class="agenda-day"><div class="agenda-day-header"><h3>${escapeHtml(formatLongDate(date))}</h3><span class="agenda-count">${dayEvents.length} event${dayEvents.length === 1 ? "" : "s"}</span></div>`;

    for (const event of dayEvents) {
      const label = evLabel(state, event);
      const full = eventFullTitle(event, state.locale);
      const location = formatLocation(event.location, buildings, state.locale);
      const color = evColor(state, event);
      const type = event.type ?? "event";
      const mins = state.reminderPlan.get(event.uid);

      const tags = [];
      tags.push(`<span class="tag ${escapeHtml(type)}" style="${colorStyle(color, "tag")}">${escapeHtml(type.replace(/-/g, " "))}</span>`);
      if (mins) tags.push(`<span class="tag" style="background:var(--accent-soft);border-color:var(--accent);color:var(--accent);">🔔 ${escapeHtml(reminderLabel(mins))}</span>`);
      if (event.status === "cancelled") tags.push(`<span class="tag cancelled">Cancelled</span>`);
      if ((event.sourceReview ?? []).length) tags.push(`<span class="tag unverified">Needs review</span>`);

      html += `<article class="agenda-event"><div class="agenda-time">${escapeHtml(event.displayWhen ?? formatEventTime(event))}</div><div class="agenda-main"><div class="agenda-title">${escapeHtml(label)}</div><div class="agenda-meta">${full !== label ? `<span>${escapeHtml(full)}</span>` : ""}${location ? `<span>${escapeHtml(location)}</span>` : ""}${event.courseId ? `<span>${escapeHtml(event.courseId)}</span>` : ""}</div></div><div class="agenda-tags">${tags.join(" ")}</div></article>`;
    }

    html += `</section>`;
  }
  html += `</div>`;
  els.timetable.innerHTML = html;
}

async function copyToClipboard(text) {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; }
  } catch {}
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch { return false; }
}

function showToast(message) {
  let stack = document.getElementById("toast-stack");
  if (!stack) {
    stack = document.createElement("div");
    stack.id = "toast-stack";
    stack.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:9999;display:flex;flex-direction:column;gap:8px;max-width:min(360px,calc(100vw - 32px));";
    document.body.appendChild(stack);
  }
  const toast = document.createElement("div");
  toast.style.cssText = "background:var(--surface);color:var(--text);border:1px solid var(--line);border-left:4px solid var(--accent);border-radius:8px;box-shadow:var(--shadow);padding:10px 12px;font-size:0.85rem;line-height:1.4;";
  toast.textContent = message;
  stack.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transition = "opacity 0.4s";
    setTimeout(() => toast.remove(), 450);
  }, 9000);
}

function ensureScheduler(state) {
  if (reminderScheduler) return reminderScheduler;
  reminderScheduler = new ReminderScheduler({
    timeZone: state.manifest.timezone,
    onToast: showToast,
    onStateChange: () => { if (currentState) updateReminderStatus(currentState); }
  });
  return reminderScheduler;
}

function updateReminderStatus(state) {
  const el = document.getElementById("reminder-status");
  const toggle = document.getElementById("reminders-toggle");
  if (!el || !reminderScheduler) return;
  if (toggle) toggle.checked = reminderScheduler.enabled;

  const perm = reminderScheduler.permission;
  const permText =
    perm === "granted" ? "Browser notifications are allowed." :
    perm === "denied" ? "Browser notifications are blocked — reminders appear as in-page popups only." :
    perm === "unsupported" ? "This browser does not support notifications — reminders appear as in-page popups only." :
    "Enable reminders to allow browser notifications.";

  el.textContent = reminderScheduler.enabled
    ? `Reminders are on. ${permText} They fire while this page is open.`
    : `Reminders are off. ${permText}`;
}

function renderReminderCard(state) {
  const scheduler = ensureScheduler(state);
  scheduler.setEvents(state.schedule.events, {
    labelFor: (e) => evLabel(state, e),
    timeFor: (e) => formatEventTime(e),
    locationFor: (e) => formatLocation(e.location, state.institution.locations.buildings, state.locale)
  });

  let card = document.getElementById("reminder-card");
  if (!card) {
    // Anchor on the STATIC subscription card (hard-coded in index.html), which is
    // always present, so this can never throw on a null anchor.
    const anchor = document.querySelector(".subscription-card") ?? els.calendarLinks?.closest("section") ?? null;
    card = document.createElement("section");
    card.id = "reminder-card";
    card.className = "subscription-card";
    card.setAttribute("aria-labelledby", "reminder-heading");
    if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(card, anchor);
    else (els.result ?? document.body).appendChild(card);
  }

  card.innerHTML = `
    <h2 id="reminder-heading">Reminders</h2>
    <p class="hint">
      First event of each day: reminder <strong>1 hour before</strong>.
      Every later event that day: reminder <strong>15 minutes before</strong>.
      All-day events get no reminder. The same rule is written into the .ics feeds
      (Apple Calendar, Outlook and Thunderbird honor it). Google ignores alarms on
      subscribed calendars, so keep this page open with reminders on for the exact rule.
    </p>
    <div class="feed-actions" style="align-items:center;">
      <label style="display:inline-flex;align-items:center;gap:8px;cursor:pointer;margin:0;">
        <input type="checkbox" id="reminders-toggle" style="width:18px;height:18px;accent-color:var(--accent);" />
        Enable reminders while this page is open
      </label>
      <button class="btn quiet" type="button" id="reminder-test">Send test reminder</button>
    </div>
    <p class="hint" id="reminder-status" style="margin-top:8px;"></p>
  `;

  document.getElementById("reminders-toggle").addEventListener("change", async (e) => {
    if (e.target.checked) await scheduler.enable();
    else scheduler.disable();
    updateReminderStatus(state);
  });

  document.getElementById("reminder-test").addEventListener("click", () => scheduler.test());
  updateReminderStatus(state);
}

function renderCalendar(state) {
  const feedUrl = buildFeedUrl(state.assignment, state.manifest);

  if (!feedUrl) {
    els.calendarLinks.innerHTML = `<div class="summary-notes">Calendar subscription is unavailable because your practical group could not be resolved.</div>`;
    return;
  }

  const oneClickUrl = googleCalendarSubscribeUrl(feedUrl);
  const addByUrlPage = googleCalendarAddByUrlUrl();
  const subNote = state.assignment.subdivision
    ? `This feed contains only subgroup ${state.assignment.groupLabel} sessions (alternating weeks and batch times included).`
    : `This feed contains the whole group ${state.assignment.practicalGroup} schedule.`;

  els.calendarLinks.innerHTML = `
    <ol class="steps">
      <li>Click <strong>Subscribe in Google Calendar</strong> and confirm the prompt.</li>
      <li>No prompt? Use <strong>Add manually</strong> — the feed URL is copied for you.</li>
      <li>Paste it into the <strong>URL of calendar</strong> box, then click <strong>Add calendar</strong>.</li>
    </ol>
    <div class="feed-box">
      <div><span class="feed-label">Stable feed URL</span><code>${escapeHtml(feedUrl)}</code></div>
      <div class="feed-actions">
        <a class="btn primary" id="one-click-subscribe" href="${escapeHtml(oneClickUrl)}" target="_blank" rel="noopener noreferrer">Subscribe in Google Calendar</a>
        <a class="btn quiet" id="open-gcal" href="${escapeHtml(addByUrlPage)}" target="_blank" rel="noopener noreferrer">Add manually (backup)</a>
        <button class="btn quiet" type="button" id="copy-feed">Copy feed URL</button>
        <button class="btn quiet" type="button" id="download-ics">Download .ics preview</button>
      </div>
      <p class="hint" id="copy-hint">${escapeHtml(subNote)} The subscription stays live and updates itself.</p>
      <p class="hint">If Google says the calendar already exists, remove the old entry from your calendar list first.</p>
    </div>
    <p class="hint">Subject colors appear on this website. Google assigns one color per subscribed calendar, so in Google the subject is identified by its shorthand name (e.g. PN 7 Basic Pharmacology). Reminders in the feed follow the 1h / 15m rule; Google subscription ignores them, so use the Reminders panel above for Google-equivalent alerts.</p>
  `;

  const hint = document.getElementById("copy-hint");

  document.getElementById("one-click-subscribe").addEventListener("click", () => {
    if (hint) {
      hint.textContent = "Google should ask you to confirm the subscription. If no prompt appears, use Add manually (backup) — it copies the feed URL for you.";
    }
  });

  document.getElementById("open-gcal").addEventListener("click", () => {
    copyToClipboard(feedUrl).then((ok) => {
      if (hint) {
        hint.textContent = ok
          ? "Feed URL copied. Paste it into the URL of calendar box, then click Add calendar."
          : "Could not copy automatically. Select the feed URL above and copy it manually.";
      }
    });
  });

  document.getElementById("copy-feed").addEventListener("click", (e) => {
    const btn = e.currentTarget;
    copyToClipboard(feedUrl).then((ok) => {
      btn.textContent = ok ? "Copied ✓" : "Copy failed";
      setTimeout(() => { btn.textContent = "Copy feed URL"; }, 1600);
    });
  });

  document.getElementById("download-ics").addEventListener("click", () => {
    const enriched = state.schedule.events.map((e) => {
      const code = eventShorthand(e, state.labelIndex);
      return code ? { ...e, calendarTitle: code } : e;
    });

    const ics = eventsToIcs(enriched, {
      calendarName: state.institution.settings.calendarName,
      locale: state.locale,
      timezone: state.manifest.timezone,
      institutionId: state.institution.settings.institutionId,
      locations: state.institution.locations,
      generatedAt: new Date()
    });

    const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = calendarFileName(state.assignment);
    a.click();
    URL.revokeObjectURL(url);
  });
}

function calendarFileName(assignment) {
  const group = assignment.practicalGroup ?? "unresolved";
  const sub = assignment.subdivision ? `-${String(assignment.subdivision).toLowerCase()}` : "";
  const level = assignment.yearLevel != null ? `-year-${assignment.yearLevel}` : "";
  return `group-${group}${sub}${level}.ics`;
}

function renderError(err) {
  els.result.hidden = true;
  if (err instanceof StudentNotFoundError) {
    setStatus("Student ID not found. Check the ID, or contact the college office if you believe this is wrong.", "error");
    return;
  }
  if (err instanceof DataIntegrityError) {
    setStatus(`Data integrity problem: ${err.message}. This is a repository data issue, not an authentication issue.`, "error");
    return;
  }
  setStatus(`Unexpected error: ${err.message}`, "error");
}

function recomputeWithElectives(state) {
  const selected = state.selectedElectives;
  const merged = mergeSelectedElectives(
    state.schedule.events.filter((e) => !e.elective),
    state.electiveCatalog,
    selected,
    {
      timezone: state.manifest.timezone,
      institutionId: state.institution.settings.institutionId,
      locale: state.locale,
      context: { programId: state.assignment.programId, yearLevel: state.assignment.yearLevel }
    }
  );
  const electiveDiag = { errors: [], warnings: [] };
  state.schedule.events = sortOccurrences(mergeOccurrences(merged, electiveDiag), state.locale);
  foldNewDiagnostics(state.schedule.diagnostics, electiveDiag);
  state.issues = [
    ...state.schedule.diagnostics.errors.map((message) => ({ level: "error", message })),
    ...state.schedule.diagnostics.warnings.map((message) => ({ level: "warning", message }))
  ];
  state.reminderPlan = buildReminderPlan(state.schedule.events);
  reminderScheduler?.setEvents(state.schedule.events, {
    labelFor: (e) => evLabel(state, e),
    timeFor: (e) => formatEventTime(e),
    locationFor: (e) => formatLocation(e.location, state.institution.locations.buildings, state.locale)
  });
  renderAssignmentSummary(state);
  renderView(state, state.view);
  renderReminderCard(state);
}

function renderElectivesCard(state) {
  let card = document.getElementById("electives-card");
  if (!card) {
    // Null-safe anchor chain: prefer #reminder-card (created first in renderAll),
    // fall back to the static .subscription-card, then to appending into #result.
    // This guarantees we never dereference a null parentNode regardless of order.
    const anchor =
      document.getElementById("reminder-card") ??
      document.querySelector(".subscription-card") ??
      null;
    card = document.createElement("section");
    card.id = "electives-card";
    card.className = "subscription-card";
    card.setAttribute("aria-labelledby", "electives-heading");
    if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(card, anchor);
    else (els.result ?? document.body).appendChild(card);
  }

  const eligible = state.eligibleElectives ?? [];
  if (!eligible.length) {
    card.innerHTML = `
      <h2 id="electives-heading">Electives</h2>
      <p class="hint">No optional electives are offered for your program and year this semester.</p>`;
    return;
  }

  const selected = new Set(state.selectedElectives ?? []);
  let rows = "";
  for (const el of eligible) {
    const slug = el.slug ?? el.id;
    const on = selected.has(slug);
    const title = localize(el.title, state.locale) || el.title?.en || slug;
    const when = (el.sessions ?? [])
      .map((s) => `${s.day} ${formatTime12(s.start)}${s.end ? "–" + formatTime12(s.end) : ""}`)
      .join(" · ");
    rows += `
      <label class="elective-row" style="display:flex;gap:10px;align-items:flex-start;padding:8px 0;border-bottom:1px solid var(--line);">
        <input type="checkbox" data-elective="${escapeHtml(slug)}" ${on ? "checked" : ""} style="width:18px;height:18px;margin-top:2px;accent-color:${escapeHtml(el.color ?? "var(--accent)")};" />
        <span style="flex:1;min-width:0;">
          <strong style="color:${escapeHtml(el.color ?? "inherit")};">${escapeHtml(title)}</strong>
          ${el.code ? `<span class="hint"> · ${escapeHtml(el.code)}</span>` : ""}
          ${el.delivery === "online" ? '<span class="tag" style="background:var(--accent-soft);border-color:var(--accent);color:var(--accent);">Online</span>' : ""}
          <div class="hint">${escapeHtml(when)}</div>
        </span>
      </label>`;
  }

  // Per-elective static feeds for the ones the student registered (Google route).
  let feedRows = "";
  for (const el of eligible) {
    const slug = el.slug ?? el.id;
    if (!selected.has(slug)) continue;
    const feedUrl = buildElectiveFeedUrl(slug, state.manifest);
    if (!feedUrl) continue;
    const title = localize(el.title, state.locale) || el.title?.en || slug;
    feedRows += `
      <div class="feed-box" style="margin-top:8px;">
        <div><span class="feed-label">${escapeHtml(title)} feed</span><code>${escapeHtml(feedUrl)}</code></div>
        <div class="feed-actions">
          <a class="btn primary" href="${escapeHtml(googleCalendarSubscribeUrl(feedUrl))}" target="_blank" rel="noopener noreferrer">Subscribe in Google Calendar</a>
          <a class="btn quiet" href="${escapeHtml(googleCalendarAddByUrlUrl())}" target="_blank" rel="noopener noreferrer" data-copy-feed="${escapeHtml(feedUrl)}">Add manually (backup)</a>
        </div>
      </div>`;
  }

  card.innerHTML = `
    <h2 id="electives-heading">Electives</h2>
    <p class="hint">Tick the optional courses you registered this semester. Your choice is stored only in this browser and is never uploaded. Ticked courses appear in the timetable above and in the .ics preview download; to put them in Google Calendar, subscribe to each course's feed below.</p>
    <div class="elective-list">${rows}</div>
    ${feedRows ? `<h3 style="margin-top:14px;">Your elective calendar feeds</h3>${feedRows}` : ""}
  `;

  card.querySelectorAll("input[data-elective]").forEach((cb) => {
    cb.addEventListener("change", () => {
      const slug = cb.dataset.elective;
      const set = new Set(state.selectedElectives ?? []);
      if (cb.checked) set.add(slug); else set.delete(slug);
      state.selectedElectives = Array.from(set);
      saveSelection(state, state.selectedElectives);
      recomputeWithElectives(state);
      renderElectivesCard(state);
    });
  });

  card.querySelectorAll("a[data-copy-feed]").forEach((a) => {
    a.addEventListener("click", () => { copyToClipboard(a.dataset.copyFeed); });
  });
}

// ============================================================================
//  COMPARE TAB
// ============================================================================

function q(id) { return document.getElementById(id); }

async function ensureCompare() {
  if (compareState.universe) return;
  if (compareState.universePromise) { await compareState.universePromise; return; }
  compareState.universePromise = (async () => {
    const manifest = await loader.loadManifest();
    const programs = await loader.loadPrograms(manifest);
    const institution = await loader.loadInstitutionData(manifest);
    const locale = institution.settings.defaultLocale ?? CONFIG.ui.defaultLocale ?? "en";
    const today = todayInTimeZone(manifest.timezone);
    compareState.manifest = manifest;
    compareState.programs = programs;
    compareState.institution = institution;
    compareState.locale = locale;
    compareState.today = today;
    compareState.universe = await enumerateCohorts(loader, manifest, programs);
    if (!compareState.slot.date) compareState.slot.date = today;
    if (!compareState.sideDate) compareState.sideDate = today;
    hydrateComparePickerCascade();
    renderCompareChips();
    // Auto-run whichever mode is active so the panel is never blank on entry.
    if (compareState.mode === "slot") await runSlotFinder();
    else await runSideBySide();
  })();
  try { await compareState.universePromise; }
  finally { compareState.universePromise = null; }
}

function bindCompareEvents() {
  document.querySelectorAll(".cmp-subseg button").forEach((btn) => {
    btn.addEventListener("click", () => {
      compareState.mode = btn.dataset.cmode;
      document.querySelectorAll(".cmp-subseg button").forEach((b) => {
        const active = b.dataset.cmode === compareState.mode;
        b.classList.toggle("active", active);
        b.setAttribute("aria-pressed", String(active));
      });
      q("cmp-slot-panel").hidden = compareState.mode !== "slot";
      q("cmp-side-panel").hidden = compareState.mode !== "side";
      ensureCompare().then(() => compareState.mode === "slot" ? runSlotFinder() : runSideBySide())
        .catch((err) => setStatus(`Compare failed: ${err.message}`, "error"));
    });
  });

  q("cmp-scope")?.addEventListener("change", (e) => { compareState.slot.scope = e.target.value; runSlotFinder().catch((err)=>setStatus(err.message,"error")); });
  document.querySelectorAll('input[name="cmp-gran"]').forEach((r) => r.addEventListener("change", (e) => { compareState.slot.gran = e.target.value; runSlotFinder().catch((err)=>setStatus(err.message,"error")); }));
  q("cmp-date")?.addEventListener("change", (e) => { compareState.slot.date = e.target.value; });
  q("cmp-start")?.addEventListener("change", (e) => { compareState.slot.start = e.target.value; });
  q("cmp-end")?.addEventListener("change", (e) => { compareState.slot.end = e.target.value; });
  q("cmp-quick")?.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
    const base = compareState.slot.date || compareState.today || todayInTimeZone("Africa/Cairo");
    const d = nextOccurringWeekday(base, b.dataset.wd);
    compareState.slot.date = d;
    const di = q("cmp-date"); if (di) di.value = d;
    runSlotFinder().catch((err)=>setStatus(err.message,"error"));
  }));

  // Side-by-side picker cascade
  q("cmp-p-program")?.addEventListener("change", () => { compareState.picker.programId = q("cmp-p-program").value; hydrateComparePickerYears(); });
  q("cmp-p-year")?.addEventListener("change", () => { compareState.picker.academicYearId = q("cmp-p-year").value; hydrateComparePickerLevels(); });
  q("cmp-p-level")?.addEventListener("change", () => { compareState.picker.yearLevel = q("cmp-p-level").value === "" ? null : Number(q("cmp-p-level").value); hydrateComparePickerGroups(); });
  q("cmp-p-group")?.addEventListener("change", () => { compareState.picker.practicalGroup = q("cmp-p-group").value === "" ? null : Number(q("cmp-p-group").value); hydrateComparePickerSubs(); });
  q("cmp-p-sub")?.addEventListener("change", () => { compareState.picker.subdivision = q("cmp-p-sub").value; });

  q("cmp-add")?.addEventListener("click", () => addCohortFromPicker());
  q("cmp-add-all-year")?.addEventListener("click", () => addAllOfCurrentYear());
  q("cmp-add-mine")?.addEventListener("click", () => addMySchedule());
  q("cmp-clear")?.addEventListener("click", () => { compareState.chips = []; compareState.referenceKey = null; renderCompareChips(); runSideBySide().catch((e)=>setStatus(e.message,"error")); });

  q("cmp-prev-day")?.addEventListener("click", () => shiftSideDate(-1));
  q("cmp-next-day")?.addEventListener("click", () => shiftSideDate(1));
  q("cmp-today-day")?.addEventListener("click", () => { compareState.sideDate = compareState.today; const d=q("cmp-side-date"); if(d) d.value=compareState.sideDate; runSideBySide().catch((e)=>setStatus(e.message,"error")); });
  q("cmp-side-date")?.addEventListener("change", (e) => { compareState.sideDate = e.target.value; runSideBySide().catch((err)=>setStatus(err.message,"error")); });
}

async function onCompareSubmit(event) {
  event.preventDefault();
  try {
    await ensureCompare();
    if (compareState.mode === "slot") await runSlotFinder();
    else await runSideBySide();
  } catch (err) { setStatus(`Compare failed: ${err.message}`, "error"); }
}

// ---- Picker cascade (mirrors the manual tab but standalone) ----------------
function hydrateComparePickerCascade() {
  const progSel = q("cmp-p-program"); if (!progSel) return;
  progSel.innerHTML = "";
  const programs = compareState.programs?.programs ?? [];
  for (const p of programs) addOption(progSel, p.id, p.name?.en ?? p.id);
  if (programs.length) { progSel.value = programs[0].id; compareState.picker.programId = programs[0].id; }
  hydrateComparePickerYears();
}

function compareProgram() { return (compareState.programs?.programs ?? []).find((p) => p.id === compareState.picker.programId) ?? null; }
function compareYear() { return compareProgram()?.academicYears?.find((y) => y.id === compareState.picker.academicYearId) ?? null; }

function hydrateComparePickerYears() {
  const sel = q("cmp-p-year"); if (!sel) return;
  const program = compareProgram();
  sel.innerHTML = "";
  const years = program?.academicYears ?? [];
  for (const y of years) addOption(sel, y.id, y.name?.en ?? y.id);
  if (years.length) { sel.value = years[0].id; compareState.picker.academicYearId = years[0].id; }
  hydrateComparePickerLevels();
}

function hydrateComparePickerLevels() {
  const sel = q("cmp-p-level"); if (!sel) return;
  const year = compareYear();
  sel.innerHTML = "";
  addOption(sel, "", "Whole year (all levels)");
  const levels = [...new Set((year?.semesters ?? []).map((s) => s.yearLevel).filter((l) => l != null))].sort((a,b)=>a-b);
  for (const l of levels) addOption(sel, String(l), yearLevelLabel(l));
  compareState.picker.yearLevel = null;
  hydrateComparePickerGroups();
}

function compareSemestersForPicker() {
  const year = compareYear();
  if (!year) return [];
  return (year.semesters ?? []).filter(
    (s) => s.status !== "draft" &&
      (compareState.picker.yearLevel == null || s.yearLevel == null || Number(s.yearLevel) === Number(compareState.picker.yearLevel))
  );
}

function hydrateComparePickerGroups() {
  const sel = q("cmp-p-group"); if (!sel) return;
  sel.innerHTML = "";
  addOption(sel, "", "Select group");
  const groups = [...new Set(compareSemestersForPicker().flatMap((s) => collectGroupsFromSemesterDoc(s)))].sort((a,b)=>a-b);
  for (const g of groups) addOption(sel, String(g), `Group ${g}`);
  compareState.picker.practicalGroup = null;
  hydrateComparePickerSubs();
}

// Groups present in the universe for the current picker selection.
function collectGroupsFromSemesterDoc() {
  const out = new Set();
  for (const c of compareState.universe ?? []) {
    if (c.programId !== compareState.picker.programId) continue;
    if (c.academicYearId !== compareState.picker.academicYearId) continue;
    if (compareState.picker.yearLevel != null && Number(c.yearLevel) !== Number(compareState.picker.yearLevel)) continue;
    if (c.practicalGroup != null) out.add(c.practicalGroup);
  }
  return Array.from(out);
}

function hydrateComparePickerSubs() {
  const sel = q("cmp-p-sub"); if (!sel) return;
  sel.innerHTML = "";
  addOption(sel, "", "Whole group");
  const subs = [...new Set((compareState.universe ?? [])
    .filter((c) => c.programId === compareState.picker.programId
      && c.academicYearId === compareState.picker.academicYearId
      && (compareState.picker.yearLevel == null || Number(c.yearLevel) === Number(compareState.picker.yearLevel))
      && (compareState.picker.practicalGroup == null || c.practicalGroup === compareState.picker.practicalGroup)
      && c.subdivision)
    .map((c) => c.subdivision))].sort();
  for (const s of subs) addOption(sel, s, `Subgroup ${s}`);
  compareState.picker.subdivision = "";
}

function cohortFromPicker() {
  const program = compareProgram();
  const programLabel = program?.name?.en ?? compareState.picker.programId;
  const c = {
    programId: compareState.picker.programId,
    academicYearId: compareState.picker.academicYearId,
    yearLevel: compareState.picker.yearLevel,
    practicalGroup: compareState.picker.practicalGroup,
    subdivision: compareState.picker.subdivision || null,
    programLabel
  };
  if (!c.programId || !c.academicYearId || c.practicalGroup == null) return null;
  // Resolve against the universe so key/label are canonical and dedupe works.
  const match = (compareState.universe ?? []).find((u) =>
    u.programId === c.programId && u.academicYearId === c.academicYearId &&
    Number(u.yearLevel ?? "") === Number(c.yearLevel ?? "") &&
    u.practicalGroup === c.practicalGroup &&
    (u.subdivision ?? "") === (c.subdivision ?? "")
  );
  return match ?? (() => { const k = cohortKeyLocal(c); c.key = k; c.label = labelLocal(c); return c; })();
}

function cohortKeyLocal(c) { return [c.programId, c.academicYearId, c.yearLevel ?? "", c.practicalGroup ?? "", c.subdivision ?? ""].join("|"); }
function labelLocal(c) {
  const lvl = c.yearLevel == null ? "" : ` · Yr ${c.yearLevel}`;
  const grp = c.practicalGroup == null ? "" : ` · G${c.practicalGroup}${c.subdivision ? c.subdivision : ""}`;
  return `${c.programLabel ?? c.programId}${lvl}${grp}`;
}

function addCohortFromPicker() {
  const c = cohortFromPicker();
  if (!c) { setStatus("Choose a program, year and group first.", "error"); return; }
  if (compareState.chips.some((x) => x.key === c.key)) { showToast("Already added."); return; }
  compareState.chips.push(c);
  if (!compareState.referenceKey) compareState.referenceKey = c.key;
  renderCompareChips();
  runSideBySide().catch((e)=>setStatus(e.message,"error"));
}

function addAllOfCurrentYear() {
  const added = [];
  for (const c of compareState.universe ?? []) {
    if (c.programId !== compareState.picker.programId) continue;
    if (c.academicYearId !== compareState.picker.academicYearId) continue;
    if (compareState.picker.yearLevel != null && Number(c.yearLevel) !== Number(compareState.picker.yearLevel)) continue;
    if (compareState.chips.some((x) => x.key === c.key)) continue;
    compareState.chips.push(c); added.push(c.key);
  }
  if (!compareState.referenceKey && added.length) compareState.referenceKey = added[0];
  renderCompareChips();
  runSideBySide().catch((e)=>setStatus(e.message,"error"));
  showToast(added.length ? `Added ${added.length} cohorts.` : "Nothing new to add.");
}

function addMySchedule() {
  if (!currentState) { setStatus("Look up your schedule first (Student ID or Year & group tab).", "error"); return; }
  const a = currentState.assignment;
  const c = {
    programId: a.programId, academicYearId: a.academicYearId, yearLevel: a.yearLevel ?? null,
    practicalGroup: a.practicalGroup, subdivision: a.subdivision ?? null,
    programLabel: localize(currentState.program.name, compareState.locale) || a.programId
  };
  c.key = cohortKeyLocal(c); c.label = labelLocal(c) + " (mine)";
  if (compareState.chips.some((x) => x.key === c.key)) { showToast("Your schedule is already in the comparison."); return; }
  compareState.chips.unshift(c);
  compareState.referenceKey = c.key;   // "mine" becomes the swap reference
  renderCompareChips();
  runSideBySide().catch((e)=>setStatus(e.message,"error"));
}

function renderCompareChips() {
  const box = q("cmp-chips"); if (!box) return;
  if (!compareState.chips.length) { box.innerHTML = `<span class="cmp-empty">No cohorts selected. Use the pickers above, “Add all of this year”, or “＋ My schedule”.</span>`; return; }
  box.innerHTML = compareState.chips.map((c) => {
    const ref = c.key === compareState.referenceKey;
    return `<span class="cmp-chip ${ref ? "ref" : ""}" data-key="${escapeHtml(c.key)}">
      <button type="button" class="cmp-chip-star" title="${ref ? "Reference cohort" : "Set as reference (for swap checks)"}" data-act="ref">${ref ? "★" : "☆"}</button>
      <span>${escapeHtml(c.label)}</span>
      <button type="button" class="cmp-chip-x" title="Remove" data-act="rm">×</button>
    </span>`;
  }).join("");
  box.querySelectorAll(".cmp-chip").forEach((chip) => {
    const key = chip.dataset.key;
    chip.querySelector('[data-act="ref"]').addEventListener("click", () => { compareState.referenceKey = key; renderCompareChips(); runSideBySide().catch((e)=>setStatus(e.message,"error")); });
    chip.querySelector('[data-act="rm"]').addEventListener("click", () => {
      compareState.chips = compareState.chips.filter((x) => x.key !== key);
      if (compareState.referenceKey === key) compareState.referenceKey = compareState.chips[0]?.key ?? null;
      renderCompareChips(); runSideBySide().catch((e)=>setStatus(e.message,"error"));
    });
  });
}

function shiftSideDate(delta) {
  compareState.sideDate = formatDate(addDays(parseDate(compareState.sideDate || compareState.today), delta));
  const d = q("cmp-side-date"); if (d) d.value = compareState.sideDate;
  runSideBySide().catch((e)=>setStatus(e.message,"error"));
}

// Compose every cohort in a list (memoized), return Map key -> events[].
async function composeMany(cohorts) {
  const map = new Map();
  for (const c of cohorts) {
    const packed = await composeCohortEvents(loader, compareState.manifest, compareState.programs, compareState.institution, c, compareState.today, compareState.locale, compareState.composedCache);
    map.set(c.key, packed.events ?? []);
  }
  return map;
}

// ---- Slot finder render ----------------------------------------------------
async function runSlotFinder() {
  const out = q("cmp-slot-result"); if (!out) return;
  if (!compareState.universe) { out.innerHTML = `<p class="cmp-empty">Loading cohorts…</p>`; return; }
  const date = compareState.slot.date || compareState.today;
  const startMin = timeToMinutes(compareState.slot.start || "17:00");
  const endMin = Math.max(timeToMinutes(compareState.slot.end || "18:00"), startMin + 1);
  const scope = compareState.slot.scope;
  const gran = compareState.slot.gran;

  let cohorts = compareState.universe.filter((c) => scope === "all" || c.programId === scope);
  if (gran === "group") cohorts = cohorts.filter((c) => !c.subdivision);
  else cohorts = cohorts.filter((c) => c.subdivision);

  out.innerHTML = `<p class="cmp-empty">Computing ${cohorts.length} cohorts for ${formatLongDate(date)} ${formatTime12(minutesToHHMM(startMin))}–${formatTime12(minutesToHHMM(endMin))}…</p>`;
  const composed = await composeMany(cohorts);
  const rows = slotRows(cohorts, composed, date, startMin, endMin);
  const freeCount = rows.filter((r) => r.free).length;

  const d = parseDate(date);
  let html = `<p class="cmp-summary"><strong>${freeCount}</strong> of ${rows.length} cohorts are <span class="cmp-status-free">free</span> on <strong>${escapeHtml(WEEKDAYS_LONG[d.getUTCDay()])} ${escapeHtml(formatShortDate(date))}</strong>, ${escapeHtml(formatTime12(minutesToHHMM(startMin)))}–${escapeHtml(formatTime12(minutesToHHMM(endMin)))}. Rotation weeks, batch ranges, exams and the mid‑term blackout are honored.</p>`;
  html += `<div class="cmp-actions"><button class="btn quiet" type="button" id="cmp-copy-free">Copy free cohort names</button></div>`;
  html += `<div class="cmp-scroll"><table class="cmp-table"><thead><tr><th>Cohort</th><th>Status</th><th>Occupying that slot</th></tr></thead><tbody>`;
  for (const r of rows) {
    const detail = r.free
      ? `<span class="cmp-status-free">Free</span>`
      : r.blocking.map((e) => `<span class="cmp-ev" style="${cmpEvStyle(e)}">${escapeHtml(cmpEvText(e))}</span>`).join("");
    html += `<tr><td>${escapeHtml(r.cohort.label)}</td><td>${r.free ? '<span class="cmp-status-free">Free</span>' : '<span class="cmp-status-busy">Busy</span>'}</td><td>${detail}</td></tr>`;
  }
  html += `</tbody></table></div>`;
  out.innerHTML = html;

  q("cmp-copy-free")?.addEventListener("click", () => {
    const names = rows.filter((r) => r.free).map((r) => r.cohort.label).join("\n");
    copyToClipboard(names).then((ok) => showToast(ok ? `Copied ${rows.filter((r)=>r.free).length} free cohort names.` : "Copy failed."));
  });
}

// ---- Side-by-side render ---------------------------------------------------
async function runSideBySide() {
  const out = q("cmp-side-result"); if (!out) return;
  if (!compareState.chips.length) { out.innerHTML = `<p class="cmp-empty">Add at least two cohorts to compare. The first chip (★) is the reference for swap checks.</p>`; return; }
  const date = compareState.sideDate || compareState.today;
  const composed = await composeMany(compareState.chips);
  const { lo, hi, rows } = sideMatrix(compareState.chips, composed, date, compareState.referenceKey);
  const windows = commonFreeWindows(compareState.chips, composed, date, lo, hi);
  const refLabel = compareState.chips.find((c) => c.key === compareState.referenceKey)?.label ?? null;

  const d = parseDate(date);
  let html = `<p class="cmp-summary"><strong>${escapeHtml(WEEKDAYS_LONG[d.getUTCDay()])} ${escapeHtml(formatShortDate(date))}</strong> · ${compareState.chips.length} cohorts${refLabel ? ` · reference: <strong>${escapeHtml(refLabel)}</strong>` : ""}. ✓ = reference is free then (you could sit this session); ✗ = reference is busy.</p>`;

  html += `<div class="cmp-scroll"><table class="cmp-table"><thead><tr><th class="cmp-time">Time</th>`;
  for (const c of compareState.chips) html += `<th class="${c.key === compareState.referenceKey ? "cmp-col-ref" : ""}">${escapeHtml(c.label)}</th>`;
  html += `<th>Free</th></tr></thead><tbody>`;

  for (const row of rows) {
    const freeN = row.cells.filter((x) => x.free).length;
    html += `<tr><td class="cmp-time">${escapeHtml(formatTime12(minutesToHHMM(row.start)))}–${escapeHtml(formatTime12(minutesToHHMM(row.end)))}</td>`;
    for (const cell of row.cells) {
      const isRef = cell.cohort.key === compareState.referenceKey;
      let inner;
      if (cell.free) inner = `<span class="cmp-ev free">—</span>`;
      else {
        inner = cell.events.map((e) => {
          const swap = (compareState.referenceKey && !isRef)
            ? (cell.refFree ? ' <span class="cmp-swok">✓</span>' : ' <span class="cmp-swbad">✗</span>')
            : "";
          return `<span class="cmp-ev" style="${cmpEvStyle(e)}">${escapeHtml(cmpEvText(e))}${swap}</span>`;
        }).join("");
      }
      html += `<td class="${isRef ? "cmp-col-ref" : ""}">${inner}</td>`;
    }
    html += `<td>${freeN}/${row.cells.length}</td></tr>`;
  }
  html += `</tbody></table></div>`;

  // All-day strip per cohort (exams, college events).
  const allDayLines = compareState.chips.map((c) => {
    const evs = allDayEventsOnDate(composed.get(c.key) ?? [], date);
    if (!evs.length) return "";
    return `<div><strong>${escapeHtml(c.label)}:</strong> ${evs.map((e)=>escapeHtml(cmpEvText(e))).join(", ")}</div>`;
  }).filter(Boolean);
  if (allDayLines.length) html += `<p class="cmp-summary" style="margin-top:8px;"><strong>All‑day:</strong> ${allDayLines.join(" ")}</p>`;

  html += `<div class="cmp-summary" style="margin-top:10px;"><strong>Everyone free simultaneously:</strong></div><div class="cmp-common">`;
  html += windows.length
    ? windows.map((w) => `<span class="win">${escapeHtml(formatTime12(minutesToHHMM(w.start)))}–${escapeHtml(formatTime12(minutesToHHMM(w.end)))}</span>`).join("")
    : `<span class="cmp-empty">None in the visible range.</span>`;
  html += `</div>`;

  out.innerHTML = html;
}

function cmpEvText(e) {
  const title = e.displayCode || e.title?.[compareState.locale] || e.title?.en || e.courseId || e.type || "event";
  const loc = formatLocation(e.location, compareState.institution.locations.buildings, compareState.locale);
  return loc ? `${title} · ${loc}` : title;
}
function cmpEvStyle(e) {
  const color = eventColor(e, null) || e.color || null;
  return color ? `border-left-color:${color};background:${color}14;` : "";
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[char]));
}
