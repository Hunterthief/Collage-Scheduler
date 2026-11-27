// Bootstrap + event wiring for the Study plan page.
// Week planning is explicit: ＋ on a day opens a picker, ⇄ moves a lecture,
// × takes it off the day. No drag-and-drop anywhere.
import { S, byId, savePlan, snapshot, clearPlan, addLecturesForCourse, DEFAULT_SETTINGS, loadPlan, LECTURES_PER_SUBJECT, addD } from "./study/store.js";
import { boot, defaultCohort, setCohort, cohortFromId, hm, winS, winE } from "./study/data.js";
import { autoPlan, clearWeek, markDone, summaryText, lecTitle } from "./study/planner.js";
import { exportICS, exportCSV, exportBackup, gcalUrl } from "./study/export.js";
import { T, initTimer, toggle as tToggle, reset as tReset, skip as tSkip, setMode, start as tStart, snd, unlockAudio } from "./study/timer.js";
import * as V from "./study/views.js";
import { startOfWeek, parseDate } from "./schedule/recurrence.js";

const $ = (s) => document.querySelector(s);
const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MO = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const md = (s) => { const d = parseDate(s); return MO[d.getUTCMonth()] + " " + d.getUTCDate(); };
const wd = (s) => parseDate(s).getUTCDay();

init();

async function init() {
  try {
    await boot();
    const c = defaultCohort();
    if (!c) { $("#s-hero-sub").textContent = "No programs published yet."; return; }
    await applyCohort(c);
  } catch (err) {
    $("#s-hero-sub").textContent = "Could not load data: " + err.message;
    return;
  }
  initTimer({
    paint: V.paintTimer, dots: V.renderDots, bind: V.renderBind,
    toast: V.toast,
    log: (delta) => {
      V.renderAll();
      const todayTotal = S.plan.lectures.reduce((s, x) => s + (x.sessions || []).filter((s2) => s2.date === S.today).reduce((a, b) => a + b.min, 0), 0);
      $("#focus-log").innerHTML = "Logged <b class='num'>" + V.fmtMin(delta) + "</b> · today total <b class='num'>" + V.fmtMin(todayTotal) + "</b>";
    },
    after: () => V.renderAll()
  });
  bindEvents();
  document.addEventListener("pointerdown", unlockAudio, { once: true });
  document.addEventListener("visibilitychange", () => { if (!document.hidden && T.state === "running") V.paintTimer(); });
  V.renderAll();
}

async function applyCohort(c) {
  await setCohort(c);
  loadPlan(S.cohort, S.courseList, S.today, S.weekStartDay);
  T.bind = null;
  V.renderAll();
  V.setCohortSelects(S.cohort);
}

function bindEvents() {
  document.addEventListener("click", onClick);
  document.addEventListener("input", (e) => { if (e.target.id === "picker-q") V.setPickerQuery(e.target.value); });
  $("#scrim").addEventListener("click", V.closeDrawer);
  $("#picker-scrim").addEventListener("click", V.closePicker);
  $("#sound-btn").addEventListener("click", () => { S.plan.settings.sound = !S.plan.settings.sound; savePlan(); V.syncSound(); if (S.plan.settings.sound) { unlockAudio(); snd.tick(); } });
  $("#q").addEventListener("input", (e) => { S.ui.q = e.target.value; V.renderAll(); });
  $("#pri-filter").addEventListener("change", (e) => { S.ui.pri = e.target.value; V.renderAll(); });
  $("#sort-sel").addEventListener("change", (e) => { S.ui.sort = e.target.value; V.renderAll(); });
  ["c-program", "c-year", "c-level", "c-group"].forEach((id) =>
    $("#" + id).addEventListener("change", () => applyCohort(V.readCohortFromSelects()).catch((e) => V.toast(e.message, { kind: "danger" }))));
  $("#c-id-go").addEventListener("click", async () => {
    try {
      const c = await cohortFromId($("#c-id").value);
      await applyCohort(c);
      V.toast("Cohort set from ID", { kind: "success" });
    } catch (err) { V.toast(err.message, { kind: "danger" }); }
  });
  $("#bind-sel").addEventListener("change", (e) => { T.bind = e.target.value || null; V.paintTimer(); });
  $("#t-focus").addEventListener("input", (e) => { S.plan.settings.focus = +e.target.value; savePlan(); V.renderTune(); V.paintTimer(); });
  $("#t-short").addEventListener("input", (e) => { S.plan.settings.short = +e.target.value; savePlan(); V.renderTune(); V.paintTimer(); });
  $("#t-long").addEventListener("input", (e) => { S.plan.settings.long = +e.target.value; savePlan(); V.renderTune(); V.paintTimer(); });
  $("#t-win-start").addEventListener("change", (e) => {
    S.plan.settings.dayStart = e.target.value;
    if (winE() <= winS()) S.plan.settings.dayEnd = String(Math.min(23, hm(S.plan.settings.dayStart) / 60 + 2)).padStart(2, "0") + ":00";
    savePlan(); V.renderAll();
  });
  $("#t-win-end").addEventListener("change", (e) => {
    S.plan.settings.dayEnd = e.target.value;
    if (winE() <= winS()) S.plan.settings.dayStart = String(Math.max(6, hm(S.plan.settings.dayEnd) / 60 - 2)).padStart(2, "0") + ":00";
    savePlan(); V.renderAll();
  });
  $("#t-auto").addEventListener("change", (e) => { S.plan.settings.autoStart = e.target.checked; savePlan(); });
  $("#t-sound").addEventListener("change", (e) => { S.plan.settings.sound = e.target.checked; savePlan(); V.syncSound(); if (e.target.checked) { unlockAudio(); snd.tick(); } });
  $("#import-file").addEventListener("change", onImport);
  document.addEventListener("keydown", onKey);
}

function onKey(e) {
  const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
  if (e.key === "Escape") {
    if (!$("#day-picker").hidden) { V.closePicker(); return; }
    if (!$("#drawer").hidden) { V.closeDrawer(); return; }
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !typing) { e.preventDefault(); V.doUndo(); return; }
  if (typing) return;
  if (e.key === "/") { e.preventDefault(); $("#q").focus(); }
  else if (e.key.toLowerCase() === "n") { e.preventDefault(); newLecture(); }
  else if (e.key === " ") { e.preventDefault(); tToggle(); }
}

function newLecture() {
  const c = S.courseList[0]; if (!c) return;
  V.openDrawer(null, { c: c.id, num: Math.max(0, ...S.plan.lectures.filter((l) => l.c === c.id).map((l) => l.num)) + 1 });
}

async function onClick(e) {
  const t = e.target.closest("[data-action]");
  if (!t) return;
  const a = t.dataset.action;
  if (a === "open") { if (e.target.type === "checkbox") return; V.openDrawer(t.dataset.id); }
  else if (a === "select") { e.stopPropagation(); t.checked ? S.ui.sel.add(t.dataset.id) : S.ui.sel.delete(t.dataset.id); V.renderAll(); }
  else if (a === "new") newLecture();
  else if (a === "quick-add") V.openDrawer(null, { c: t.dataset.c, num: +t.dataset.num });
  else if (a === "close-drawer") V.closeDrawer();
  else if (a === "save-drawer") V.commitDrawer();
  else if (a === "d-pri" || a === "d-status") t.parentElement.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b === t)));
  else if (a === "delete-lecture") {
    snapshot("delete lecture");
    S.plan.lectures = S.plan.lectures.filter((l) => l.id !== t.dataset.id);
    S.ui.sel.delete(t.dataset.id); savePlan(); V.renderAll(); V.closeDrawer();
    V.toast("Lecture deleted", { kind: "danger", undo: true });
  }
  else if (a === "focus-this") { T.bind = t.dataset.id; V.renderBind(); if (T.state !== "running") tStart(); V.closeDrawer(); V.toast("Timer bound & started", { kind: "success" }); }
  else if (a === "gcal-single") {
    const url = gcalUrl(byId(t.dataset.id));
    if (url) { window.open(url, "_blank", "noopener"); V.toast("Google Calendar opened with this lecture pre-filled — press Save.", { kind: "success" }); }
    else V.toast("Assign a day first, then export.", { kind: "warn" });
  }
  else if (a === "add-to-day") V.openPicker("add", { day: t.dataset.day });
  else if (a === "move-lecture") V.openPicker("move", { lectureId: t.dataset.id });
  else if (a === "unassign-lecture") {
    const l = byId(t.dataset.id); if (!l || !l.day) return;
    snapshot("unassign lecture");
    const day = l.day; l.day = null;
    savePlan(); V.renderAll();
    V.toast("Taken off " + WD[wd(day)] + " " + md(day) + ": " + lecTitle(l), { kind: "warn", undo: true });
  }
  else if (a === "picker-add") V.pickerAssign(t.dataset.id);
  else if (a === "picker-move") V.pickerMove(t.dataset.day);
  else if (a === "picker-unassign") V.pickerUnassign();
  else if (a === "picker-close") V.closePicker();
  else if (a === "tab") { S.ui.view = t.dataset.v; V.renderAll(); }
  else if (a === "f-subject") {
    const v = t.dataset.v;
    S.ui.subjects = v === "all" ? [] : S.ui.subjects.includes(v) ? S.ui.subjects.filter((x) => x !== v) : [...S.ui.subjects, v];
    V.renderAll();
  }
  else if (a === "f-status") { S.ui.status = t.dataset.v; S.ui.untimed = false; V.renderAll(); }
  else if (a === "clear-filters") { Object.assign(S.ui, { q: "", subjects: [], status: "all", pri: "all", minEst: 0, untimed: false }); V.renderAll(); }
  else if (a === "apply-view") {
    const v = S.plan.views.find((x) => x.id === t.dataset.id); if (!v) return;
    Object.assign(S.ui, { q: v.f.q || "", subjects: [...(v.f.subjects || [])], status: v.f.status || "all", pri: v.f.pri || "all", sort: v.f.sort || "subject", minEst: v.f.minEst || 0, untimed: !!v.f.untimed, view: v.f.view || S.ui.view });
    V.renderAll(); V.toast("View: " + v.name);
  }
  else if (a === "del-view") { e.stopPropagation(); S.plan.views = S.plan.views.filter((v) => v.id !== t.dataset.id); savePlan(); V.renderAll(); }
  else if (a === "save-view") {
    const name = prompt("Name this view (filters + sort + tab):", "My view");
    if (!name) return;
    S.plan.views.push({ id: "v" + Date.now().toString(36), name: name.slice(0, 26), f: { q: S.ui.q, subjects: [...S.ui.subjects], status: S.ui.status, pri: S.ui.pri, sort: S.ui.sort, view: S.ui.view, minEst: S.ui.minEst, untimed: !!S.ui.untimed } });
    savePlan(); V.renderAll(); V.toast("View saved", { kind: "success" });
  }
  else if (a === "bulk-done") {
    snapshot("bulk done");
    S.plan.lectures.forEach((l) => { if (S.ui.sel.has(l.id) && l.status !== "done") markDone(l); });
    S.ui.sel.clear(); savePlan(); V.renderAll(); snd.done();
    V.toast("Marked done — recalls scheduled", { kind: "success", undo: true });
  }
  else if (a === "bulk-delete") {
    const n = S.ui.sel.size; snapshot("delete " + n + " lectures");
    S.plan.lectures = S.plan.lectures.filter((l) => !S.ui.sel.has(l.id));
    S.ui.sel.clear(); savePlan(); V.renderAll();
    V.toast(n + " lectures deleted", { kind: "danger", undo: true });
  }
  else if (a === "bulk-clear") { S.ui.sel.clear(); V.renderAll(); }
  else if (a === "week-prev") { S.anchor = addD(S.anchor, -7); savePlan(); V.renderAll(); }
  else if (a === "week-next") { S.anchor = addD(S.anchor, 7); savePlan(); V.renderAll(); }
  else if (a === "week-today") { S.anchor = startOfWeek(S.today, S.weekStartDay); savePlan(); V.renderAll(); }
  else if (a === "jump-exam") {
    S.ui.view = "week"; S.anchor = startOfWeek(t.dataset.date, S.weekStartDay); savePlan(); V.renderAll();
    const cell = document.querySelector('#week-grid [data-day="' + t.dataset.date + '"]');
    if (cell) { cell.classList.add("flash"); cell.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" }); }
  }
  else if (a === "autoplan") {
    const r = autoPlan();
    if (r.past) { V.toast("This week is in the past — jump to next week first", { kind: "warn" }); return; }
    if (r.empty) { V.toast(r.untimed ? r.untimed + " lectures still need a time — set lengths to auto-plan them." : "Nothing unassigned to plan", { kind: "warn" }); return; }
    S.ui.view = "week"; V.renderAll(); snd.drop();
    V.toast(r.placed + " lectures slotted into free hours" + (r.left ? " · " + r.left + " left — not enough free time" : "") + (r.untimed ? " · " + r.untimed + " still need a time" : ""), { kind: r.left || r.untimed ? "warn" : "success", undo: true });
  }
  else if (a === "clear-week") {
    const n = clearWeek();
    if (!n) { V.toast("Nothing planned this week"); return; }
    V.renderAll(); V.toast(n + " lectures unassigned", { kind: "warn", undo: true });
  }
  else if (a === "rev-done") {
    const l = byId(t.dataset.id); if (!l?.reviews) return;
    snapshot("recall"); l.reviews[+t.dataset.i].done = S.today; savePlan(); V.renderAll(); snd.done();
    V.toast(l.reviews.every((r) => r.done) ? "Mastered: " + lecTitle(l) + " 🎓" : "Recall logged", { kind: "success", undo: true });
  }
  else if (a === "rev-snooze") {
    const l = byId(t.dataset.id); if (!l?.reviews) return;
    snapshot("snooze"); l.reviews[+t.dataset.i].due = addD(l.reviews[+t.dataset.i].due, 1); savePlan(); V.renderAll();
    V.toast("Pushed one day");
  }
  else if (a === "setup-twelve") {
    snapshot("create 12 slots per subject");
    let added = 0;
    for (const c of S.courseList) added += addLecturesForCourse(c.id, LECTURES_PER_SUBJECT);
    savePlan(); V.renderAll(); snd.drop();
    V.toast(added + " empty lecture slots created — name and time them at your own pace.", { kind: "success", undo: true });
  }
  else if (a === "add-twelve") {
    snapshot("create 12 slots");
    const added = addLecturesForCourse(t.dataset.c, LECTURES_PER_SUBJECT);
    savePlan(); V.renderAll(); snd.drop();
    V.toast(added ? added + " empty slots added for this subject." : "This subject already has all 12 slots.", { kind: added ? "success" : "warn", undo: !!added });
  }
  else if (a === "clear-plan") {
    if (!S.plan.lectures.length) { V.toast("The sheet is already empty."); return; }
    clearPlan(); V.renderAll();
    V.toast("Sheet cleared", { kind: "danger", undo: true });
  }
  else if (a === "export-ics") {
    const n = exportICS();
    V.toast(n ? n + " events downloaded as study-plan.ics — import it in Google Calendar (Settings → Import & export) or just open it on iPhone/Mac." : "Nothing scheduled yet — assign lectures to days first.", { kind: n ? "success" : "warn" });
  }
  else if (a === "export-csv") {
    const n = exportCSV();
    V.toast(n ? n + " tasks downloaded as study-plan.csv — import it in Todoist, TickTick or any task app." : "The sheet is empty.", { kind: n ? "success" : "warn" });
  }
  else if (a === "export") { exportBackup(); V.toast("Backup downloaded — keep it safe or restore it on another device.", { kind: "success" }); }
  else if (a === "import") $("#import-file").click();
  else if (a === "summary") copySummary();
  else if (a === "reset-sample") {
    snapshot("reset sample");
    S.plan.lectures = [];
    S.plan.views = S.plan.views.length ? S.plan.views : [];
    savePlan(); V.renderAll();
    V.toast("Sheet emptied — start fresh whenever you're ready.", { kind: "success", undo: true });
  }
  else if (a === "t-start") tToggle();
  else if (a === "t-reset") tReset();
  else if (a === "t-skip") tSkip();
  else if (a === "t-mode") { setMode(t.dataset.v, true); V.renderDots(); }
  else if (a === "cycle-dec") { S.plan.settings.cycle = Math.max(2, S.plan.settings.cycle - 1); savePlan(); V.renderTune(); V.renderDots(); }
  else if (a === "cycle-inc") { S.plan.settings.cycle = Math.min(8, S.plan.settings.cycle + 1); savePlan(); V.renderTune(); V.renderDots(); }
  else if (a === "tune-reset") {
    S.plan.settings = Object.assign({}, DEFAULT_SETTINGS, { sound: S.plan.settings.sound });
    savePlan(); V.renderAll(); tReset(); V.toast("Tuning reset");
  }
}

function onImport(e) {
  const f = e.target.files[0]; if (!f) return;
  const r = new FileReader();
  r.onload = () => {
    try {
      const p = JSON.parse(r.result);
      const arr = Array.isArray(p) ? p : p.lectures;
      const ids = new Set(S.courseList.map((c) => c.id));
      if (!Array.isArray(arr) || !arr.every((l) => l && l.id && ids.has(l.c) && typeof l.est === "number")) throw new Error("shape");
      snapshot("import");
      S.plan.lectures = arr;
      if (p.views) S.plan.views = p.views;
      if (p.settings) S.plan.settings = Object.assign({}, DEFAULT_SETTINGS, p.settings);
      S.ui.sel.clear(); savePlan(); V.renderAll();
      V.toast("Restored " + arr.length + " lectures", { kind: "success", undo: true });
    } catch { V.toast("Restore failed — not a study-plan backup for this cohort", { kind: "danger" }); }
  };
  r.readAsText(f); e.target.value = "";
}
function copySummary() {
  const txt = summaryText();
  const done = (ok) => V.toast(ok ? "Plan summary copied — paste it anywhere" : "Copy failed", { kind: ok ? "success" : "danger" });
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(txt).then(() => done(true), () => fallback());
  else fallback();
  function fallback() {
    const ta = document.createElement("textarea");
    ta.value = txt; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    let ok = false; try { ok = document.execCommand("copy"); } catch {}
    ta.remove(); done(ok);
  }
}
