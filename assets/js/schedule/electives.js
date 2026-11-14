import {
  parseDate,
  formatDate,
  addDays,
  weekdayName,
  isAcademicBlackoutDate
} from "./recurrence.js";

// Load every elective dataset listed in manifest.electives[].
export async function loadElectiveCatalog(loader, manifest) {
  const entries = manifest?.electives ?? [];
  const datasets = await Promise.all(
    entries.map((e) => loader.loadJson(e.path).catch(() => null))
  );
  const catalog = [];
  for (const ds of datasets) {
    if (!ds || !Array.isArray(ds.electives)) continue;
    const meta = {
      validFrom: ds.validFrom ?? null,
      validUntil: ds.validUntil ?? null,
      blackouts: ds.blackouts ?? [],
      sourceReview: ds.sourceReview ?? []
    };
    for (const el of ds.electives) catalog.push({ ...el, _meta: meta });
  }
  return catalog;
}

export function eligibleElectives(catalog, context) {
  const programId = context?.programId ?? null;
  const yearLevel = context?.yearLevel == null ? null : Number(context.yearLevel);
  return (catalog ?? []).filter((el) => {
    const programs = el.programIds ?? [];
    const levels = (el.eligibleYearLevels ?? []).map(Number);
    const programOk = programs.length === 0 || (programId != null && programs.includes(programId));
    const levelOk = levels.length === 0 || (yearLevel != null && levels.includes(yearLevel));
    return programOk && levelOk;
  });
}

// Materialize one elective's sessions across its window, honoring the blackout.
// No group/subdivision dimension: a registered student attends every printed slot.
export function buildElectiveOccurrences(elective, opts) {
  const { timezone, institutionId, locale = "en" } = opts ?? {};
  const meta = elective._meta ?? {};
  const validFrom = meta.validFrom ?? null;
  const validUntil = meta.validUntil ?? null;
  const blackouts = meta.blackouts ?? [];
  const out = [];

  if (!validFrom || !validUntil) return out;

  let cursor = validFrom;
  const end = validUntil;
  while (cursor <= end) {
    for (let i = 0; i < (elective.sessions ?? []).length; i++) {
      const s = elective.sessions[i];
      if (!s || !s.day) continue;
      if (weekdayName(cursor, timezone) !== s.day) continue;
      if (isAcademicBlackoutDate(cursor, blackouts, s.type)) continue;

      const allDay = s.allDay === true;
      out.push({
        uid: `${institutionId}:${elective.id}:${cursor}:${i}`,
        eventId: elective.id,
        sessionId: i,
        course: elective,
        courseId: elective.code ?? elective.id,
        type: s.type ?? "lecture",
        date: cursor,
        endDate: null,
        allDay,
        start: allDay ? null : (s.start ?? null),
        end: allDay ? null : (s.end ?? null),
        location: s.location ?? null,
        title: elective.title ?? { en: elective.id },
        displayCode: s.displayCode ?? elective.title?.[locale] ?? elective.id,
        calendarTitle: s.displayCode ?? elective.title?.[en ?? locale] ?? elective.id,
        color: elective.color ?? null,
        delivery: elective.delivery ?? "campus",
        status: "published",
        sourceReview: [...(meta.sourceReview ?? []), ...(elective.sourceReview ?? []), ...(s.sourceReview ?? [])],
        elective: true
      });
    }
    cursor = formatDate(addDays(parseDate(cursor), 1));
  }
  return out;
}

// Append the selected ∩ eligible elective occurrences onto a base event list.
export function mergeSelectedElectives(baseEvents, catalog, selectedSlugs, opts) {
  const selected = new Set(selectedSlugs ?? []);
  if (!selected.size) return baseEvents;
  const eligible = eligibleElectives(catalog, opts?.context);
  const extra = [];
  for (const el of eligible) {
    if (!selected.has(el.slug ?? el.id)) continue;
    extra.push(...buildElectiveOccurrences(el, opts));
  }
  return [...(baseEvents ?? []), ...extra];
}

export function electiveColorMap(catalog) {
  const map = {};
  for (const el of catalog ?? []) map[el.code ?? el.id] = el.color ?? null;
  return map;
}
