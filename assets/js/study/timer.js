// Timestamp-driven pomodoro. Minutes focused are logged onto the bound
// lecture's actual time. Sounds are WebAudio chimes tied to visible events.
import { S, byId, savePlan } from "./store.js";

export const T = {
  mode: "focus", state: "idle", total: 25 * 60, elapsed: 0, endAt: null,
  cycles: 0, int: null, logged: 0, bind: null, hooks: {}
};
const RING = 2 * Math.PI * 86;
export const ringLen = RING;

let AC = null;
export function unlockAudio() {
  if (!S.plan?.settings.sound) return;
  if (!AC) { try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch { return; } }
  if (AC.state === "suspended") AC.resume();
}
function tone(f, t0, dur, type, vol) {
  if (!S.plan?.settings.sound || !AC) return;
  const o = AC.createOscillator(), g = AC.createGain();
  o.type = type || "sine"; o.frequency.value = f;
  g.gain.setValueAtTime(0.0001, AC.currentTime + t0);
  g.gain.exponentialRampToValueAtTime(vol || .15, AC.currentTime + t0 + .015);
  g.gain.exponentialRampToValueAtTime(0.0001, AC.currentTime + t0 + dur);
  o.connect(g).connect(AC.destination);
  o.start(AC.currentTime + t0); o.stop(AC.currentTime + t0 + dur + .05);
}
export const snd = {
  done() { tone(660, 0, .14); tone(880, .11, .22); },
  drop() { tone(520, 0, .08, "triangle", .1); },
  chime() { tone(523, 0, .3); tone(659, .16, .3); tone(784, .32, .5, "sine", .16); },
  tick() { tone(440, 0, .05, "square", .05); },
  undo() { tone(392, 0, .1); tone(330, .08, .14); }
};

export const modeLen = (m) => (m === "focus" ? S.plan.settings.focus : m === "short" ? S.plan.settings.short : S.plan.settings.long) * 60;
export const currentElapsed = () => T.state === "running"
  ? Math.min(T.total, Math.max(0, T.total - (T.endAt - Date.now()) / 1000))
  : T.elapsed;

export function initTimer(hooks) { T.hooks = hooks; setMode("focus"); }

export function setMode(m, manual) {
  if (manual && T.state === "running") { T.hooks.toast?.("Pause or finish the current phase first", { kind: "warn" }); return; }
  T.mode = m; T.total = modeLen(m); T.elapsed = 0; T.endAt = null; T.state = "idle"; T.logged = 0;
  clearInterval(T.int);
  T.hooks.paint?.();
}
export function start() {
  if (T.mode === "focus" && !T.bind) {
    const nxt = S.plan.lectures.find((l) => l.status !== "done");
    if (nxt) { T.bind = nxt.id; T.hooks.bind?.(); }
  }
  T.endAt = Date.now() + (T.total - T.elapsed) * 1000;
  T.state = "running";
  clearInterval(T.int); T.int = setInterval(tick, 250);
  T.hooks.paint?.(); snd.tick();
}
export function pause() {
  T.elapsed = currentElapsed(); T.state = "paused"; T.endAt = null;
  clearInterval(T.int); logFocus(false); T.hooks.paint?.();
}
export const toggle = () => (T.state === "running" ? pause() : start());
export function reset() { T.elapsed = 0; T.endAt = null; T.state = "idle"; T.logged = 0; clearInterval(T.int); T.hooks.paint?.(); }
export function skip() {
  if (T.mode === "focus" && T.state !== "idle") logFocus(true);
  clearInterval(T.int);
  if (T.mode === "focus") { T.cycles++; setMode(T.cycles % S.plan.settings.cycle === 0 ? "long" : "short"); }
  else setMode("focus");
  T.hooks.dots?.();
}
function tick() { if (currentElapsed() >= T.total) complete(); else T.hooks.paint?.(); }

function logFocus(final) {
  if (T.mode !== "focus" || !T.bind) return;
  const l = byId(T.bind); if (!l) return;
  const mins = Math.floor(currentElapsed() / 60);
  const delta = mins - T.logged;
  if (delta <= 0) return;
  l.actual = (l.actual || 0) + delta; T.logged = mins;
  const now = new Date();
  if (final || delta >= 5) {
    l.sessions = l.sessions || [];
    l.sessions.push({ date: S.today, at: String(now.getHours()).padStart(2, "0") + ":" + String(now.getMinutes()).padStart(2, "0"), min: delta });
  }
  if (l.status === "todo") l.status = "doing";
  savePlan();
  T.hooks.log?.(delta, l);
}
function complete() {
  clearInterval(T.int); T.elapsed = T.total; T.state = "idle";
  if (T.mode === "focus") {
    logFocus(true); T.cycles++; snd.chime();
    const l = T.bind ? byId(T.bind) : null;
    T.hooks.toast?.("Focus complete" + (l ? " — " + Math.round(T.total / 60) + " min logged" : "") + " 🎉", { kind: "success" });
    setMode(T.cycles % S.plan.settings.cycle === 0 ? "long" : "short");
  } else {
    snd.chime(); T.hooks.toast?.("Break over — back to it", { kind: "success" });
    setMode("focus");
  }
  T.hooks.dots?.(); T.hooks.after?.();
  if (S.plan.settings.autoStart) start(); else T.hooks.paint?.();
}
