// Study plan — all rendering. Reads shared state S; academic labels/colors
// come from the fetched datasets via data.js. No hardcoded subjects.
// Extras (hub, prioritize/review sheets, leitner, demand, pace) render here so
// one renderAll() paints the whole page, mobile tabs included.
import { S, byId, savePlan, snapshot, popUndo, addD, wdIndex, daysBetween, LECTURES_PER_SUBJECT, dayMinutes, streakDays, auditDays, weekMinutes, suggestEst, openInboxCount } from "./store.js";
import { courseColor, courseTitle, tint, weekDates, capacityFor, nextExamFor, upcomingExams, winS, winE } from "./data.js";
import { filtered, matches, reviewQueue, markDone, unDone, PRI, lecTitle, timingsFor, fmt, hhmm, examDaysFor, frogPick, prioritizeLists, paceFor, currentStage, isPeak, peakEndMin, DEMAND_RANK } from "./planner.js";
import { T, ringLen, modeLen, currentElapsed } from "./timer.js";
import { parseDate } from "../schedule/recurrence.js";

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (m) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[m]));

const MO = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const WDL = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
const WD = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

export const md = (s) => {
  const d = parseDate(s);
  return MO[d.getUTCMonth()] + " " + d.getUTCDate();
};

export const fmtMin = fmt;

const fmtClock = (m) => {
  let h = Math.floor(m / 60);
  const r = m % 60;
  const ap = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return h + ":" + String(r).padStart(2, "0") + " " + ap;
};

const cstyle = (id) => {
  const c = courseColor(id);
  return "--cc:" + c + ";--ct:" + tint(c, "1a") + ";--cb:" + tint(c, "66") + ";--cbg:" + tint(c, "12") + ";--fc:" + c + ";";
};

const DM = { deep: { c: "#d93025", t: "D", n: "deep — needs peak hours" }, medium: { c: "#e37400", t: "M", n: "medium" }, light: { c: "#188038", t: "L", n: "light — fills a gap" } };
const demandOf = (l) => DM[l.demand] || DM.medium;

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
  renderAll();
  toast("Undone: " + label, { kind: "success" });
}

/* ---------- master render ---------- */
let frogId = null;      // lecture id of today's frog (for matrix highlight)
let sheetId = null;     // "x-prioritize" | "x-review" | null

export function renderAll() {
  if (!S.plan) return;
  renderWashes();
  renderHero();
  renderHub();
  renderChips();
  renderViews();
  renderLibrary();
  renderBulk();
  renderTabs();
  renderCanvas();
  renderProgress();
  renderBind();
  renderTune();
  renderWeekBar();
  syncSound();
  paintTimer();
  renderDots();
  if (sheetId) renderSheet(sheetId);
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
    sub.innerHTML = "Planning for <b>" + esc(cohortLabel()) + "</b> · " + esc(S.semester.name?.en || S.semester.id) + ". Free hours are computed from this cohort's real classes.";
  } else {
    sub.textContent = "No published semester for this cohort yet — the plan still works, capacity shows the full study window.";
  }

  const total = S.plan.lectures.length;
  const done = S.plan.lectures.filter((l) => l.status === "done").length;
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
  }).join("") || '<span class="hint">No further dated exams in this cohort\'s data.</span>';
}

export function cohortLabel() {
  const c = S.cohort;
  if (!c) return "";
  const p = S.options.programs.find((x) => x.id === c.programId);
  return (p?.name || c.programId) + " · Yr " + (c.yearLevel ?? "?") + " · G" + (c.practicalGroup ?? "?") + (c.subdivision || "");
}

/* ---------- TODAY HUB (frog · capture counts · streak · nudge) ---------- */
function renderHub() {
  const hub = $("#x-hub"); if (!hub) return;
  const f = frogPick();
  frogId = f && f.kind === "lecture" ? f.it.id : null;

  const ft = $("#x-frog-txt"), fa = $("#x-frog-act");
  if (!f) {
    ft.textContent = "Nothing queued — capture a task above or ＋12 in the matrix.";
    ft.classList.add("muted"); fa.hidden = true;
  } else {
    ft.classList.remove("muted");
    if (f.kind === "inbox") {
      ft.textContent = f.it.text + (f.it.two ? " · under 2 minutes" : "");
      fa.hidden = false; fa.textContent = "Do it"; fa.dataset.action = "x-frog-inbox"; fa.dataset.id = f.it.id;
    } else {
      const ed = examDaysFor(f.it.c);
      ft.textContent = courseTitle(f.it.c) + " " + f.it.num + " · " + lecTitle(f.it) + (ed != null ? " · exam in " + ed + "d" : "");
      fa.hidden = false; fa.textContent = "Start"; fa.dataset.action = "x-frog"; fa.dataset.id = f.it.id;
    }
  }

  const nearest = S.courseList.map((c) => examDaysFor(c.id)).filter((d) => d != null).sort((a, b) => a - b)[0];
  const remaining = S.plan.lectures.filter((l) => l.status !== "done").reduce((s, l) => s + l.est, 0);
  $("#x-hub-stats").innerHTML =
    '<span>📥 <b>' + openInboxCount() + '</b></span>' +
    '<span>⏳ exam <b class="' + (nearest == null ? "" : nearest <= 3 ? "warn" : nearest <= 7 ? "" : "ok") + '">' + (nearest != null ? nearest + "d" : "—") + '</b></span>' +
    '<span>⏱ today <b>' + fmtMin(dayMinutes(S.today)) + '</b></span>' +
    '<span>📚 left <b>' + fmtMin(remaining) + '</b></span>';

  const n = streakDays();
  const sk = $("#x-streak");
  sk.textContent = "🔥 " + n;
  sk.classList.toggle("zero", n === 0);

  const last = S.plan.review?.last;
  const stale = !last || daysBetween(last, S.today) >= 7;
  $("#x-review-nudge").hidden = !stale;
}

function renderChips() {
  $("#subject-chips").innerHTML =
    '<button type="button" class="fchip all" data-action="f-subject" data-v="all" aria-pressed="' + (S.ui.subjects.length === 0) + '">All</button>' +
    S.courseList.map((c) =>
      '<button type="button" class="fchip" style="--fc:' + courseColor(c.id) + '" data-action="f-subject" data-v="' + esc(c.id) + '" aria-pressed="' + S.ui.subjects.includes(c.id) + '" title="' + esc(courseTitle(c.id)) + '">' + esc(c.title?.en || c.id) + '</button>'
    ).join("");

  $$("#status-seg button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === S.ui.status)));
  $("#pri-filter").value = S.ui.pri;
  $("#sort-sel").value = S.ui.sort;
  $("#q").value = S.ui.q;
}

function renderViews() {
  const cur = JSON.stringify({ q: S.ui.q, subjects: S.ui.subjects, status: S.ui.status, pri: S.ui.pri, sort: S.ui.sort, view: S.ui.view, minEst: S.ui.minEst });
  $("#views-row").innerHTML = S.plan.views.map((v) =>
    '<span class="view-chip" role="button" tabindex="0" data-action="apply-view" data-id="' + v.id + '" aria-pressed="' + (JSON.stringify(v.f) === cur) + '">' + esc(v.name) +
    '<button type="button" class="x" data-action="del-view" data-id="' + v.id + '" aria-label="Delete saved view">×</button></span>'
  ).join("") + '<button type="button" class="save-view" data-action="save-view">＋ Save view</button>';
}

function lecCard(l, inWeek, tm) {
  const filtering = S.ui.q || S.ui.subjects.length || S.ui.status !== "all" || S.ui.pri !== "all" || S.ui.minEst;
  const dim = filtering && !matches(l);
  const t = tm ? tm.get(l.id) : null;
  const dm = demandOf(l);

  if (inWeek) {
    const cls = "wcard" + (l.status === "done" ? " done" : "") + (dim ? " dim" : "");
    let html = '<div class="' + cls + '" style="' + cstyle(l.c) + '" data-action="open" data-id="' + l.id + '">';
    html += '<div class="t"><span class="grip" data-drag="' + l.id + '" title="Drag to another day">⠿</span><span class="tt">' + esc(lecTitle(l)) + '</span>';
    html += '<span class="dm" style="--dm:' + dm.c + '" title="' + dm.n + '">' + dm.t + '</span></div>';
    html += '<div class="m"><span class="st-dot st-' + l.status + '"></span>';
    if (t) {
      html += '<span class="num">' + fmtClock(t.s) + '–' + fmtClock(t.e) + '</span>';
      if (isPeak(t.s)) html += '<span class="peak-badge" title="Inside your peak window">▲ peak</span>';
    } else {
      html += '<span class="unset">no time yet</span>';
    }
    html += '<span class="pri ' + l.pri + '">' + l.pri + '</span>';
    html += '<span style="color:var(--cc)">' + esc(courseTitle(l.c)) + ' ' + l.num + '</span></div></div>';
    return html;
  }

  const cls = "lec-card" + (S.ui.sel.has(l.id) ? " sel" : "") + (l.status === "done" ? " done" : "") + (dim ? " dim" : "");
  let html = '<div class="' + cls + '" style="' + cstyle(l.c) + '" data-action="open" data-id="' + l.id + '">';
  html += '<span class="grip" data-drag="' + l.id + '" title="Drag onto a day in the Week view">⠿</span>';
  html += '<input type="checkbox" data-action="select" data-id="' + l.id + '" ' + (S.ui.sel.has(l.id) ? "checked" : "") + ' aria-label="Select lecture"/>';
  html += '<div class="lec-main"><div class="lec-top"><span class="lec-sub">' + esc(courseTitle(l.c)) + '</span><span class="lec-num num">Lec ' + l.num + '</span>';
  html += '<span class="dm" style="--dm:' + dm.c + '" title="' + dm.n + '">' + dm.t + '</span>';
  if (l.day) {
    html += '<span class="day-tag num">' + WD[wdIndex(l.day)] + " " + md(l.day) + '</span>';
  }
  html += '</div><div class="lec-title">' + esc(lecTitle(l)) + '</div>';
  html += '<div class="lec-meta"><span class="st-dot st-' + l.status + '"></span>';
  if (l.est) {
    html += '<span class="num">' + fmtMin(l.est) + '</span>';
  } else {
    html += '<span class="unset">time not set</span>';
  }
  html += '<span class="pri ' + l.pri + '">' + l.pri + '</span>';
  if (l.actual) {
    html += '<span class="num" title="Logged focus time">⏱ ' + fmtMin(l.actual) + '</span>';
  }
  const cur = currentStage(l);
  if (cur) html += '<span class="num" title="Leitner box">B' + cur.box + '</span>';
  html += '</div></div></div>';
  return html;
}

function renderLibrary() {
  const arr = filtered();
  $("#lib-count").textContent = arr.length + " of " + S.plan.lectures.length;
  const list = $("#lib-list");

  if (!S.plan.lectures.length) {
    list.innerHTML = '<div class="s-empty"><b>Nothing here yet.</b><br>Use the ＋ cells in the matrix, or<br><br>' +
      '<button type="button" class="btn primary sm" data-action="setup-twelve">Create 12 empty lectures per subject</button> ' +
      '<button type="button" class="btn sm" data-action="new">Add one lecture</button></div>';
    return;
  }
  if (!arr.length) {
    list.innerHTML = '<div class="s-empty">No lectures match these filters.<br><br><button type="button" class="btn sm" data-action="clear-filters">Clear filters</button></div>';
    return;
  }
  list.innerHTML = arr.map((l) => lecCard(l, false)).join("");
}

function renderBulk() {
  const bar = $("#bulk-bar");
  const n = S.ui.sel.size;
  if (!n) { bar.hidden = true; bar.innerHTML = ""; return; }
  bar.hidden = false;

  const dayOpts = weekDates().map((d) => '<option value="' + d + '">' + WD[wdIndex(d)] + " " + md(d) + '</option>').join("");
  bar.innerHTML = '<b class="num">' + n + ' selected</b>' +
    '<button type="button" class="btn sm" data-action="bulk-done">✓ Done</button>' +
    '<select id="bulk-pri" aria-label="Set priority"><option value="">Priority…</option><option value="must">Must</option><option value="should">Should</option><option value="could">Could</option></select>' +
    '<select id="bulk-day" aria-label="Assign day"><option value="">Assign day…</option><option value="none">Unassign</option>' + dayOpts + '</select>' +
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
    const v = e.target.value;
    let i = 1;
    S.plan.lectures.forEach((l) => {
      if (S.ui.sel.has(l.id)) {
        l.day = v === "none" ? null : v;
        if (v !== "none") l.order = 100 + i++;
      }
    });
    savePlan(); renderAll(); toast(v === "none" ? "Unassigned " + n : "Assigned " + n + " lectures", { kind: "success" });
  });
}

function renderTabs() {
  $$(".s-tab").forEach((t) => t.setAttribute("aria-selected", String(t.dataset.v === S.ui.view)));
  $("#view-matrix").hidden = S.ui.view !== "matrix";
  $("#view-week").hidden = S.ui.view !== "week";
  $("#view-reviews").hidden = S.ui.view !== "reviews";
  const due = reviewQueue().due.length;
  const b = $("#rev-badge");
  b.textContent = due;
  b.classList.toggle("zero", due === 0);
}

function renderCanvas() {
  if (S.ui.view === "matrix") renderMatrix();
  else if (S.ui.view === "week") renderWeek();
  else renderReviews();
}

function renderMatrix() {
  const cols = LECTURES_PER_SUBJECT;
  let head = "<thead><tr><th>Subject · " + S.courseList.length + " courses · " + cols + " slots</th>";
  for (let i = 1; i <= cols; i++) head += "<th>Lec " + i + "</th>";
  head += "</tr></thead>";

  const colTot = Array(cols + 1).fill(0);
  const colDone = Array(cols + 1).fill(0);
  const { quads, starN } = prioritizeLists();
  const starIds = new Set(quads[1].slice(0, starN).filter((c) => c.kind === "lecture").map((c) => c.it.id));
  let body = "<tbody>";

  for (const c of S.courseList) {
    const lecs = S.plan.lectures.filter((l) => l.c === c.id).sort((a, b) => a.num - b.num);
    const tot = lecs.reduce((s, l) => s + l.est, 0);
    const dn = lecs.filter((l) => l.status === "done").length;
    const ex = nextExamFor(c.id);
    const exd = ex ? daysBetween(S.today, ex.date) : null;
    const pace = paceFor(c.id);

    body += '<tr><th><div class="mrow" style="' + cstyle(c.id) + '"><span class="swatch"></span><span class="t"><b>' + esc(courseTitle(c.id)) + '</b><span class="num">' + dn + "/" + lecs.length + " done · " + (tot ? fmtMin(tot) : "no times yet") + '</span></span>';
    body += '<button type="button" class="mrow-add" data-action="add-twelve" data-c="' + esc(c.id) + '" title="Create the empty 1–12 slots for this subject">＋12</button>';
    if (pace && pace.daysTo <= 21) {
      body += pace.behind
        ? '<span class="exam pace-warn num" title="Behind pace: ' + pace.done + ' done of ~' + Math.round(pace.total * (pace.daysTo ? (1 - pace.daysTo / (pace.daysTo + 1)) : 1)) + ' expected">⚠ ' + pace.perWeek + '/wk</span>'
        : '<span class="pace-ok num">✓ pace</span>';
    } else if (ex && exd <= 14) {
      body += '<span class="exam num">exam ' + exd + 'd</span>';
    }
    body += '</div></th>';

    for (let n = 1; n <= cols; n++) {
      const l = lecs.find((x) => x.num === n);
      if (l) {
        colTot[n] += l.est;
        if (l.status === "done") colDone[n]++;
        const filtering = S.ui.q || S.ui.subjects.length || S.ui.status !== "all" || S.ui.pri !== "all" || S.ui.minEst;
        const dim = filtering && !matches(l);
        const hit = S.ui.q && matches(l);
        const chipCls = "mchip " + l.status + (dim ? " dim" : "") + (hit ? " hit" : "") + (l.id === frogId ? " frog" : "");
        body += '<td class="mcell"><button type="button" class="' + chipCls + '" style="' + cstyle(c.id) + '" data-action="open" data-id="' + l.id + '" title="' + esc(lecTitle(l)) + (starIds.has(l.id) ? " · ⭐ high-leverage" : "") + '">';
        body += '<i class="dpip" style="--dm:' + demandOf(l).c + '" title="' + demandOf(l).n + '"></i>';
        if (starIds.has(l.id) && l.status !== "done") body += '<span class="pstar">⭐</span>';
        else if (l.pri === "must" && l.status !== "done") body += '<span class="flag">!</span>';
        const estCls = "est num" + (l.est ? "" : " unset");
        body += '<span class="' + estCls + '">' + (l.est ? fmtMin(l.est) : "—") + '</span>';
        const stText = l.status === "done" ? "✓ done" : l.status === "doing" ? "● doing" : (l.est ? "to do" : "set time");
        body += '<span class="st">' + stText + '</span></button></td>';
      } else {
        body += '<td class="mcell"><button type="button" class="madd" style="' + cstyle(c.id) + '" data-action="quick-add" data-c="' + esc(c.id) + '" data-num="' + n + '" aria-label="Add lecture ' + n + '">＋</button></td>';
      }
    }
    body += "</tr>";
  }
  body += "</tbody>";

  let foot = '<tfoot><tr><th>Column load</th>';
  for (let n = 1; n <= cols; n++) {
    const cell = colTot[n] ? fmtMin(colTot[n]) + "<br><span style='color:#188038'>" + colDone[n] + " ✓</span>" : "—";
    foot += '<td class="num">' + cell + '</td>';
  }
  foot += "</tr></tfoot>";

  $("#matrix-table").innerHTML = head + body + foot;

  const remain = S.plan.lectures.filter((l) => l.status !== "done").reduce((s, l) => s + l.est, 0);
  const untimed = S.plan.lectures.filter((l) => !l.est).length;
  $("#matrix-note").innerHTML =
    '<span><b class="num">' + S.plan.lectures.length + '</b> lectures</span>' +
    '<span><b class="num">' + fmtMin(S.plan.lectures.reduce((s, l) => s + l.est, 0)) + '</b> total</span>' +
    '<span><b class="num">' + fmtMin(remain) + '</b> remaining</span>' +
    '<span><b class="num">' + untimed + '</b> need a time</span>' +
    '<span style="margin-left:auto">● demand · ⭐ top-20% leverage · 🐸 gold ring = today’s frog</span>';
}

function renderWeekBar() {
  $("#week-lbl").textContent = md(S.anchor) + " – " + md(addD(S.anchor, 6));
}

function renderWeek() {
  renderWeekBar();
  const grid = $("#week-grid");
  const today = S.today;

  const dayHtml = weekDates().map((d) => {
    const cap = capacityFor(d);
    const tm = timingsFor(d);
    const cards = S.plan.lectures.filter((l) => l.day === d).sort((a, b) => a.order - b.order);
    const planned = cards.filter((l) => l.status !== "done").reduce((s, l) => s + l.est, 0);
    const ratio = cap.free ? planned / cap.free : (planned ? 2 : 0);
    const meter = ratio > 1 ? "over" : ratio > 0.8 ? "tight" : "ok";
    const timed = cap.items.filter((i) => !i.allDay).sort((a, b) => a.s - b.s);
    const banners = cap.items.filter((i) => i.allDay);
    const shown = timed.slice(0, 4);
    const past = d < today;
    const isToday = d === today;
    const over5 = cards.filter((l) => l.status !== "done").length > 5;

    let html = '<div class="day' + (isToday ? " today" : "") + (past ? " past" : "") + '" data-day="' + d + '">';

    html += '<div class="day-h"><div class="r1"><span class="wd">' + WD[wdIndex(d)] + '</span><span class="dt num">' + md(d) + '</span>';
    if (isToday) html += '<span class="tag todaytag">TODAY</span>';
    else if (past) html += '<span class="tag pasttag">PAST</span>';
    if (over5) html += '<span class="tag overtag" title="1–3–5 rule: more than 5 undone blocks in one day">⚠ ' + cards.length + '</span>';
    banners.forEach((b) => { html += '<div class="examline">📌 ' + esc(b.label) + '</div>'; });
    html += '</div>';
    html += '<button type="button" class="day-add" data-action="add-to-day" data-day="' + d + '" title="Plan a lecture on this day" aria-label="Plan a lecture on ' + WD[wdIndex(d)] + ' ' + md(d) + '">＋</button></div>';

    html += '<div class="cap"><div class="nums"><span>Planned <b class="num">' + fmtMin(planned) + '</b></span><span>Free <b class="num">' + fmtMin(cap.free) + '</b></span></div>';
    html += '<div class="meter"><i class="' + meter + '" style="width:' + Math.min(100, ratio * 100) + '%"></i></div>';
    html += '<div class="free num">' + fmtMin(cap.busy) + ' in class · window ' + fmtClock(winS()) + '–' + fmtClock(winE()) + ' · peak ends ' + fmtClock(peakEndMin()) + '</div></div>';

    if (shown.length) {
      html += '<div class="classes">';
      shown.forEach((i) => {
        const cc = i.color || "#5f6f83";
        const cls = "cls" + (i.type === "examination" ? " exam" : "");
        html += '<div class="' + cls + '" style="--cc:' + cc + '" title="' + esc(i.label) + '">' + fmtClock(i.s) + " " + esc(i.label) + '</div>';
      });
      if (timed.length > 4) {
        html += '<div class="cls more">+' + (timed.length - 4) + ' more classes</div>';
      }
      html += '</div>';
    }

    html += '<div class="day-cards">';
    if (cards.length) {
      cards.forEach((l) => { html += lecCard(l, true, tm); });
    } else {
      const hint = past ? "Past day — nothing was planned." : "Nothing planned yet.";
      const btn = past ? '' : '<button type="button" class="btn sm" data-action="add-to-day" data-day="' + d + '">＋ Add a lecture</button>';
      html += '<div class="day-empty"><span>' + hint + '</span>' + btn + '</div>';
    }
    html += '</div></div>';
    return html;
  }).join("");

  grid.innerHTML = dayHtml;
}

function renderReviews() {
  const q = reviewQueue();
  const t = S.today;

  const grp = (title, cls, items, actions) => {
    if (!items.length) return "";
    let html = '<div class="rev-group ' + cls + '"><h3>' + title + ' <span class="n num">' + items.length + '</span></h3><div class="rev-list">';
    items.forEach((it) => {
      const dd = daysBetween(t, it.due);
      const dueText = dd < 0 ? Math.abs(dd) + "d overdue" : dd === 0 ? "today" : "in " + dd + "d";
      html += '<div class="rev" style="' + cstyle(it.l.c) + '"><span class="stage">B' + it.box + '/5</span>';
      html += '<div class="info"><b>' + esc(it.l.title || ("Lecture " + it.l.num)) + '</b><span>' + esc(courseTitle(it.l.c)) + ' · Lec ' + it.l.num + '</span></div>';
      html += '<span class="due num">' + dueText + '</span>';
      if (actions) {
        html += '<button type="button" class="btn sm primary" data-action="rev-done" data-id="' + it.l.id + '" data-i="' + it.i + '">✓ Got it</button>';
        html += '<button type="button" class="btn sm ghost danger-ish" data-action="rev-again" data-id="' + it.l.id + '" title="Forgot — back to B1">Again</button>';
        html += '<button type="button" class="btn sm ghost" data-action="rev-snooze" data-id="' + it.l.id + '" data-i="' + it.i + '" title="Push one day">+1d</button>';
      }
      html += '</div>';
    });
    html += '</div></div>';
    return html;
  };

  const over = q.due.filter((x) => x.over);
  const todayDue = q.due.filter((x) => !x.over);

  let html = grp("Overdue — clear these first", "overdue", over, true) +
    grp("Due today", "today", todayDue, true) +
    grp("Coming up", "soon", q.soon, false);

  if (q.mastered.length) {
    html += '<div class="rev-group"><h3>Mastered 🎓 <span class="n num">' + q.mastered.length + '</span></h3><div class="rev-list">';
    q.mastered.forEach((l) => {
      html += '<div class="rev mastered" style="' + cstyle(l.c) + '"><span class="stage">B5</span>';
      html += '<div class="info"><b>' + esc(l.title || ("Lecture " + l.num)) + '</b><span>' + esc(courseTitle(l.c)) + ' · all boxes cleared</span></div>';
      html += '<span class="due">locked in ✓</span></div>';
    });
    html += '</div></div>';
  }

  const lapses = S.plan.review?.lapses || 0;
  if (lapses) html += '<div class="s-matrix-note"><span>Lapses this cohort: <b class="num">' + lapses + '</b> — “Again” is free, forgetting is the point of the box.</span></div>';

  if (!html) {
    html = '<div class="s-empty">Nothing to recall yet.<br>Mark a lecture <b>done</b> and its <b>B1 (+1d)</b> recall appears here.</div>';
  }
  $("#rev-wrap").innerHTML = html;
}

function renderProgress() {
  $("#prog-list").innerHTML = S.courseList.map((c) => {
    const ls = S.plan.lectures.filter((l) => l.c === c.id);
    const dn = ls.filter((l) => l.status === "done").length;
    const tot = ls.reduce((s, l) => s + l.est, 0);
    const pct = ls.length ? dn / ls.length * 100 : 0;
    const p = paceFor(c.id);
    const paceTag = p ? (p.behind ? ' <span class="pace-warn">⚠</span>' : ' <span class="pace-ok">✓</span>') : "";
    return '<div class="prog-row" style="' + cstyle(c.id) + '"><span class="sw"></span><span class="nm" title="' + esc(courseTitle(c.id)) + '">' + esc(courseTitle(c.id)) + paceTag + '</span><span class="ct num">' + dn + "/" + ls.length + " · " + (tot ? fmtMin(tot) : "—") + '</span><span class="bar"><i style="width:' + pct + '%' + (p?.behind ? ';background:#d93025' : "") + '"></i></span></div>';
  }).join("");

  const act = S.plan.lectures.reduce((s, l) => s + (l.actual || 0), 0);
  const est = S.plan.lectures.filter((l) => l.status === "done").reduce((s, l) => s + l.est, 0);
  $("#prog-total").innerHTML = '<span>Focus logged <b class="num">' + fmtMin(act) + '</b></span><span>vs <b class="num">' + fmtMin(est) + '</b> estimated (done)</span><span>this week <b class="num">' + fmtMin(weekMinutes()) + '</b></span>';
}

/* ---------- focus / tuning ---------- */
export function renderBind() {
  const sel = $("#bind-sel");
  const opts = S.plan.lectures.filter((l) => l.status !== "done").sort((a, b) =>
    (S.plan.settings.energyPlan ? DEMAND_RANK[a.demand || "medium"] - DEMAND_RANK[b.demand || "medium"] : 0) || PRI[a.pri] - PRI[b.pri] || a.num - b.num);
  if (T.bind && !byId(T.bind)) T.bind = null;
  sel.innerHTML = '<option value="">— choose a lecture —</option>' + opts.map((l) =>
    '<option value="' + l.id + '"' + (l.id === T.bind ? " selected" : "") + '>' + demandOf(l).t + " · " + esc(courseTitle(l.c)) + " " + l.num + " · " + esc((l.title || "").slice(0, 38)) + '</option>'
  ).join("");
  sel.value = T.bind || "";
}

export function paintTimer() {
  const remain = Math.max(0, T.total - currentElapsed());
  const mm = Math.floor(remain / 60);
  const ss = Math.floor(remain % 60);
  $("#timer-time").textContent = String(mm).padStart(2, "0") + ":" + String(ss).padStart(2, "0");
  $("#ring-fg").style.strokeDashoffset = String(ringLen * (1 - (T.total ? currentElapsed() / T.total : 0)));
  $("#timer-start").innerHTML = T.state === "running" ? "⏸ Pause" : T.state === "paused" ? "▶ Resume" : "▶ Start";
  $("#timer-mode").textContent = T.mode === "focus" ? "Focus" : T.mode === "short" ? "Short break" : "Long break";
  const bl = T.bind ? byId(T.bind) : null;
  $("#timer-bound").textContent = T.mode === "focus" ? (bl ? courseTitle(bl.c) + " · Lec " + bl.num + " · " + demandOf(bl).t : "pick a lecture below") : "breathe ☕";
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
    const o = document.createElement("option");
    o.value = v;
    o.textContent = fmtClock(h * 60);
    if (v === val) o.selected = true;
    sel.appendChild(o);
  }
}

export function renderTune() {
  const st = S.plan.settings;
  $("#t-focus").value = st.focus;
  $("#o-focus").textContent = st.focus + " min";
  $("#t-short").value = st.short;
  $("#o-short").textContent = st.short + " min";
  $("#t-long").value = st.long;
  $("#o-long").textContent = st.long + " min";
  $("#cycle-val").textContent = st.cycle;
  fillTime($("#t-win-start"), st.dayStart);
  fillTime($("#t-win-end"), st.dayEnd);
  $("#o-win").textContent = fmtMin(winE() - winS()) + "/day · peak → " + fmtClock(peakEndMin());
  $("#o-mix").textContent = st.mix === "interleave" ? "Interleave" : "Block";
  $("#t-energy").checked = !!st.energyPlan;
  $("#t-auto").checked = st.autoStart;
  $("#t-sound").checked = st.sound;
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
  const c = S.cohort;
  if (!c) return;
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
  $("#c-note").innerHTML = "Free hours below are computed from <b>" + esc(cohortLabel()) + "</b>'s real classes" + (S.semester ? "" : " (no published semester — full window shown)") + ", so the plan never books you into a lecture.";
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
  return { programId, academicYearId, yearLevel: yearLevel ?? lv?.level ?? null, practicalGroup: g?.practicalGroup ?? null, subdivision: g?.subdivision ?? null };
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

/* ---------- PRIORITIZE + REVIEW SHEETS ---------- */
let sheetFocus = null;

export function currentSheet() { return sheetId; }

export function openSheet(id) {
  closeSheet(true);
  const sheet = $("#" + id), scrim = $("#x-scrim");
  if (!sheet) return;
  sheetId = id;
  sheetFocus = document.activeElement;
  sheet.hidden = false; scrim.hidden = false;
  requestAnimationFrame(() => { sheet.classList.add("show"); scrim.classList.add("show"); });
  renderSheet(id);
  sheet.querySelector(".x-sheet-x")?.focus();
}

export function closeSheet(immediate) {
  if (!sheetId) return;
  const sheet = $("#" + sheetId), scrim = $("#x-scrim");
  const id = sheetId; sheetId = null;
  if (sheet) { sheet.classList.remove("show"); if (immediate) sheet.hidden = true; else setTimeout(() => { sheet.hidden = true; }, 280); }
  if (scrim) { scrim.classList.remove("show"); if (immediate) scrim.hidden = true; else setTimeout(() => { scrim.hidden = true; }, 280); }
  if (sheetFocus && sheetFocus.focus) sheetFocus.focus();
  sheetFocus = null;
}

function renderSheet(id) {
  if (id === "x-prioritize") renderPrioritize();
  else if (id === "x-review") renderReviewSheet();
}

function inboxRow(t) {
  const overdue = t.due && !t.done && daysBetween(S.today, t.due) < 0;
  return '<div class="x-task' + (t.done ? " done" : "") + (t.imp ? " imp" : "") + (t.two ? " two" : "") + '">' +
    '<input class="x-task-check" type="checkbox" ' + (t.done ? "checked " : "") + 'data-action="x-inbox-toggle" data-id="' + esc(t.id) + '" aria-label="Complete"/>' +
    '<span class="x-task-txt">' + esc(t.text) + '</span>' +
    '<span class="x-task-meta">' +
    (t.imp ? '<span class="x-task-badge star">★</span>' : "") +
    (t.two ? '<span class="x-task-badge two">2m</span>' : "") +
    (t.ctx ? '<span class="x-task-badge ctx">' + esc(t.ctx) + '</span>' : "") +
    '<input class="x-task-due' + (overdue ? " overdue" : "") + '" type="date" value="' + esc(t.due || "") + '" data-action="x-inbox-due" data-id="' + esc(t.id) + '" aria-label="Due date"/>' +
    (t.done ? "" : '<button type="button" class="btn sm ghost" data-action="x-inbox-promote" data-id="' + esc(t.id) + '" title="Turn into a lecture slot">→ Lecture</button>') +
    '<button class="x-task-x" type="button" data-action="x-inbox-del" data-id="' + esc(t.id) + '" aria-label="Delete">✕</button>' +
    '</span></div>';
}

function qItem(c, starred) {
  const it = c.it;
  if (c.kind === "inbox") {
    return '<div class="x-qitem inbox"><span class="qt">' + (starred ? '<span class="star">⭐</span> ' : "") + esc(it.text) + '</span>' +
      (it.due ? '<span class="qs num">' + esc(it.due.slice(5)) + '</span>' : "") + '</div>';
  }
  const dm = demandOf(it);
  const ed = examDaysFor(it.c);
  return '<div class="x-qitem lecture" style="--lc:' + dm.c + '"><span class="qt">' + (starred ? '<span class="star">⭐</span> ' : "") + esc(courseTitle(it.c)) + " " + it.num + " · " + esc(lecTitle(it)) + '</span>' +
    '<span class="qp ' + it.pri + '">' + it.pri + '</span>' +
    (ed != null ? '<span class="qs num">' + ed + 'd</span>' : "") + '</div>';
}

function renderPrioritize() {
  const body = $("#x-pri-body"); if (!body) return;
  const st = S.plan.settings;
  const { quads, starN } = prioritizeLists();
  const inbox = S.plan.inbox || [];
  const open = inbox.filter((t) => !t.done);

  const labels = { 1: ["Do now", "q1", "urgent + important"], 2: ["Schedule", "q2", "important, not urgent — this is where grades are made"], 3: ["Batch", "q3", "urgent, not important"], 4: ["Drop / later", "q4", "neither"] };
  const quadHtml = [1, 2, 3, 4].map((q) => {
    const list = quads[q];
    const inner = list.length
      ? list.map((c, i) => qItem(c, q === 1 && i < starN)).join("")
      : '<div class="x-quad-empty">Empty</div>';
    return '<div class="x-quad ' + labels[q][1] + '"><div class="x-quad-h">' + labels[q][0] + '<span class="n num">' + list.length + '</span></div>' +
      '<div class="x-quad-hint">' + labels[q][2] + '</div><div class="x-quad-b">' + inner + '</div></div>';
  }).join("");

  const paceRows = S.courseList.map((c) => {
    const p = paceFor(c.id);
    if (!p) return "";
    return '<tr><td>' + esc(courseTitle(c.id)) + '</td><td class="num">' + p.done + "/" + p.total + '</td><td class="num">' + p.daysTo + 'd</td><td class="num">' + p.perWeek + '/wk</td><td>' + (p.behind ? '<span class="pace-warn">⚠ behind</span>' : '<span class="pace-ok">✓ on pace</span>') + '</td></tr>';
  }).join("");

  body.innerHTML =
    '<div class="x-ctrl-row">' +
    '<button class="x-pill" type="button" data-action="x-toggle-mix" aria-pressed="' + (st.mix === "interleave") + '">🔀 ' + (st.mix === "interleave" ? "Interleave" : "Block") + '</button>' +
    '<span class="x-peak-tip">Peak window → <b>' + fmtClock(peakEndMin()) + '</b>. ' + (st.energyPlan ? "Auto-plan puts <b>deep</b> work first." : "Turn on energy-aware planning in Tuning.") + ' Tag demand per lecture in its drawer.</span>' +
    '</div>' +

    '<div class="x-sec"><h3>📥 Inbox / next actions <span class="x-count num">' + open.length + '</span></h3>' +
    (inbox.length ? '<div class="x-inbox">' + inbox.map(inboxRow).join("") + '</div>' : '<div class="x-inbox-empty">Captured tasks land here. Add one in the Today bar, then clarify: ★ important · 2m · → Lecture.</div>') +
    '</div>' +

    '<div class="x-sec"><h3>🧭 Urgent × important <span class="x-count num">' + (quads[1].length + quads[2].length + quads[3].length + quads[4].length) + '</span></h3>' +
    '<div class="x-eisenhower">' + quadHtml + '</div>' +
    '<p class="hint">Urgency comes from your real exam dates (≤7d) or a day assigned ≤2d away; importance from Must/Should. ⭐ = top-20% leverage (Pareto).</p>' +
    '</div>' +

    (paceRows ? '<div class="x-sec"><h3>📈 Pace to exam</h3><table class="x-pace-table"><thead><tr><th>Subject</th><th>Done</th><th>Exam</th><th>Needed</th><th></th></tr></thead><tbody>' + paceRows + '</tbody></table></div>' : "");
}

const RITUAL = [
  { k: "inbox", t: "Empty the capture inbox", s: "Clarify every captured task → lecture, schedule or delete.", go: null },
  { k: "untimed", t: "Give every lecture a time", s: "Untimed slots can’t be auto-planned or exported.", go: { action: "apply-view", id: "v-untimed", label: "⏳ Needs a time" } },
  { k: "recalls", t: "Clear overdue recalls", s: "Leitner boxes only consolidate if you actually show up.", go: { action: "tab", v: "reviews", label: "↻ Reviews" } },
  { k: "pace", t: "Check pace to each exam", s: "Behind? Raise Must count or shrink estimates.", go: { action: "tab", v: "matrix", label: "▦ Matrix" } },
  { k: "plan", t: "Block next week’s deep work", s: "⚡ Auto-plan with interleave + energy on, then hand-adjust.", go: { action: "tab", v: "week", label: "🗓 Week" } }
];

function renderReviewSheet() {
  const body = $("#x-rev-body"); if (!body) return;
  const rv = S.plan.review || (S.plan.review = { last: null, checks: {}, lapses: 0 });

  const undone = S.plan.lectures.filter((l) => l.status !== "done");
  const totalRemain = undone.reduce((s, l) => s + l.est, 0);
  const nearest = S.courseList.map((c) => examDaysFor(c.id)).filter((d) => d != null).sort((a, b) => a - b)[0];
  const weeks = nearest != null ? Math.max(1, Math.ceil(nearest / 7)) : null;
  const perWeek = weeks != null ? Math.ceil(totalRemain / weeks / 60) * 60 : null; // hours, rounded up
  const behind = S.courseList.filter((c) => paceFor(c.id)?.behind).length;
  const untimed = S.plan.lectures.filter((l) => !l.est && l.status !== "done").length;
  const q = reviewQueue();
  const overdue = q.due.filter((x) => x.over).length;

  const counts = { inbox: openInboxCount(), untimed, recalls: q.due.length, pace: behind, plan: 0 };

  const data = auditDays(7);
  const max = Math.max(60, ...data.map((d) => d.min));
  const audit = data.map((d) =>
    '<div class="x-audit-col"><div class="x-audit-bar' + (d.today ? " today" : "") + (d.min === 0 ? " zero" : "") + '" style="height:' + Math.max(3, Math.round(d.min / max * 100)) + '%" title="' + d.iso + " · " + fmtMin(d.min) + '"></div><span class="x-audit-lbl">' + d.lbl + '</span></div>'
  ).join("");

  const checks = RITUAL.map((r) => {
    const done = !!rv.checks[r.k];
    const n = counts[r.k];
    const goBtn = r.go ? '<button type="button" class="btn sm ghost x-go" data-action="' + r.go.action + '"' + (r.go.id ? ' data-id="' + r.go.id + '"' : "") + (r.go.v ? ' data-v="' + r.go.v + '"' : "") + '>' + r.go.label + '</button>' : "";
    return '<label class="x-check' + (done ? " done" : "") + '"><input type="checkbox" ' + (done ? "checked " : "") + 'data-action="x-check" data-k="' + r.k + '"/>' +
      '<span class="t"><b>' + r.t + (n ? ' <span class="x-count num">' + n + '</span>' : "") + '</b><span>' + r.s + '</span></span>' + goBtn + '</label>';
  }).join("");

  body.innerHTML =
    '<div class="x-pace">' +
    '<div class="x-pace-cell"><div class="v num">' + fmtMin(totalRemain) + '</div><div class="k">remaining</div></div>' +
    '<div class="x-pace-cell"><div class="v num ' + (nearest == null ? "" : nearest <= 3 ? "red" : nearest <= 7 ? "amber" : "green") + '">' + (nearest != null ? nearest + "d" : "—") + '</div><div class="k">to nearest exam</div></div>' +
    '<div class="x-pace-cell"><div class="v num">' + (perWeek != null ? (perWeek / 60) + "h" : "—") + '</div><div class="k">per week to finish</div></div>' +
    '<div class="x-pace-cell"><div class="v num ' + (behind ? "red" : "green") + '">' + behind + '</div><div class="k">subjects behind</div></div>' +
    '</div>' +

    '<div class="x-sec"><h3>⏱ Time audit — last 7 days <span class="x-count num">' + fmtMin(weekMinutes()) + ' this week</span></h3>' +
    '<div class="x-audit">' + audit + '</div>' +
    '<p class="hint">Bars are real logged minutes (focus sessions + 2-minute wins). Streak <b class="num">🔥 ' + streakDays() + 'd</b>' + (rv.lapses ? ' · lapses <b class="num">' + rv.lapses + '</b>' : "") + '</p></div>' +

    '<div class="x-sec"><h3>✅ Review ritual</h3><div class="x-checklist">' + checks + '</div></div>';

  $("#x-last-reviewed").textContent = rv.last ? "Last reviewed " + rv.last : "Not reviewed yet — do it weekly";
}

export function checkRitual(k) {
  const rv = S.plan.review || (S.plan.review = { last: null, checks: {}, lapses: 0 });
  rv.checks[k] = !rv.checks[k];
  savePlan(); renderSheet("x-review"); renderHub();
}
export function markReviewed() {
  const rv = S.plan.review || (S.plan.review = { last: null, checks: {}, lapses: 0 });
  rv.last = S.today;
  savePlan(); renderAll();
  toast("Weekly review logged", { kind: "success" });
}

/* ---------- drawer ---------- */
let lastFocus = null;

export function openDrawer(id, create) {
  S.ui.drawer = { id: id || null, create: create || null };
  lastFocus = document.activeElement;
  const l = id ? byId(id) : null;
  const cid = l ? l.c : create.c;
  const model = l || { c: cid, num: create.num, title: "", est: 0, pri: "should", status: "todo", day: null, notes: "", actual: 0, sessions: [], reviews: null, demand: "medium" };
  const d = $("#drawer");
  d.style.setProperty("--cc", courseColor(cid));
  d.style.setProperty("--ct", tint(courseColor(cid), "14"));

  const dayOpts = '<option value="">Unassigned</option>' + weekDates().map((x) =>
    '<option value="' + x + '"' + (model.day === x ? " selected" : "") + '>' + WDL[wdIndex(x)] + " · " + md(x) + '</option>'
  ).join("");

  let revHtml = "";
  if (model.reviews) {
    revHtml = '<div class="field"><label>Leitner ladder</label><div class="rev-timeline">';
    model.reviews.forEach((r, i) => {
      const pillCls = r.done ? "done" : (r.due <= S.today ? "due" : "");
      const suffix = r.done ? " ✓" : (r.due <= S.today ? " due" : "");
      revHtml += '<span class="rev-pill ' + pillCls + '">B' + (r.box ?? i + 1) + " · " + md(r.due) + suffix + '</span>';
    });
    revHtml += '</div></div>';
  }

  let sessHtml = "";
  if (model.sessions && model.sessions.length) {
    sessHtml = '<div class="field"><label>Focus sessions</label><div class="sess-log">';
    model.sessions.slice(-6).reverse().forEach((s) => {
      sessHtml += '<div><span>' + md(s.date) + " " + s.at + '</span><b class="num">' + s.min + ' min</b></div>';
    });
    sessHtml += '</div></div>';
  }

  const estOut = model.est ? fmtMin(model.est) : "not set";
  const sug = suggestEst(model.c);
  const sugNote = sug ? '<span class="hint">median for this subject: <b class="num">' + fmtMin(sug) + '</b></span>' : '<span class="hint">no timed lectures in this subject yet</span>';
  const actualPct = model.est ? Math.min(100, (model.actual || 0) / model.est * 100) : 0;
  const actualNote = fmtMin(model.actual || 0) + ' focused of ' + (model.est ? fmtMin(model.est) : "no estimate");
  const pace = paceFor(model.c);
  const paceNote = pace ? '<div class="mini-note num">' + (pace.behind ? "⚠ behind pace — " : "✓ on pace — ") + pace.remaining + " left · exam " + pace.daysTo + "d · need " + pace.perWeek + "/wk</div>" : "";

  d.innerHTML =
    '<div class="drawer-h"><span class="swatch"></span><h2 id="drawer-title">' + (l ? "Edit lecture" : "New lecture") + '</h2><button type="button" class="x" data-action="close-drawer" aria-label="Close">✕</button></div>' +
    '<div class="drawer-b">' +
    '<div class="f2"><div class="field"><label for="d-course">Subject</label><select id="d-course">' +
    S.courseList.map((x) => '<option value="' + esc(x.id) + '"' + (x.id === model.c ? " selected" : "") + '>' + esc(courseTitle(x.id)) + '</option>').join("") + '</select></div>' +
    '<div class="field"><label for="d-num">Lecture № (1–' + LECTURES_PER_SUBJECT + ')</label><input type="number" id="d-num" min="1" max="' + LECTURES_PER_SUBJECT + '" value="' + model.num + '"/></div></div>' +
    '<div class="field"><label for="d-title">Topic (optional — blank is fine)</label><input type="text" id="d-title" value="' + esc(model.title || "") + '" placeholder="e.g. Autonomic ganglia & NMJ"/></div>' +
    '<div class="field"><label>How long will it take? <span class="hint">leave at 0 until you know</span></label><div class="est-row"><input type="range" id="d-est" min="0" max="300" step="5" value="' + (model.est || 0) + '"/><output id="d-est-out" class="num">' + estOut + '</output></div>' + sugNote + paceNote + '</div>' +
    '<div class="f2"><div class="field"><label>Priority</label><div class="pri-seg" id="d-pri">' +
    ["must", "should", "could"].map((p) => '<button type="button" class="' + p + '" data-action="d-pri" data-v="' + p + '" aria-pressed="' + (model.pri === p) + '">' + p + '</button>').join("") + '</div></div>' +
    '<div class="field"><label>Status</label><div class="stat-seg" id="d-status">' +
    [["todo", "To do"], ["doing", "Doing"], ["done", "Done"]].map((s) => '<button type="button" class="' + s[0] + '" data-action="d-status" data-v="' + s[0] + '" aria-pressed="' + (model.status === s[0]) + '">' + s[1] + '</button>').join("") + '</div></div></div>' +
    '<div class="field"><label>Focus demand <span class="hint">deep = book it in your peak hours</span></label><div class="dem-seg" id="d-demand">' +
    ["deep", "medium", "light"].map((p) => '<button type="button" class="' + p + '" data-action="d-demand" data-v="' + p + '" aria-pressed="' + ((model.demand || "medium") === p) + '">' + p + '</button>').join("") + '</div></div>' +
    '<div class="field"><label for="d-day">Planned day (this planning week)</label><select id="d-day">' + dayOpts + '</select></div>' +
    '<div class="field"><label>Actual vs estimate</label><div class="actual-bar"><i style="width:' + actualPct + '%"></i></div><div class="mini-note num">' + actualNote + '</div></div>' +
    revHtml + sessHtml +
    '<div class="field"><label for="d-notes">Notes</label><textarea id="d-notes" placeholder="Key points, page refs, things to re-check…">' + esc(model.notes || "") + '</textarea></div></div>' +
    '<div class="drawer-f">' + (l ? '<button type="button" class="btn danger" data-action="delete-lecture" data-id="' + l.id + '">Delete</button>' : '') +
    '<span class="grow"></span>' +
    (l && l.day ? '<button type="button" class="btn" data-action="gcal-single" data-id="' + l.id + '" title="Opens Google Calendar with this lecture pre-filled">📅 Google Calendar</button>' : '') +
    (l && l.status !== "done" ? '<button type="button" class="btn" data-action="focus-this" data-id="' + l.id + '">🎯 Focus now</button>' : '') +
    '<button type="button" class="btn primary" data-action="save-drawer">' + (l ? "Save changes" : "Add lecture") + '</button></div>';

  $("#scrim").hidden = false;
  d.hidden = false;
  requestAnimationFrame(() => { $("#scrim").classList.add("show"); d.classList.add("show"); });

  $("#d-est").addEventListener("input", (e) => { $("#d-est-out").textContent = +e.target.value ? fmtMin(+e.target.value) : "not set"; });
  $("#d-course").addEventListener("change", (e) => {
    d.style.setProperty("--cc", courseColor(e.target.value));
    d.style.setProperty("--ct", tint(courseColor(e.target.value), "14"));
  });
  setTimeout(() => $("#d-title").focus(), 120);
}

export function closeDrawer() {
  const d = $("#drawer");
  d.classList.remove("show");
  $("#scrim").classList.remove("show");
  setTimeout(() => { d.hidden = true; $("#scrim").hidden = true; }, 280);
  S.ui.drawer = null;
  if (lastFocus && lastFocus.focus) lastFocus.focus();
}

export function commitDrawer() {
  const dr = S.ui.drawer;
  if (!dr) return;
  const l = dr.id ? byId(dr.id) : null;
  const m = Object.assign({}, l || { id: null, actual: 0, sessions: [], reviews: null, completedAt: null, order: 99 }, {
    c: $("#d-course").value,
    num: Math.min(LECTURES_PER_SUBJECT, Math.max(1, +$("#d-num").value || 1)),
    title: $("#d-title").value.trim(),
    est: +$("#d-est").value || 0,
    notes: $("#d-notes").value,
    day: $("#d-day").value || null,
    pri: $("#d-pri [aria-pressed=true]").dataset.v,
    status: $("#d-status [aria-pressed=true]").dataset.v,
    demand: ($("#d-demand [aria-pressed=true]") || {}).dataset?.v || "medium"
  });

  snapshot(l ? "edit lecture" : "add lecture");
  if (m.status === "done" && !m.completedAt) markDone(m);
  if (m.status !== "done") unDone(m);

  if (l) {
    if (m.day !== l.day && m.day) {
      m.order = Math.max(0, ...S.plan.lectures.filter((x) => x.day === m.day && x.id !== l.id).map((x) => x.order)) + 1;
    }
    Object.assign(l, m);
  } else {
    m.id = "l" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    if (m.day) m.order = Math.max(0, ...S.plan.lectures.filter((x) => x.day === m.day).map((x) => x.order)) + 1;
    S.plan.lectures.push(m);
  }

  savePlan();
  renderAll();
  closeDrawer();
  toast(l ? "Saved" : "Lecture added", { kind: "success", undo: true });
}
