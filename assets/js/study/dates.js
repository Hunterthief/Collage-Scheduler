// ISO-safe date helpers built on the repository's recurrence primitives.
// The repo's addDays() takes a Date and returns a Date; every study module
// works in ISO strings, so all arithmetic goes through addD() here.
import {
  parseDate,
  formatDate,
  addDays,
  startOfWeek
} from "../schedule/recurrence.js";

export const addD = (iso, n) => formatDate(addDays(parseDate(iso), n));
export const weekStartOf = (iso, weekStartDay) => startOfWeek(iso, weekStartDay);
export const wdIndex = (iso) => parseDate(iso).getUTCDay();
export const daysBetween = (a, b) =>
  Math.round((parseDate(b) - parseDate(a)) / 86400000);
