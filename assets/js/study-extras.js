// College Scheduler — Study extras (Today hub · Prioritize · Weekly review).
// Self-contained: reads the app's rendered DOM (known classes) and keeps its own
// data in localStorage under `csx.v1`. Never writes to the app's store, never
// assumes study-app.js internals. All DOM reads are guarded and degrade gracefully.

const NS = "csx.v1";
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const iso = (d = new Date()) => { const x = new Date(d); const m = String(x.getMonth()+1).padStart(2,"0"); const day = String(x.getDate()).padStart(2,"0"); return `${x.getFullYear()}-${m}-${day}`; };
const todayISO = () => iso();
const daysBetween = (aISO, bISO) => { const a = new Date(aISO+"T00:00:00"), b = new Date(bISO+"T00:00:00"); return Math.round((b - a) / 86400000); };
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

const DEFAULTS = { inbox: [], demand: {}, review: { last: null, checks: {} }, log: {}, interleave: true, softTarget: 120 };

function load() {
  try { const raw = JSON.parse(localStorage.getItem(NS) || "{}"); return { ...DEFAULTS, ...raw, review: { ...DEFAULTS.review, ...(raw.review || {}) } }; }
  catch { return { ...DEFAULTS }; }
}
function save() { try { localStorage.setItem(NS, JSON.stringify(store)); } catch {} }
let store = load();

/* ---------------- DOM scanning (the app's own rendered output) ---------------- */
function scanSubjectsAndExams() {
  // subject -> nearest exam days, parsed from the app's exam chips
  const subjExam = new Map();
  const chips = $$("#s-exam-chips .s-exam-chip");
  const lecSubs = $$("#lib-list .lec-sub").map((e) => e.textContent.trim()).filter(Boolean);
  chips.forEach((chip) => {
    const dEl = chip.querySelector(".d");
    const days = dEl ? parseInt(String(dEl.textContent).replace(/[^0-9]/g, ""), 10) : NaN;
    if (!Number.isFinite(days)) return;
    const txt = chip.textContent.toLowerCase();
    let matched = null;
    for (const s of lecSubs) { if (s && txt.includes(s.toLowerCase())) { matched = s; break; } }
    if (!matched) { // fall back: first subject word in chip text
      const m = chip.textContent.match(/([A-Za-z][A-Za-z .'-]{3,}?)(?:·|\d|$)/);
      if (m) matched = m[1].trim();
    }
    if (matched) {
      const prev = subjExam.get(matched);
      if (prev == null || days < prev) subjExam.set(matched, days);
    }
  });
  return subjExam;
}

function scanLectures(subjExam) {
  const cards = $$("#lib-list .lec-card");
  return cards.map((card) => {
    const subject = (card.querySelector(".lec-sub")?.textContent || "").trim();
    const title = (card.querySelector(".lec-title")?.textContent || "").trim();
    const priEl = card.querySelector(".pri");
    let priority = "";
    if (priEl) { if (priEl.classList.contains("must")) priority = "must"; else if (priEl.classList.contains("should")) priority = "should"; else if (priEl.classList.contains("could")) priority = "could"; }
    const stEl = card.querySelector(".st-dot");
    let status = "todo";
    if (stEl) { if (stEl.classList.contains("st-done")) status = "done"; else if (stEl.classList.contains("st-doing")) status = "doing"; }
    const examDays = subject && subjExam.has(subject) ? subjExam.get(subject) : null;
    return { kind: "lecture", id: "L:" + subject + "|" + title, subject, title: title || subject, priority, status, examDays };
  }).filter((l) => l.subject || l.title);
}

function readWindow() {
  const s = $("#t-win-start")?.value || "";
  const e = $("#t-win-end")?.value || "";
  const toMin = (t) => { const m = /^(\d{1,2}):(\d{2})/.exec(t || ""); return m ? (+m[1]) * 60 + (+m[2]) : null; };
  return { start: toMin(s), end: toMin(e), startStr: s, endStr: e };
}

/* ---------------- Scoring / classification ---------------- */
function urgencyOf(item) {
  if (item.kind === "inbox") {
    if (item.due) { const d = daysBetween(todayISO(), item.due); return d <= 2; }
    return false;
  }
  // lecture
  if (item.examDays != null) return item.examDays <= 7;
  return item.priority === "must"; // no exam data → must is treated as urgent
}
function importanceOf(item) {
  if (item.kind === "inbox") return !!item.imp;
  return item.priority === "must" || item.priority === "should";
}
function quadrantOf(item) {
  const u = urgencyOf(item), i = importanceOf(item);
  if (u && i) return 1; if (!u && i) return 2; if (u && !i) return 3; return 4;
}
function defaultDemand(priority) { return priority === "must" ? "deep" : priority === "could" ? "light" : "medium"; }
function demandOf(subject, lectures) {
  if (store.demand[subject]) return store.demand[subject];
  const l = lectures.find((x) => x.subject === subject);
  return defaultDemand(l ? l.priority : "should");
}

function spread(list) { // interleave: avoid consecutive same-subject
  const pool = [...list]; const out = []; let last = null;
  while (pool.length) {
    let idx = pool.findIndex((x) => x.subject !== last);
    if (idx === -1) idx = 0;
    const it = pool.splice(idx, 1)[0]; out.push(it); last = it.subject;
  }
  return out;
}
function groupBySubject(list) { // block: cluster same subject
  return [...list].sort((a, b) => (a.subject || "").localeCompare(b.subject || ""));
}
function orderList(list) { return store.interleave ? spread(list) : groupBySubject(list); }

function frogCandidate(lectures) {
  const undoneL = lectures.filter((l) => l.status !== "done");
  const openInbox = store.inbox.filter((t) => !t.done);
  const scoreL = (l) => (l.examDays != null ? 30 - clamp(l.examDays, 0, 30) : 8) + (l.priority === "must" ? 30 : l.priority === "should" ? 14 : 4);
  const scoreI = (t) => (t.due ? (daysBetween(todayISO(), t.due) < 0 ? 40 : clamp(30 - daysBetween(todayISO(), t.due), 0, 30)) : 0) + (t.imp ? 26 : 4) + (t.two ? 6 : 0);
  let best = null, bestScore = -1, bestKind = null;
  undoneL.forEach((l) => { const s = scoreL(l); if (s > bestScore) { bestScore = s; best = l; bestKind = "lecture"; } });
  openInbox.forEach((t) => { const s = scoreI(t); if (s > bestScore) { bestScore = s; best = t; bestKind = "inbox"; } });
  return best ? { item: best, kind: bestKind } : null;
}

/* ---------------- Streak / log / audit ---------------- */
function logAdd(n) { const d = todayISO(); store.log[d] = clamp((store.log[d] || 0) + n, 0, 1440); save(); }
function streak() {
  const days = new Set(Object.keys(store.log).filter((k) => store.log[k] > 0));
  let n = 0; let cur = new Date();
  if (!days.has(iso(cur))) cur.setDate(cur.getDate() - 1); // allow "today not yet logged"
  while (days.has(iso(cur))) { n++; cur.setDate(cur.getDate() - 1); }
  return n;
}
function last7() {
  const out = []; const base = new Date();
  for (let i = 6; i >= 0; i--) { const d = new Date(base); d.setDate(base.getDate() - i); out.push({ iso: iso(d), lbl: ["S","M","T","W","T","F","S"][d.getDay()], min: store.log[iso(d)] || 0, today: i === 0 }); }
  return out;
}
function weekTotal() {
  const d = new Date(); const dow = (d.getDay() + 6) % 7; // Mon=0
  const mon = new Date(d); mon.setDate(d.getDate() - dow);
  let sum = 0; for (let i = 0; i < 7; i++) { const x = new Date(mon); x.setDate(mon.getDate() + i); sum += store.log[iso(x)] || 0; }
  return sum;
}

/* ---------------- Pace (backward planning) ---------------- */
function pace(lectures, subjExam) {
  const total = lectures.length;
  const done = lectures.filter((l) => l.status === "done").length;
  const remaining = total - done;
  const examVals = [...subjExam.values()];
  const nearest = examVals.length ? Math.min(...examVals) : null;
  const weeksLeft = nearest != null ? Math.max(1, Math.ceil(nearest / 7)) : null;
  const perWeek = nearest != null ? Math.ceil(remaining / weeksLeft) : null;
  return { total, done, remaining, nearest, weeksLeft, perWeek };
}

/* ---------------- Rendering ---------------- */
function renderHub(lectures, subjExam) {
  const stats = $("#x-hub-stats"); const frogBox = $("#x-frog"); const frogTxt = $("#x-frog-txt"); const frogAct = $("#x-frog-act");
  const openInbox = store.inbox.filter((t) => !t.done).length;
  const todayMin = store.log[todayISO()] || 0;
  const p = pace(lectures, subjExam);
  const examTxt = p.nearest != null ? `${p.nearest}d` : "—";
  const examCls = p.nearest == null ? "" : p.nearest <= 3 ? "warn" : p.nearest <= 7 ? "" : "ok";

  if (stats) stats.innerHTML =
    `<span>📥 <b>${openInbox}</b> inbox</span>` +
    `<span>⏳ exam <b class="${examCls}">${examTxt}</b></span>` +
    `<span>⏱ <b>${todayMin}</b>m today</span>` +
    `<span>📚 <b>${p.remaining}</b> left</span>`;

  const f = frogCandidate(lectures);
  if (frogBox && frogTxt) {
    if (!f) { frogTxt.textContent = "Nothing queued — capture a task above."; frogTxt.classList.add("muted"); if (frogAct) frogAct.hidden = true; }
    else {
      frogTxt.classList.remove("muted");
      if (f.kind === "inbox") { frogTxt.textContent = f.item.text; if (frogAct) { frogAct.hidden = false; frogAct.textContent = "Do"; frogAct.dataset.xaction = "frog-do"; frogAct.dataset.id = f.item.id; } }
      else { frogTxt.textContent = `${f.item.subject}${f.item.title && f.item.title !== f.item.subject ? " · " + f.item.title : ""}`; if (frogAct) { frogAct.hidden = false; frogAct.textContent = "Open"; frogAct.dataset.xaction = "frog-open"; } }
    }
  }

  const sk = $("#x-streak"); const n = streak();
  if (sk) { sk.textContent = `🔥 ${n}`; sk.classList.toggle("zero", n === 0); }

  const nud = $("#x-review-nudge");
  if (nud) { const stale = !store.review.last || daysBetween(store.review.last, todayISO()) >= 7; nud.hidden = !stale; }
}

function taskRow(t) {
  const overdue = t.due && !t.done && daysBetween(todayISO(), t.due) < 0;
  const cls = ["x-task", t.done ? "done" : "", t.imp ? "imp" : "", t.two ? "two" : ""].filter(Boolean).join(" ");
  return `<div class="${cls}" data-id="${esc(t.id)}">
    <input class="x-task-check" type="checkbox" ${t.done ? "checked" : ""} data-xaction="task-toggle" data-id="${esc(t.id)}" aria-label="Complete" />
    <span class="x-task-txt">${esc(t.text)}</span>
    <span class="x-task-meta">
      ${t.imp ? '<span class="x-task-badge star">★</span>' : ""}
      ${t.two ? '<span class="x-task-badge two">2m</span>' : ""}
      ${t.ctx ? `<span class="x-task-badge ctx">${esc(t.ctx)}</span>` : ""}
      <input class="x-task-due ${overdue ? "overdue" : ""}" type="date" value="${esc(t.due || "")}" data-xaction="task-due" data-id="${esc(t.id)}" aria-label="Due date" />
      <button class="x-task-x" type="button" data-xaction="task-del" data-id="${esc(t.id)}" aria-label="Delete">✕</button>
    </span>
  </div>`;
}

function renderInbox() {
  const box = $("#x-inbox"); const cnt = $("#x-inbox-count");
  if (!box) return;
  const items = [...store.inbox].sort((a, b) => (a.done - b.done) || ((a.due || "9999") < (b.due || "9999") ? -1 : 1));
  if (cnt) cnt.textContent = String(store.inbox.filter((t) => !t.done).length);
  box.innerHTML = items.length ? items.map(taskRow).join("") : `<div class="x-inbox-empty">Captured tasks land here. Add one in the Today bar above.</div>`;
}

function renderEnergy(lectures) {
  const box = $("#x-energy"); if (!box) return;
  const subjects = [...new Set(lectures.map((l) => l.subject).filter(Boolean))].sort();
  if (!subjects.length) { box.innerHTML = `<span class="hint">Load your cohort to tag subject demand.</span>`; return; }
  box.innerHTML = subjects.map((s) => {
    const d = demandOf(s, lectures);
    const col = d === "deep" ? "#d93025" : d === "light" ? "#188038" : "#e37400";
    const seg = ["deep","medium","light"].map((lv) => `<button type="button" class="${lv}" aria-pressed="${d === lv}" data-xaction="demand" data-subj="${esc(s)}" data-v="${lv}">${lv[0].toUpperCase()}</button>`).join("");
    return `<span class="x-energy-chip" style="--ec:${col}"><span class="sw"></span><span class="nm" title="${esc(s)}">${esc(s)}</span><span class="x-energy-seg">${seg}</span></span>`;
  }).join("");
}

function qItemHTML(it, starred) {
  if (it.kind === "inbox") return `<div class="x-qitem inbox"><span class="qt">${starred ? '<span class="star">★</span> ' : ""}${esc(it.text)}</span>${it.due ? `<span class="qs">${esc(it.due.slice(5))}</span>` : ""}</div>`;
  const col = demandOf(it.subject, []) === "deep" ? "#d93025" : demandOf(it.subject, []) === "light" ? "#188038" : "#e37400";
  return `<div class="x-qitem lecture" style="--lc:${col}"><span class="qt">${starred ? '<span class="star">★</span> ' : ""}${esc(it.title || it.subject)}</span>${it.priority ? `<span class="qp ${it.priority}">${it.priority}</span>` : ""}${it.examDays != null ? `<span class="qs">${it.examDays}d</span>` : ""}</div>`;
}

function renderEisenhower(lectures) {
  const box = $("#x-eisenhower"); if (!box) return;
  const cand = [
    ...lectures.filter((l) => l.status !== "done"),
    ...store.inbox.filter((t) => !t.done).map((t) => ({ ...t, kind: "inbox" })),
  ];
  const buckets = { 1: [], 2: [], 3: [], 4: [] };
  cand.forEach((it) => buckets[quadrantOf(it)].push(it));
  Object.values(buckets).forEach((b) => { b.sort((a, z) => (a.examDays ?? 99) - (z.examDays ?? 99)); });
  // Pareto: top ~20% of Q1 = high leverage
  const q1 = orderList(buckets[1]); const starN = q1.length ? Math.max(1, Math.ceil(q1.length * 0.2)) : 0;
  const labels = { 1: ["Do now", "q1"], 2: ["Schedule", "q2"], 3: ["Batch", "q3"], 4: ["Drop / later", "q4"] };
  const order = { 1: q1, 2: orderList(buckets[2]), 3: buckets[3], 4: buckets[4] };
  box.innerHTML = [1,2,3,4].map((q) => {
    const list = order[q];
    const body = list.length
      ? list.map((it, i) => qItemHTML(it, q === 1 && i < starN)).join("")
      : `<div class="x-quad-empty">Empty</div>`;
    return `<div class="x-quad ${labels[q][1]}"><div class="x-quad-h">${labels[q][0]}<span class="n">${list.length}</span></div><div class="x-quad-b">${body}</div></div>`;
  }).join("");
}

function renderPeakTip() {
  const el = $("#x-peak-tip"); if (!el) return;
  const w = readWindow();
  if (w.start == null || w.end == null || w.end <= w.start) { el.innerHTML = `Tag each subject’s demand, then <b>interleave</b> to mix subjects in one session.`; return; }
  const fmt = (m) => `${String(Math.floor(m/60)).padStart(2,"0")}:${String(m%60).padStart(2,"0")}`;
  const mid = Math.round((w.start + (w.end - w.start) * 0.4) / 15) * 15;
  el.innerHTML = `Your window <b>${fmt(w.start)}–${fmt(w.end)}</b> → put <b>Deep</b> work before <b>${fmt(mid)}</b>, <b>Light</b> after.`;
}

function renderPace(lectures, subjExam) {
  const el = $("#x-pace"); if (!el) return;
  const p = pace(lectures, subjExam);
  const cls = (n) => (n == null ? "" : n <= 3 ? "red" : n <= 7 ? "amber" : "green");
  el.innerHTML =
    `<div class="x-pace-cell"><div class="v ${cls(p.remaining)}">${p.remaining}</div><div class="k">lectures left</div></div>` +
    `<div class="x-pace-cell"><div class="v ${cls(p.nearest)}">${p.nearest != null ? p.nearest + "d" : "—"}</div><div class="k">to nearest exam</div></div>` +
    `<div class="x-pace-cell"><div class="v">${p.perWeek != null ? p.perWeek : "—"}</div><div class="k">to finish / week</div></div>` +
    `<div class="x-pace-cell"><div class="v green">${p.done}</div><div class="k">done</div></div>`;
}

function renderAudit() {
  const el = $("#x-audit"); const tot = $("#x-audit-total"); if (!el) return;
  const data = last7(); const max = Math.max(store.softTarget, ...data.map((d) => d.min), 30);
  el.innerHTML = data.map((d) => {
    const h = Math.round((d.min / max) * 100);
    return `<div class="x-audit-col"><div class="x-audit-bar ${d.today ? "today" : ""} ${d.min === 0 ? "zero" : ""}" style="height:${clamp(h,3,100)}%" title="${d.iso}: ${d.min}m"></div><span class="x-audit-lbl">${d.lbl}</span></div>`;
  }).join("");
  if (tot) tot.innerHTML = `This week <b>${weekTotal()}m</b> · soft target <b>${store.softTarget}m</b>/school‑day`;
}

const RITUAL = [
  { k: "clear", t: "Empty the capture inbox", s: "Process every captured task into the matrix or delete it." },
  { k: "upcoming", t: "Scan exams in the next 2 weeks", s: "Confirm dates and bump affected subjects to Deep." },
  { k: "stuck", t: "Review anything “Doing” for days", s: "Finish, split, or drop stalled lecture slots." },
  { k: "totals", t: "Check progress % and weekly pace", s: "Is your per‑week rate realistic before the exam?" },
  { k: "plan", t: "Block next week’s deep work", s: "Use ⚡ Auto‑plan, then hand‑adjust your peak hours." },
];
function renderChecklist() {
  const el = $("#x-checklist"); if (!el) return;
  el.innerHTML = RITUAL.map((r) => {
    const done = !!store.review.checks[r.k];
    return `<label class="x-check ${done ? "done" : ""}"><input type="checkbox" ${done ? "checked" : ""} data-xaction="check" data-k="${r.k}" /><span class="t"><b>${r.t}</b><span>${r.s}</span></span></label>`;
  }).join("");
  const lr = $("#x-last-reviewed");
  if (lr) lr.textContent = store.review.last ? `Last reviewed ${store.review.last}` : "Not reviewed yet";
}

function renderPrioritize(lectures, subjExam) {
  renderInbox(); renderEnergy(lectures); renderEisenhower(lectures); renderPeakTip();
}
function renderReview(lectures, subjExam) {
  renderPace(lectures, subjExam); renderAudit(); renderChecklist();
}

/* ---------------- Sheet open/close (mirrors the app's hidden+.show pattern) ---- */
let openId = null;
function openSheet(id) {
  const sheet = $("#" + id); const scrim = $("#x-scrim"); if (!sheet) return;
  closeSheet(true);
  openId = id; sheet.hidden = false; scrim.hidden = false;
  requestAnimationFrame(() => { sheet.classList.add("show"); scrim.classList.add("show"); });
  const lectures = currentLectures(); const subjExam = scanSubjectsAndExams();
  if (id === "x-prioritize") renderPrioritize(lectures, subjExam);
  if (id === "x-review") renderReview(lectures, subjExam);
}
function closeSheet(immediate) {
  const scrim = $("#x-scrim");
  if (openId) { const sheet = $("#" + openId); if (sheet) { sheet.classList.remove("show"); if (immediate) sheet.hidden = true; else setTimeout(() => { if (openId == null) sheet.hidden = true; }, 300); } }
  if (scrim) { scrim.classList.remove("show"); if (immediate) scrim.hidden = true; else setTimeout(() => { if (openId == null) scrim.hidden = true; }, 300); }
  openId = null;
}

let cache = { lectures: [], subjExam: new Map() };
function currentLectures() { cache.subjExam = scanSubjectsAndExams(); cache.lectures = scanLectures(cache.subjExam); return cache.lectures; }
function refresh() { const l = currentLectures(); renderHub(l, cache.subjExam); if (openId === "x-prioritize") renderPrioritize(l, cache.subjExam); if (openId === "x-review") renderReview(l, cache.subjExam); }

/* ---------------- Events ---------------- */
function addTask(text, imp, two, ctx, due) {
  const t = String(text || "").trim(); if (!t) return;
  store.inbox.unshift({ id: uid(), text: t, imp: !!imp, two: !!two, ctx: ctx || "", due: due || "", done: false, doneAt: null });
  save();
}
function toggleTask(id) {
  const t = store.inbox.find((x) => x.id === id); if (!t) return;
  t.done = !t.done; t.doneAt = t.done ? new Date().toISOString() : null;
  if (t.two) logAdd(t.done ? 2 : -2); // 2‑minute rule feeds the streak/audit
  save(); refresh();
}
function delTask(id) { store.inbox = store.inbox.filter((x) => x.id !== id); save(); refresh(); }
function setDue(id, val) { const t = store.inbox.find((x) => x.id === id); if (t) { t.due = val || ""; save(); refresh(); } }
function setDemand(subj, lv) { store.demand[subj] = lv; save(); refresh(); }
function toggleInterleave() { store.interleave = !store.interleave; save(); const b = $("#x-interleave"); if (b) b.setAttribute("aria-pressed", String(store.interleave)); refresh(); }
function markReviewed() { store.review.last = todayISO(); RITUAL.forEach((r) => { if (store.review.checks[r.k]) store.review.checks[r.k + "At"] = new Date().toISOString(); }); save(); refresh(); }
function toggleCheck(k) { store.review.checks[k] = !store.review.checks[k]; save(); renderChecklist(); }
function openInPlan() { closeSheet(); const b = $('.s-tab[data-v="matrix"]'); if (b) b.click(); }

document.addEventListener("submit", (e) => {
  if (e.target && e.target.id === "x-capture-form") {
    e.preventDefault();
    const inp = $("#x-capture"); const imp = $("#x-cap-imp")?.getAttribute("aria-pressed") === "true";
    const two = $("#x-cap-2min")?.getAttribute("aria-pressed") === "true"; const ctx = $("#x-cap-ctx")?.value || "";
    addTask(inp?.value, imp, two, ctx, "");
    if (inp) { inp.value = ""; inp.closest(".x-capture")?.classList.add("flash"); setTimeout(() => inp.closest(".x-capture")?.classList.remove("flash"), 450); }
    $("#x-cap-imp")?.setAttribute("aria-pressed", "false"); $("#x-cap-2min")?.setAttribute("aria-pressed", "false"); $("#x-cap-ctx") && ($("#x-cap-ctx").value = "");
    refresh();
  }
});

document.addEventListener("click", (e) => {
  const t = e.target.closest("[data-xaction]"); if (!t) {
    if (e.target.id === "x-scrim") closeSheet();
    return;
  }
  const a = t.dataset.xaction;
  if (a === "open-prioritize") openSheet("x-prioritize");
  else if (a === "open-review") openSheet("x-review");
  else if (a === "close") closeSheet();
  else if (a === "open-plan") openInPlan();
  else if (a === "frog-do") { toggleTask(t.dataset.id); }
  else if (a === "frog-open") openInPlan();
  else if (a === "task-toggle") toggleTask(t.dataset.id);
  else if (a === "task-del") delTask(t.dataset.id);
  else if (a === "demand") setDemand(t.dataset.subj, t.dataset.v);
  else if (a === "check") toggleCheck(t.dataset.k);
  else if (a === "mark-reviewed") markReviewed();
  else if (a === "log") { logAdd(parseInt(t.dataset.n, 10) || 0); refresh(); }
  else if (t.id === "x-interleave" || t.closest("#x-interleave")) toggleInterleave();
});
document.addEventListener("click", (e) => { if (e.target.closest("#x-interleave")) toggleInterleave(); });
document.addEventListener("change", (e) => {
  const t = e.target.closest("[data-xaction]"); if (!t) return;
  if (t.dataset.xaction === "task-due") setDue(t.dataset.id, t.value);
});
// capture flag toggles (also match the generic delegation above via id)
document.addEventListener("click", (e) => {
  const f = e.target.closest("#x-cap-imp, #x-cap-2min"); if (!f) return;
  f.setAttribute("aria-pressed", f.getAttribute("aria-pressed") === "true" ? "false" : "true");
});

/* ---------------- Boot + live sync with the app's async rendering --------------- */
function boot() {
  const il = $("#x-interleave"); if (il) il.setAttribute("aria-pressed", String(store.interleave));
  refresh();
  // the app fetches data async; re-scan a few times + watch its containers
  [300, 1200, 2600].forEach((ms) => setTimeout(refresh, ms));
  const targets = ["#lib-list", "#s-exam-chips", "#prog-list", "#matrix-table", "#s-stats"].map((s) => $(s)).filter(Boolean);
  if (targets.length && window.MutationObserver) {
    let tid = null;
    const obs = new MutationObserver(() => { clearTimeout(tid); tid = setTimeout(refresh, 250); });
    targets.forEach((n) => obs.observe(n, { childList: true, subtree: true, characterData: true }));
  }
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && openId) closeSheet(); });
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
else boot();
