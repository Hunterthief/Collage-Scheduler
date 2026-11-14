function getCurrentBase() {
  if (typeof document !== "undefined" && document.baseURI) return document.baseURI;
  if (typeof window !== "undefined" && window.location?.href) return window.location.href;
  return "/";
}

export function absoluteUrl(path, base = getCurrentBase()) {
  if (!path) return "";
  try {
    return new URL(path, base).href;
  } catch {
    return path;
  }
}

function cohortsFor(assignment, manifest) {
  return (manifest?.assignments ?? []).filter(
    (a) =>
      a.programId === assignment.programId &&
      a.academicYearId === assignment.academicYearId
  );
}

export function resolveYearLevel(assignment, manifest) {
  if (!assignment) return null;
  if (assignment.yearLevel != null && assignment.yearLevel !== "") {
    const n = Number(assignment.yearLevel);
    return Number.isFinite(n) ? n : null;
  }
  const matches = cohortsFor(assignment, manifest).filter((a) => a.yearLevel != null);
  if (matches.length === 1) {
    const n = Number(matches[0].yearLevel);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function renderTemplate(template, values) {
  return template
    .replace("{programId}", values.programId)
    .replace("{academicYearId}", values.academicYearId)
    .replace("{level}", values.level == null ? "" : String(values.level))
    .replace("{group}", String(values.group))
    .replace("{subdivision}", values.subdivision)
    .replace("{subdivisionLower}", values.subdivision.toLowerCase());
}

export function buildFeedUrl(assignment, manifest) {
  if (!assignment || assignment.practicalGroup == null) return null;
  const feeds = manifest?.calendarFeeds ?? {};
  const baseUrl = String(feeds.baseUrl ?? "calendar/feeds").replace(/\/$/, "");
  const subdivision = assignment.subdivision ? String(assignment.subdivision).toUpperCase() : "";
  const level = resolveYearLevel(assignment, manifest);
  const template =
    level != null
      ? subdivision
        ? feeds.levelSubdivisionPathTemplate ?? "{programId}/{academicYearId}/year-{level}/group-{group}-{subdivisionLower}.ics"
        : feeds.levelPathTemplate ?? "{programId}/{academicYearId}/year-{level}/group-{group}.ics"
      : subdivision
        ? feeds.subdivisionPathTemplate ?? "{programId}/{academicYearId}/group-{group}-{subdivisionLower}.ics"
        : feeds.pathTemplate ?? "{programId}/{academicYearId}/group-{group}.ics";
  const rel = renderTemplate(template, {
    programId: assignment.programId,
    academicYearId: assignment.academicYearId,
    level,
    group: assignment.practicalGroup,
    subdivision
  });
  return absoluteUrl(`${baseUrl}/${rel}`, getCurrentBase());
}

// One static feed per elective (group-independent); a student subscribes to the
// electives they actually registered. Slug is the stable identity.
export function buildElectiveFeedUrl(slug, manifest) {
  if (!slug) return null;
  const feeds = manifest?.calendarFeeds ?? {};
  const baseUrl = String(feeds.baseUrl ?? "calendar/feeds").replace(/\/$/, "");
  const template = feeds.electivePathTemplate ?? "electives/{slug}.ics";
  const rel = template.replace("{slug}", String(slug));
  return absoluteUrl(`${baseUrl}/${rel}`, getCurrentBase());
}

export function googleCalendarAddByUrlUrl() {
  return "https://calendar.google.com/calendar/u/0/r/settings/addbyurl";
}

export function webcalUrl(feedUrl, _ignoredBase) {
  const absoluteFeedUrl = absoluteUrl(feedUrl, getCurrentBase());
  return absoluteFeedUrl.replace(/^https?:\/\//, "webcal://");
}

export function googleCalendarSubscribeUrl(feedUrl, _ignoredBase) {
  return `https://www.google.com/calendar/render?cid=${encodeURIComponent(webcalUrl(feedUrl))}`;
}
