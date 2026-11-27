// All rendering. Reads shared state S; academic labels/colors come from the
// fetched datasets via data.js — no hardcoded subjects or schedules.
import { S, byId, savePlan, snapshot, popUndo } from "./store.js";
import { courseColor, courseTitle, tint, weekDates, capacityFor, nextExamFor, upcomingExams, winS, winE } from "./data.js";
import { filtered, matches, reviewQueue, markDone, unDone, PRI } from "./planner.js";
import { T, ringLen, modeLen, currentElapsed } from "./timer.js";
import { addD, wdIndex, daysBetween } from "./dates.js";
import { localize } from "../i18n.js";
import { parseDate } from "../schedule/recurrence.js";

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
const MO = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WDL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const md = (s) => { const d = parseDate(s); return MO[d.getUTCMonth()] + " " + d.getUTCDate(); };
export const fmtMin = (m) => { m = Math.round(m); const h = Math.floor(m / 60), r = m % 60; return h ? (r ? h + "h " + r + "m" : h + "h") : r + "m"; };
const fmtClock = (m) => { let h = Math.floor(m / 60); const r = m % 60; const ap = h >= 12 ? "PM" : "AM"; h = h % 12 || 12; return h + ":" + String(r).padStart(2, "0") + " " + ap; };
const cstyle = (id) => { const c = courseColor(id); return "--cc:" + c + ";--ct:" + tint(c, "1a") + ";--cb:" + tint(c, "66") + ";--cbg:" + tint(c, "12") + ";--fc:" + c + ";"; };

/* ---------- toasts + undo ---------- */
export function toast(msg, opts = {}) {
  const t = document.createElement("div");
  t.className = "toast " + (opts.kind || "");
  t.innerHTML = "<span>" + esc(msg) + "</span>" + (opts.undo ? "<button type='button'>Undo</button>" : "");
  $("#toasts").appendChild(t);
  const kill = () => { t.classList.add("out"); setTimeout(() => t.remove(), 260); };
  if (opts.undo) t.querySelector("button").addEventListener("click", () => { doUndo(); kill(); });
  setTimeout(kill, opts.undo ? 6500 : 3400);
  while ($("#toasts").children.length > 4) $("#toasts").firstChild.remove();
}
export function doUndo() {
  const label = popUndo();
  if (!label) { toast("Nothing to undo"); return; }
  renderAll(); toast("Undone: " + label, { kind: "success" });
}

/* ---------- master render ---------- */
export function renderAll() {
  if (!S.plan) return;
  renderWashes(); renderHero(); renderChips(); renderViews(); renderLibrary(); renderBulk();
  renderTabs(); renderCanvas(); renderProgress(); renderBind(); renderTune(); renderWeekBar();
  renderCohort(); syncSound(); paintTimer(); renderDots();
}
function renderWashes() {
  const cs = S.courseList.map((c) => courseColor(c.id));
  const r = document.documentElement.style;
  r.setProperty("--wash1", cs[0] || "#1a73e8");
  r.setProperty("--wash2", cs[2] || cs[1] || "#8e24aa");
  r.setProperty("--wash3", cs[3] || cs[1] || "#e37400");
}

function renderHero() {
  const d = parseDate(S.today);
  $("#s-today").textContent = WDL[d.getUTCDay()] + " · " + md(S.today) + ", " + d.getUTCFullYear();
  const sub = $("#s-hero-sub");
  if (S.cohort && S.semester) {
    sub.innerHTML = "Planning for <b>" + esc(cohortLabel()) + "</b> · " + esc(localize(S.semester.name, S.locale) || S.semester.id) +
      ". Free hours are computed from this cohort’s real classes, so the plan never books you into a lecture.";
  } else sub.textContent = "No published semester for this cohort yet — the plan still works, capacity shows the full study window.";
  const total = S.plan.lectures.length, done = S.plan.lectures.filter((l) => l.status === "done").length;
  const totalMin = S.plan.lectures.reduce((s, l) => s + l.est, 0);
  let planned = 0, free = 0;
  for (const day of weekDates()) {
    planned += S.plan.lectures.filter((l) => l.day === day && l.status !== "done").reduce((s, l) => s + l.est, 0);
    free += capacityFor(day).free;
  }
  const pct = total ? Math.round(done / total * 100) : 0;
  $("#s-stats").innerHTML =
    '<div class="s-stat" style="--sc:#f9ab00"><span class="lbl">Plan total</span><span class="big"><span class="circled num">' + total +
    '<svg viewBox="0 0 100 60" preserveAspectRatio="none" aria-hidden="true"><path d="M14 30 C 12 12, 60 6, 82 14 C 98 20, 96 44, 70 52 C 44 59, 10 52, 12 34"/></svg></span><small>lectures</small></span><span class="sub num">' + fmtMin(totalMin) + ' of listen + revise</span></div>' +
    '<div class="s-stat" style="--sc:#0b8043"><span class="lbl">Completed</span><span class="big num">' + done + '<small>/ ' + total + '</small></span><div class="bar"><i style="width:' + pct + '%;background:linear-gradient(90deg,#0b8043,#34a853)"></i></div><span class="sub num">' + pct + '% of the sheet</span></div>' +
    '<div class="s-stat" style="--sc:' + (courseColor(S.courseList[2]?.id) || "#8e24aa") + '"><span class="lbl">Planning week</span><span class="big num">' + fmtMin(planned) + '<small>planned</small></span><span class="sub num">' + fmtMin(free) + ' free around real classes</span><div class="bar"><i style="width:' + Math.min(100, free ? planned / free * 100 : 0) + '%;background:' + (planned > free ? "linear-gradient(90deg,#ea4335,#d93025)" : "linear-gradient(90deg,var(--wash1),var(--wash2))") + '"></i></div></div>';
  $("#s-exam-chips").innerHTML = upcomingExams(3).map((x) => {
    const dd = daysBetween(S.today, x.date);
    return '<button type="button" class="s-exam-chip" data-action="jump-exam" data-date="' + x.date + '">' + esc(courseTitle(x.courseId)) + ' exam <span class="d num">' + (dd === 0 ? "today" : dd + "d") + '</span></button>';
  }).join("") || '<span class="hint">No further dated exams in this cohort’s data.</span>';
}
export function cohortLabel() {
  const c = S.cohort; if (!c) return "";
  const p = S.options.programs.find((x) => x.id === c.programId);
  return (p?.name || c.programId) + " · Yr " + (c.yearLevel ?? "?") + " · G" + (c.practicalGroup ?? "?") + (c.subdivision || "");
}

function renderChips() {
  $("#subject-chips").innerHTML = '<button type="button" class="fchip all" data-action="f-subject" data-v="all" aria-pressed="' + (S.ui.subjects.length === 0) + '">All</button>' +
    S.courseList.map((c) => '<button type="button" class="fchip" style="--fc:' + courseColor(c.id) + '" data-action="f-subject" data-v="' + esc(c.id) + '" aria-pressed="' + S.ui.subjects.includes(c.id) + '" title="' + esc(courseTitle(c.id)) + '">' + esc(localize(c.title, S.locale) || c.id) + '</button>').join("");
  $$("#status-seg button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === S.ui.status)));
  $("#pri-filter").value = S.ui.pri; $("#sort-sel").value = S.ui.sort; $("#q").value = S.ui.q;
}
function renderViews() {
  const cur = JSON.stringify({ q: S.ui.q, subjects: S.ui.subjects, status: S.ui.status, pri: S.ui.pri, sort: S.ui.sort, view: S.ui.view, minEst: S.ui.minEst });
  $("#views-row").innerHTML = S.plan.views.map((v) =>
    '<span class="view-chip" role="button" tabindex="0" data-action="apply-view" data-id="' + v.id + '" aria-pressed="' + (JSON.stringify(v.f) === cur) + '">' + esc(v.name) +
    '<button type="button" class="x" data-action="del-view" data-id="' + v.id + '" aria-label="Delete saved view">×</button></span>').join("") +
    '<button type="button" class="save-view" data-action="save-view">＋ Save view</button>';
}

function lecCard(l, inWeek) {
  const filtering = S.ui.q || S.ui.subjects.length || S.ui.status !== "all" || S.ui.pri !== "all" || S.ui.minEst;
  const dim = filtering && !matches(l);
  if (inWeek) {
    return '<div class="wcard' + (l.status === "done" ? " done" : "") + (dim ? " dim" : "") + '" style="' + cstyle(l.c) + '" data-action="open" data-id="' + l.id + '">' +
      '<div class="t"><span class="grip" data-drag="' + l.id + '" title="Drag to another day">⠿</span><span class="tt">' + esc(l.title) + '</span></div>' +
      '<div class="m"><span class="st-dot st-' + l.status + '"></span><span class="num">' + fmtMin(l.est) + '</span><span class="pri ' + l.pri + '">' + l.pri + '</span><span style="color:var(--cc)">' + esc(courseTitle(l.c)) + ' ' + l.num + '</span></div></div>';
  }
  return '<div class="lec-card' + (S.ui.sel.has(l.id) ? " sel" : "") + (l.status === "done" ? " done" : "") + (dim ? " dim" : "") + '" style="' + cstyle(l.c) + '" data-action="open" data-id="' + l.id + '">' +
    '<span class="grip" data-drag="' + l.id + '" title="Drag onto a day in the Week view">⠿</span>' +
    '<input type="checkbox" data-action="select" data-id="' + l.id + '" ' + (S.ui.sel.has(l.id) ? "checked" : "") + ' aria-label="Select lecture"/>' +
    '<div class="lec-main"><div class="lec-top"><span class="lec-sub">' + esc(courseTitle(l.c)) + '</span><span class="lec-num num">Lec ' + l.num + '</span>' +
    (l.day ? '<span class="day-tag num">' + WD[wdIndex(l.day)] + " " + md(l.day) + '</span>' : '') + '</div>' +
    '<div class="lec-title">' + esc(l.title) + '</div>' +
    '<div class="lec-meta"><span class="st-dot st-' + l.status + '"></span><span class="num">' + fmtMin(l.est) + '</span><span class="pri ' + l.pri + '">' + l.pri + '</span>' +
    (l.actual ? '<span class="num" title="Logged focus time">⏱ ' + fmtMin(l.actual) + '</span>' : '') + '</div></div></div>';
}
function renderLibrary() {
  const arr = filtered();
  $("#lib-count").textContent = arr.length + " of " + S.plan.lectures.length;
  const list = $("#lib-list");
  if (!S.plan.lectures.length) {
    list.innerHTML = '<div class="s-empty">Your sheet is empty.<br><br><button type="button" class="btn primary sm" data-action="reset-sample">Regenerate starter plan</button></div>';
    return;
  }
  if (!arr.length) {
    list.innerHTML = '<div class="s-empty">No lectures match these filters.<br><br><button type="button" class="btn sm" data-action="clear-filters">Clear filters</button></div>';
    return;
  }
  list.innerHTML = arr.map((l) => lecCard(l, false)).join("");
}
function renderBulk() {
  const bar = $("#bulk-bar"); const n = S.ui.sel.size;
  if (!n) { bar.hidden = true; bar.innerHTML = ""; return; }
  bar.hidden = false;
  bar.innerHTML = '<b class="num">' + n + ' selected</b>' +
    '<button type="button" class="btn sm" data-action="bulk-done">✓ Done</button>' +
    '<select id="bulk-pri" aria-label="Set priority"><option value="">Priority…</option><option value="must">Must</option><option value="should">Should</option><option value="could">Could</option></select>' +
    '<select id="bulk-day" aria-label="Assign day"><option value="">Assign day…</option><option value="none">Unassign</option>' +
    weekDates().map((d) => '<option value="' + d + '">' + WD[wdIndex(d)] + " " + md(d) + '</option>').join("") + '</select>' +
    '<button type="button" class="btn sm danger" data-action="bulk-delete">Delete</button>' +
    '<button type="button" class="btn sm ghost" data-action="bulk-clear">×</button>';
  $("#bulk-pri").addEventListener("change", (e) => {
    if (!e.target.value) return;
    snapshot("bulk priority");
    S.plan.lectures.forEach((l) => { if (S.ui.sel.has(l.id)) l.pri = e.target.value; });
    savePlan(); renderAll(); toast("Priority set on " + n + " lectures", { kind: "success" });
  });
  $("#bulk-day").addEventListener("change", (e) => {
    if (!e.target.value) return;
    snapshot("bulk assign");
    const v = e.target.value; let i = 1;
    S.plan.lectures.forEach((l) => { if (S.ui.sel.has(l.id)) { l.day = v === "none" ? null : v; if (v !== "none") l.order = 100 + i++; } });
    savePlan(); renderAll(); toast(v === "none" ? "Unassigned " + n : "Assigned " + n + " lectures", { kind: "success" });
  });
}
function renderTabs() {
  $$(".s-tab").forEach((t) => t.setAttribute("aria-selected", String(t.dataset.v === S.ui.view)));
  $("#view-matrix").hidden = S.ui.view !== "matrix";
  $("#view-week").hidden = S.ui.view !== "week";
  $("#view-reviews").hidden = S.ui.view !== "reviews";
  const due = reviewQueue().due.length;
  const b = $("#rev-badge"); b.textContent = due; b.classList.toggle("zero", due === 0);
}
function renderCanvas() {
  if (S.ui.view === "matrix") renderMatrix();
  else if (S.ui.view === "week") renderWeek();
  else renderReviews();
}

function renderMatrix() {
  const maxCols = Math.max(4, ...S.plan.lectures.map((l) => l.num));
  let head = "<thead><tr><th>Subject · " + S.courseList.length + " courses</th>";
  for (let i = 1; i <= maxCols; i++) head += "<th>Lec " + i + "</th>";
  head += "</tr></thead>";
  const colTot = Array(maxCols + 1).fill(0), colDone = Array(maxCols + 1).fill(0);
  let body = "<tbody>";
  for (const c of S.courseList) {
    const lecs = S.plan.lectures.filter((l) => l.c === c.id).sort((a, b) => a.num - b.num);
    const tot = lecs.reduce((s, l) => s + l.est, 0), dn = lecs.filter((l) => l.status === "done").length;
    const ex = nextExamFor(c.id); const exd = ex ? daysBetween(S.today, ex.date) : null;
    body += '<tr><th><div class="mrow" style="' + cstyle(c.id) + '"><span class="swatch"></span><span class="t"><b>' + esc(courseTitle(c.id)) + '</b><span class="num">' + dn + "/" + lecs.length + " done · " + fmtMin(tot) + '</span></span>' +
      (ex && exd <= 14 ? '<span class="exam num">exam ' + exd + 'd</span>' : '') + '</div></th>';
    for (let n = 1; n <= maxCols; n++) {
      const l = lecs.find((x) => x.num === n);
      if (l) {
        colTot[n] += l.est; if (l.status === "done") colDone[n]++;
        const filtering = S.ui.q || S.ui.subjects.length || S.ui.status !== "all" || S.ui.pri !== "all" || S.ui.minEst;
        const dim = filtering && !matches(l), hit = S.ui.q && matches(l);
        body += '<td class="mcell"><button type="button" class="mchip ' + l.status + (dim ? " dim" : "") + (hit ? " hit" : "") + '" style="' + cstyle(c.id) + '" data-action="open" data-id="' + l.id + '" title="' + esc(l.title) + '">' +
          (l.pri === "must" && l.status !== "done" ? '<span class="flag">!</span>' : '') +
          '<span class="est num">' + fmtMin(l.est) + '</span><span class="st">' + (l.status === "done" ? "✓ done" : l.status === "doing" ? "● doing" : "to do") + '</span></button></td>';
      } else {
        body += '<td class="mcell"><button type="button" class="madd" style="' + cstyle(c.id) + '" data-action="quick-add" data-c="' + esc(c.id) + '" data-num="' + n + '" aria-label="Add lecture">＋</button></td>';
      }
    }
    body += "</tr>";
  }
  body += "</tbody>";
  let foot = '<tfoot><tr><th>Column load</th>';
  for (let n = 1; n <= maxCols; n++) foot += '<td class="num">' + (colTot[n] ? fmtMin(colTot[n]) + "<br><span style='color:#188038'>" + colDone[n] + " ✓</span>" : "—") + '</td>';
  foot += "</tr></tfoot>";
  $("#matrix-table").innerHTML = head + body + foot;
  const remain = S.plan.lectures.filter((l) => l.status !== "done").reduce((s, l) => s + l.est, 0);
  $("#matrix-note").innerHTML = '<span><b class="num">' + S.plan.lectures.length + '</b> lectures</span><span><b class="num">' + fmtMin(S.plan.lectures.reduce((s, l) => s + l.est, 0)) + '</b> total</span><span><b class="num">' + fmtMin(remain) + '</b> remaining</span><span style="margin-left:auto">! = must-do before its exam</span>';
}

function renderWeekBar() { $("#week-lbl").textContent = md(S.anchor) + " – " + md(addD(S.anchor, 6)); }
function renderWeek() {
  renderWeekBar();
  $("#week-grid").innerHTML = weekDates().map((d) => {
    const cap = capacityFor(d);
    const cards = S.plan.lectures.filter((l) => l.day === d).sort((a, b) => a.order - b.order);
    const planned = cards.filter((l) => l.status !== "done").reduce((s, l) => s + l.est, 0);
    const ratio = cap.free ? planned / cap.free : (planned ? 2 : 0);
    const meter = ratio > 1 ? "over" : ratio > .8 ? "tight" : "ok";
    const timed = cap.items.filter((i) => !i.allDay).sort((a, b) => a.s - b.s);
    const banners = cap.items.filter((i) => i.allDay);
    const shown = timed.slice(0, 4);
    const past = d < S.today, today = d === S.today;
    return '<div class="day' + (today ? " today" : "") + (past ? " past" : "") + '" data-drop="' + d + '" data-day="' + d + '">' +
      '<div class="day-h"><div class="r1"><span class="wd">' + WD[wdIndex(d)] + '</span><span class="dt num">' + md(d) + '</span>' +
      (today ? '<span class="tag todaytag">TODAY</span>' : past ? '<span class="tag pasttag">PAST</span>' : '') + '</div>' +
      banners.map((b) => '<div class="examline">📌 ' + esc(b.label) + '</div>').join("") + '</div>' +
      '<div class="cap"><div class="nums"><span>Planned <b class="num">' + fmtMin(planned) + '</b></span><span>Free <b class="num">' + fmtMin(cap.free) + '</b></span></div>' +
      '<div class="meter"><i class="' + meter + '" style="width:' + Math.min(100, ratio * 100) + '%"></i></div>' +
      '<div class="free num">' + fmtMin(cap.busy) + ' in class · window ' + fmtClock(winS()) + '–' + fmtClock(winE()) + '</div></div>' +
      (shown.length ? '<div class="classes">' + shown.map((i) =>
        '<div class="cls' + (i.type === "examination" ? " exam" : "") + '" style="--cc:' + (i.color || "#5f6f83") + '" title="' + esc(i.label) + '">' + fmtClock(i.s) + " " + esc(i.label) + '</div>').join("") +
        (timed.length > 4 ? '<div class="cls more">+' + (timed.length - 4) + ' more classes</div>' : '') + '</div>' : '') +
      '<div class="day-cards" data-cards="' + d + '">' +
      (cards.length ? cards.map((l) => lecCard(l, true)).join("") : '<div class="drop-hint">' + (past ? "Past day" : "Drop lectures here<br>or hit ⚡ Auto-plan") + '</div>') +
      '</div></div>';
  }).join("");
}

function renderReviews() {
  const q = reviewQueue();
  const grp = (title, cls, items, actions) => items.length ?
    '<div class="rev-group ' + cls + '"><h3>' + title + ' <span class="n num">' + items.length + '</span></h3><div class="rev-list">' +
    items.map((it) => {
      const dd = daysBetween(S.today, it.due);
      return '<div class="rev" style="' + cstyle(it.l.c) + '"><span class="stage">Recall ' + (it.i + 1) + '/3</span>' +
        '<div class="info"><b>' + esc(it.l.title) + '</b><span>' + esc(courseTitle(it.l.c)) + ' · Lec ' + it.l.num + '</span></div>' +
        '<span class="due num">' + (dd < 0 ? Math.abs(dd) + "d overdue" : dd === 0 ? "today" : "in " + dd + "d") + '</span>' +
        (actions ? '<button type="button" class="btn sm primary" data-action="rev-done" data-id="' + it.l.id + '" data-i="' + it.i + '">✓ Reviewed</button><button type="button" class="btn sm ghost" data-action="rev-snooze" data-id="' + it.l.id + '" data-i="' + it.i + '">+1d</button>' : '') +
        '</div>';
    }).join("") + '</div></div>' : "";
  let html = grp("Overdue — clear these first", "overdue", q.due.filter((x) => x.over), true) +
    grp("Due today", "today", q.due.filter((x) => !x.over), true) +
    grp("Coming up", "soon", q.soon, false) +
    (q.mastered.length ? '<div class="rev-group"><h3>Mastered 🎓 <span class="n num">' + q.mastered.length + '</span></h3><div class="rev-list">' +
      q.mastered.map((l) => '<div class="rev mastered" style="' + cstyle(l.c) + '"><span class="stage">3/3</span><div class="info"><b>' + esc(l.title) + '</b><span>' + esc(courseTitle(l.c)) + ' · all recalls complete</span></div><span class="due">locked in ✓</span></div>').join("") + '</div></div>' : '');
  if (!html) html = '<div class="s-empty">Nothing to recall yet.<br>Mark a lecture <b>done</b> and its +1d / +3d / +7d recalls appear here.</div>';
  $("#rev-wrap").innerHTML = html;
}

function renderProgress() {
  $("#prog-list").innerHTML = S.courseList.map((c) => {
    const ls = S.plan.lectures.filter((l) => l.c === c.id);
    const dn = ls.filter((l) => l.status === "done").length;
    const tot = ls.reduce((s, l) => s + l.est, 0);
    return '<div class="prog-row" style="' + cstyle(c.id) + '"><span class="sw"></span><span class="nm" title="' + esc(courseTitle(c.id)) + '">' + esc(courseTitle(c.id)) + '</span><span class="ct num">' + dn + "/" + ls.length + " · " + fmtMin(tot) + '</span><span class="bar"><i style="width:' + (ls.length ? dn / ls.length * 100 : 0) + '%"></i></span></div>';
  }).join("");
  const act = S.plan.lectures.reduce((s, l) => s + (l.actual || 0), 0);
  const est = S.plan.lectures.filter((l) => l.status === "done").reduce((s, l) => s + l.est, 0);
  $("#prog-total").innerHTML = '<span>Focus logged <b class="num">' + fmtMin(act) + '</b></span><span>vs <b class="num">' + fmtMin(est) + '</b> estimated (done)</span>';
}

/* ---------- focus / tuning ---------- */
export function renderBind() {
  const sel = $("#bind-sel");
  const opts = S.plan.lectures.filter((l) => l.status !== "done").sort((a, b) => PRI[a.pri] - PRI[b.pri] || a.num - b.num);
  if (T.bind && !byId(T.bind)) T.bind = null;
  sel.innerHTML = '<option value="">— choose a lecture —</option>' + opts.map((l) =>
    '<option value="' + l.id + '"' + (l.id === T.bind ? " selected" : "") + '>' + esc(courseTitle(l.c)) + " " + l.num + " · " + esc(l.title.slice(0, 38)) + '</option>').join("");
  sel.value = T.bind || "";
}
export function paintTimer() {
  const remain = Math.max(0, T.total - currentElapsed());
  const mm = Math.floor(remain / 60), ss = Math.floor(remain % 60);
  $("#timer-time").textContent = String(mm).padStart(2, "0") + ":" + String(ss).padStart(2, "0");
  $("#ring-fg").style.strokeDashoffset = String(ringLen * (1 - (T.total ? currentElapsed() / T.total : 0)));
  $("#timer-start").innerHTML = T.state === "running" ? "⏸ Pause" : T.state === "paused" ? "▶ Resume" : "▶ Start";
  $("#timer-mode").textContent = T.mode === "focus" ? "Focus" : T.mode === "short" ? "Short break" : "Long break";
  const bl = T.bind ? byId(T.bind) : null;
  $("#timer-bound").textContent = T.mode === "focus" ? (bl ? courseTitle(bl.c) + " · Lec " + bl.num : "pick a lecture below") : "breathe ☕";
  $$(".s-mode-seg button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === T.mode)));
  document.title = (T.state === "running" ? String(mm).padStart(2, "0") + ":" + String(ss).padStart(2, "0") + " · " : "") + "Study Plan · College Scheduler";
}
export function renderDots() {
  const n = S.plan.settings.cycle;
  const on = T.cycles % n;
  $("#cycle-dots").innerHTML = Array.from({ length: n }, (_, i) => '<i class="' + (i < on || (T.cycles > 0 && on === 0) ? "on" : "") + '"></i>').join("");
}
function fillTime(sel, val) {
  sel.innerHTML = "";
  for (let h = 6; h <= 23; h++) {
    const v = String(h).padStart(2, "0") + ":00";
    const o = document.createElement("option"); o.value = v; o.textContent = fmtClock(h * 60);
    if (v === val) o.selected = true;
    sel.appendChild(o);
  }
}
export function renderTune() {
  const st = S.plan.settings;
  $("#t-focus").value = st.focus; $("#o-focus").textContent = st.focus + " min";
  $("#t-short").value = st.short; $("#o-short").textContent = st.short + " min";
  $("#t-long").value = st.long; $("#o-long").textContent = st.long + " min";
  $("#cycle-val").textContent = st.cycle;
  fillTime($("#t-win-start"), st.dayStart); fillTime($("#t-win-end"), st.dayEnd);
  $("#o-win").textContent = fmtMin(winE() - winS()) + "/day";
  $("#t-auto").checked = st.autoStart; $("#t-sound").checked = st.sound;
  if (T.state === "idle") { T.total = modeLen(T.mode); }
}
export function syncSound() {
  const on = S.plan.settings.sound;
  $("#sound-btn").setAttribute("aria-pressed", String(on));
  $("#sound-lbl").textContent = on ? "Sound on" : "Muted";
  $("#t-sound").checked = on;
}

/* ---------- cohort selects ---------- */
export function renderCohort() {
  const c = S.cohort; if (!c) return;
  const programs = S.options.programs;
  const pSel = $("#c-program");
  pSel.innerHTML = programs.map((p) => '<option value="' + esc(p.id) + '"' + (p.id === c.programId ? " selected" : "") + '>' + esc(p.name) + '</option>').join("");
  const p = programs.find((x) => x.id === c.programId) || programs[0];
  const ySel = $("#c-year");
  ySel.innerHTML = (p?.years || []).map((y) => '<option value="' + esc(y.id) + '"' + (y.id === c.academicYearId ? " selected" : "") + '>' + esc(y.name) + '</option>').join("");
  const y = p?.years.find((x) => x.id === c.academicYearId) || p?.years[0];
  const lSel = $("#c-level");
  lSel.innerHTML = (y?.levels || []).map((l) => '<option value="' + (l.level ?? "") + '"' + (String(l.level ?? "") === String(c.yearLevel ?? "") ? " selected" : "") + '>' + esc(l.label) + '</option>').join("");
  const lv = y?.levels.find((x) => String(x.level ?? "") === String(c.yearLevel ?? "")) || y?.levels[0];
  const gSel = $("#c-group");
  gSel.innerHTML = (lv?.groups || []).map((g) => '<option value="' + esc(g.value) + '"' + (g.value === groupValue(c) ? " selected" : "") + '>' + esc(g.label) + '</option>').join("");
  $("#c-note").innerHTML = "Free hours below are computed from <b>" + esc(cohortLabel()) + "</b>’s real classes" + (S.semester ? "" : " (no published semester — full window shown)") + ", so the plan never books you into a lecture.";
}
export const groupValue = (c) => c.subdivision ? c.practicalGroup + ":" + c.subdivision : String(c.practicalGroup ?? "");
export function readCohortFromSelects() {
  const programId = $("#c-program").value;
  const p = S.options.programs.find((x) => x.id === programId);
  const academicYearId = $("#c-year").value || p?.years[0]?.id || null;
  const y = p?.years.find((x) => x.id === academicYearId);
  const lvVal = $("#c-level").value;
  const yearLevel = lvVal === "" ? null : Number(lvVal);
  const lv = y?.levels.find((x) => String(x.level ?? "") === lvVal) || y?.levels[0];
  const gv = $("#c-group").value;
  const g = (lv?.groups || []).find((x) => x.value === gv) || lv?.groups[0];
  return { programId, academicYearId, yearLevel: yearLevel ?? lv?.level ?? null,
    practicalGroup: g?.practicalGroup ?? null, subdivision: g?.subdivision ?? null };
}
export function setCohortSelects(c) {
  $("#c-program").value = c.programId;
  renderCohort();
  $("#c-year").value = c.academicYearId ?? "";
  renderCohort();
  $("#c-level").value = String(c.yearLevel ?? "");
  renderCohort();
  $("#c-group").value = groupValue(c);
}

/* ---------- drawer ---------- */
let lastFocus = null;
export function openDrawer(id, create) {
  S.ui.drawer = { id: id || null, create: create || null };
  lastFocus = document.activeElement;
  const l = id ? byId(id) : null;
  const cid = l ? l.c : create.c;
  const model = l || { c: cid, num: create.num, title: "", est: 90, pri: "should", status: "todo", day: null, notes: "", actual: 0, sessions: [], reviews: null };
  const d = $("#drawer");
  d.style.setProperty("--cc", courseColor(cid));
  d.style.setProperty("--ct", tint(courseColor(cid), "14"));
  const dayOpts = '<option value="">Unassigned</option>' + weekDates().map((x) =>
    '<option value="' + x + '"' + (model.day === x ? " selected" : "") + '>' + WDL[wdIndex(x)] + " · " + md(x) + '</option>').join("");
  const revHtml = model.reviews ? '<div class="field"><label>Recall schedule</label><div class="rev-timeline">' +
    model.reviews.map((r, i) => '<span class="rev-pill ' + (r.done ? "done" : r.due <= S.today ? "due" : "") + '">' + (i + 1) + "· " + md(r.due) + (r.done ? " ✓" : r.due <= S.today ? " due" : "") + '</span>').join("") + '</div></div>' : "";
  const sessHtml = model.sessions?.length ? '<div class="field"><label>Focus sessions</label><div class="sess-log">' +
    model.sessions.slice(-6).reverse().map((s) => '<div><span>' + md(s.date) + " " + s.at + '</span><b class="num">' + s.min + ' min</b></div>').join("") + '</div></div>' : "";
  d.innerHTML =
    '<div class="drawer-h"><span class="swatch"></span><h2 id="drawer-title">' + (l ? "Edit lecture" : "New lecture") + '</h2><button type="button" class="x" data-action="close-drawer" aria-label="Close">✕</button></div>' +
    '<div class="drawer-b">' +
    '<div class="f2"><div class="field"><label for="d-course">Subject</label><select id="d-course">' +
    S.courseList.map((x) => '<option value="' + esc(x.id) + '"' + (x.id === model.c ? " selected" : "") + '>' + esc(courseTitle(x.id)) + '</option>').join("") + '</select></div>' +
    '<div class="field"><label for="d-num">Lecture №</label><input type="number" id="d-num" min="1" max="30" value="' + model.num + '"/></div></div>' +
    '<div class="field"><label for="d-title">Topic</label><input type="text" id="d-title" value="' + esc(model.title) + '" placeholder="e.g. Autonomic ganglia & NMJ"/></div>' +
    '<div class="field"><label>Estimate — listen + revise</label><div class="est-row"><input type="range" id="d-est" min="15" max="300" step="5" value="' + model.est + '"/><output id="d-est-out" class="num">' + fmtMin(model.est) + '</output></div></div>' +
    '<div class="f2"><div class="field"><label>Priority</label><div class="pri-seg" id="d-pri">' +
    ["must", "should", "could"].map((p) => '<button type="button" class="' + p + '" data-action="d-pri" data-v="' + p + '" aria-pressed="' + (model.pri === p) + '">' + p + '</button>').join("") + '</div></div>' +
    '<div class="field"><label>Status</label><div class="stat-seg" id="d-status">' +
    [["todo", "To do"], ["doing", "Doing"], ["done", "Done"]].map((s) => '<button type="button" class="' + s[0] + '" data-action="d-status" data-v="' + s[0] + '" aria-pressed="' + (model.status === s[0]) + '">' + s[1] + '</button>').join("") + '</div></div></div>' +
    '<div class="field"><label for="d-day">Planned day (this planning week)</label><select id="d-day">' + dayOpts + '</select></div>' +
    '<div class="field"><label>Actual vs estimate</label><div class="actual-bar"><i style="width:' + Math.min(100, model.est ? (model.actual || 0) / model.est * 100 : 0) + '%"></i></div><div class="mini-note num">' + fmtMin(model.actual || 0) + ' focused of ' + fmtMin(model.est) + ' estimated</div></div>' +
    revHtml + sessHtml +
    '<div class="field"><label for="d-notes">Notes</label><textarea id="d-notes" placeholder="Key points, page refs, things to re-check…">' + esc(model.notes || "") + '</textarea></div></div>' +
    '<div class="drawer-f">' + (l ? '<button type="button" class="btn danger" data-action="delete-lecture" data-id="' + l.id + '">Delete</button>' : '') +
    '<span class="grow"></span>' + (l && l.status !== "done" ? '<button type="button" class="btn" data-action="focus-this" data-id="' + l.id + '">🎯 Focus now</button>' : '') +
    '<button type="button" class="btn primary" data-action="save-drawer">' + (l ? "Save changes" : "Add lecture") + '</button></div>';
  $("#scrim").hidden = false; d.hidden = false;
  requestAnimationFrame(() => { $("#scrim").classList.add("show"); d.classList.add("show"); });
  $("#d-est").addEventListener("input", (e) => { $("#d-est-out").textContent = fmtMin(+e.target.value); });
  $("#d-course").addEventListener("change", (e) => {
    d.style.setProperty("--cc", courseColor(e.target.value));
    d.style.setProperty("--ct", tint(courseColor(e.target.value), "14"));
  });
  setTimeout(() => $("#d-title").focus(), 120);
}
export function closeDrawer() {
  const d = $("#drawer");
  d.classList.remove("show"); $("#scrim").classList.remove("show");
  setTimeout(() => { d.hidden = true; $("#scrim").hidden = true; }, 280);
  S.ui.drawer = null;
  if (lastFocus?.focus) lastFocus.focus();
}
export function commitDrawer() {
  const dr = S.ui.drawer; if (!dr) return;
  const l = dr.id ? byId(dr.id) : null;
  const m = Object.assign({}, l || { id: null, actual: 0, sessions: [], reviews: null, completedAt: null, order: 99 }, {
    c: $("#d-course").value,
    num: Math.min(30, Math.max(1, +$("#d-num").value || 1)),
    title: $("#d-title").value.trim() || courseTitle($("#d-course").value) + " — Lecture " + ($("#d-num").value || 1),
    est: +$("#d-est").value, notes: $("#d-notes").value, day: $("#d-day").value || null,
    pri: $("#d-pri [aria-pressed=true]").dataset.v,
    status: $("#d-status [aria-pressed=true]").dataset.v
  });
  snapshot(l ? "edit lecture" : "add lecture");
  if (m.status === "done" && !m.completedAt) markDone(m);
  if (m.status !== "done") unDone(m);
  if (l) {
    if (m.day !== l.day && m.day) m.order = Math.max(0, ...S.plan.lectures.filter((x) => x.day === m.day && x.id !== l.id).map((x) => x.order)) + 1;
    Object.assign(l, m);
  } else {
    m.id = "l" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    if (m.day) m.order = Math.max(0, ...S.plan.lectures.filter((x) => x.day === m.day).map((x) => x.order)) + 1;
    S.plan.lectures.push(m);
  }
  savePlan(); renderAll(); closeDrawer();
  toast(l ? "Saved" : "Lecture added", { kind: "success", undo: true });
}
