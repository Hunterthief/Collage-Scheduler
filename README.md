# College Scheduler

[![CI](https://github.com/Hunterthief/Collage-Scheduler/actions/workflows/ci.yml/badge.svg)](https://github.com/Hunterthief/Collage-Scheduler/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![GitHub Pages](https://img.shields.io/badge/hosting-GitHub%20Pages-1a73e8.svg)](https://hunterthief.github.io/Collage-Scheduler/)

A **fully static, data-driven college scheduling platform** for the Faculty of Pharmacy, Alexandria University. It is two surfaces sharing one data engine:

- **Timetable** (`index.html`) — look up a personal schedule by university ID (or program → academic year → year → practical group), see lectures, practicals, exams and college-wide events in a Google-Calendar-style interface, and subscribe to a permanent `.ics` feed for the exact year, group and subgroup.
- **Study plan** (`study.html`) — turn that real timetable into a worked study plan: a 12-slot lecture sheet per subject, a capacity-aware week planner that never books into a class, an Eisenhower prioritizer with energy tagging, a GTD capture inbox, Leitner spaced repetition, a weekly review, a focus timer with a verifiable minute ledger, and one-click hand-off to Google Calendar or a task app.

**Live site:** <https://hunterthief.github.io/Collage-Scheduler/>
**Study plan:** <https://hunterthief.github.io/Collage-Scheduler/study.html>
**Repository:** <https://github.com/Hunterthief/Collage-Scheduler>

> **Deployment status.** This README documents three changes that take effect once their files are
> committed:
>
> 1. **Year-scoped feed paths** (`…/year-3/group-1-a.ics`), from the updated `data/manifest.json`,
>    `assets/js/calendar/calendar-links.js` and `tools/generate-calendars.mjs`. Needs CI to
>    regenerate the feeds.
> 2. **One-click subscribe as the primary action**, from the updated `assets/js/app.js`.
> 3. **The study plan module** (§11) — pure static HTML/CSS/ES modules, no data contract, no feed,
>    no generator change. It is live as soon as its files are on `main`; nothing waits on CI.
>
> At the last verification the repository still had flat feed paths, no `yearLevel`/`legacyAlias`
> in the manifest, and the stray `institution/group-null.ics`. The flat alias paths in §9.2 resolve
> both before and after the update, so no existing subscription breaks. Remove this callout once
> items 1 and 2 are live.

---

## Table of contents

- [1. What this is](#1-what-this-is)
- [2. Features](#2-features)
- [3. Architecture](#3-architecture)
- [4. Repository layout](#4-repository-layout)
- [5. Data model reference](#5-data-model-reference)
- [6. Shorthand notation](#6-shorthand-notation)
- [7. Student ID resolution](#7-student-id-resolution)
- [8. Scheduling semantics](#8-scheduling-semantics)
- [9. Calendar feeds](#9-calendar-feeds)
- [10. The web app (timetable)](#10-the-web-app-timetable)
- [11. Study plan](#11-study-plan)
- [12. Local development](#12-local-development)
- [13. Data editing cookbook](#13-data-editing-cookbook)
- [14. Validation and tests](#14-validation-and-tests)
- [15. CI/CD and deployment](#15-cicd-and-deployment)
- [16. Current dataset](#16-current-dataset)
- [17. Data caveats (`sourceReview`)](#17-data-caveats-sourcereview)
- [18. Privacy and security](#18-privacy-and-security)
- [19. Troubleshooting](#19-troubleshooting)
- [20. Known limitations and roadmap](#20-known-limitations-and-roadmap)
- [21. Contributing conventions](#21-contributing-conventions)
- [22. License](#22-license)
- [23. Acknowledgements](#23-acknowledgements)

---

## 1. What this is

The repository is the **single source of truth** for academic information. All of it lives in JSON under `data/`. The browser fetches those files over relative paths, resolves the student, composes the schedule locally, and renders it. Static `.ics` feeds are generated from the *same* engine by a Node script and committed back into the repo, so GitHub Pages serves them.

The study plan adds a second, orthogonal kind of state: **the student's own plan**, which is *not* repository data. It never touches `data/`, is never uploaded, and lives only in that browser under a per-cohort `localStorage` key (§11.6).

**Hard constraints (by design):**

| No | Why |
|---|---|
| Backend / server / cloud functions | GitHub Pages only |
| Database (SQL or NoSQL) | JSON in git is the database |
| Authentication | Student ID is a *lookup key*, not a credential |
| External APIs / paid services | Zero cost, zero third-party runtime dependency |
| Frontend framework / build step | Vanilla ES modules, no bundler, no `node_modules` |
| Hardcoded academic content in JS | Programs, years, groups, courses, rooms, colours all live in JSON |
| Server storage of a student's plan | Study-plan state is browser-local by design (§18) |

Adding a program, a year level, a semester, a course, a rotation or a college-wide event is a **data edit**, never a code change.

---

## 2. Features

**Lookup**
- Student-ID lookup with leading-zero preservation, ID ranges, explicit lists and per-student overrides.
- Manual lookup: **Program → Academic year → Year (1st/2nd/3rd/4th…) → Practical group**, including subgroups `1A 1B 2A 2B 3A 3B`.
- Ambiguity is never guessed: multiple matches raise a data-integrity error; an uncovered subdivision keeps the group and flags `SUBDIVISION_UNRESOLVED`.

**Scheduling**
- Weekly recurrence with `validFrom` / `validUntil` windows.
- Date-specific one-off events (exam days, tutorial cycles, ChemSketch cycles).
- Per-group practical sessions, plus **batch** sessions restricted by seat-number range.
- **Alternating A/B week rotations** that skip blacked-out weeks without consuming a slot.
- **Blackouts** (e.g. mid-term week) that suppress lectures/practicals but keep examinations.
- Date-specific **exceptions**: cancel, move, reschedule, update, replace.
- College-wide events with audience targeting (`all`, `program`, `academic-year`, `semester`, `group`, `custom`), all-day and multi-day ranges.
- Merge + dedupe + chronological sort + overlap/conflict detection.

**Presentation**
- Google-Calendar-style **Week** and **Day** grids (sticky headers, sticky time gutter, "now" line, overlap columns), plus a **List** agenda.
- **Per-subject colour coding** driven by `courses.json`, with a legend.
- Event titles in **shorthand form** (`PN 7 Basic Pharmacology`, `LO 0 Drug Information`, `EO 2 Drug Design (Quiz 1)`).
- 12-hour AM/PM times, `Needs review` badges for unverified source data, cancelled styling.
- Responsive down to small phones; no horizontal page overflow.

**Study plan** (§11)
- 12-slot lecture sheet per subject, blank by design — nothing pre-filled, no times guessed.
- Capacity-aware week planner that places study blocks only in gaps between the cohort's **real** published classes.
- Eisenhower 2×2 with urgency derived from real exam proximity; Pareto ⭐ on the top ~20% of "Do now".
- GTD capture inbox (★ important / 2-minute / context), with one-tap promotion into a real lecture slot.
- Per-lecture **focus demand** (deep / medium / light) driving energy-aware placement into the peak window; interleave ↔ block week ordering.
- Leitner spaced repetition (B1–B5: 1/3/7/14/30 days) with a free "Again" lapse.
- Weekly review: backward pace per subject, a 7-day time audit of *real* logged minutes, and a five-step ritual with live counts and deep links.
- Pomodoro timer whose every committed minute writes a dated session row, so the streak, the audit and the per-lecture actual bar cannot disagree.
- Habit streak, 🌙 wrap-day shutdown ritual, keyboard shortcuts, undo stack.
- Hand-off: `.ics` download (study blocks + recall markers), Todoist/TickTick `.csv` (lectures + inbox), per-lecture Google Calendar template link, and a whole-plan JSON backup/restore.

**Calendars**
- Static feeds per **year level**, per group and per subgroup, plus a college-wide feed.
- **One-click subscribe** as the primary action, with manual Add-by-URL as a labelled backup.
- Stable URLs across updates; stable UIDs; content-hashed `SEQUENCE`; `STATUS:CANCELLED`.
- **Reminders**: first timed event of each day → 1 hour before; every later timed event → 15 minutes before (`VALARM`).
- In-page reminder engine (browser notifications + toasts) using the same rule, for clients that ignore feed alarms.

---

## 3. Architecture

Five independent layers, each testable in isolation:

```text
┌──────────────────────────────────────────────────────────────┐
│ 1. DATA           data/**.json  (manifest-driven discovery)   │
├──────────────────────────────────────────────────────────────┤
│ 2. RESOLUTION     student/resolver.js  + data/options.js      │
│                   ID → program / year / level / group / A-B   │
├──────────────────────────────────────────────────────────────┤
│ 3. SCHEDULING     schedule/engine.js                          │
│                   recurrence · rotation · blackouts ·         │
│                   sessions · exceptions · targeting ·         │
│                   merge · sort · conflicts                    │
├──────────────────────────────────────────────────────────────┤
│ 4. PRESENTATION   app.js + assets/css/**        (timetable)   │
│                   study-app.js + study/**      (study plan)   │
├──────────────────────────────────────────────────────────────┤
│ 5. CALENDAR       calendar/ics-generator.js (browser preview) │
│                   tools/generate-calendars.mjs (static feeds) │
└──────────────────────────────────────────────────────────────┘
```

The browser and the feed generator call **the same `composeSchedule()`**, so what a student sees on screen and what lands in Google Calendar cannot drift apart.

The study module is a **consumer** of layers 1–3, not a sixth brain. `study/data.js` calls the same `boot()` → `selectActiveSemester()` → `loadSemesterDatasets()` → `composeSchedule()` path as `app.js`, then derives `busyFor()` / `capacityFor()` / `nextExamFor()` from the composed events. Every free-hour figure, every exam date and every colour the planner uses therefore comes from published repository data. **The study module contains no recurrence, rotation, blackout, exception or conflict logic of its own** — adding a semester or fixing a timetable in JSON improves the study plan with zero study-code change.

Request flow:

```text
manifest.json
  → programs.json + assignments/*.json + institution/*.json
  → resolveStudentId()  (or manual selection)
  → selectActiveSemester(scoped by yearLevel, today in Africa/Cairo)
  → loadSemesterDatasets(courses, lectures, practicals, exams, exceptions)
  → composeSchedule()
      ├─→ render grid / agenda  ·  buildFeedUrl()  ·  eventsToIcs()      [index.html]
      └─→ busyFor / capacityFor / nextExamFor                            [study.html]
            → freeGapsFor() → timingsFor() → autoPlan() → export/ics · csv
```

---

## 4. Repository layout

```text
.
├── index.html                     # timetable lookup + compare, no build step
├── study.html                     # study plan, no build step
├── package.json                   # convenience scripts only, zero dependencies
├── LICENSE                        # Apache-2.0
├── README.md
├── .nojekyll                      # serve files as-is on GitHub Pages
│
├── .github/workflows/ci.yml       # validate → test → generate → publish feeds
│
├── assets/
│   ├── favicon.svg
│   ├── css/
│   │   ├── main.css               # tokens, page chrome, scrollbars, safe areas
│   │   ├── components.css         # lookup, pills, cards, buttons, feed box
│   │   ├── schedule.css           # calendar grid, agenda, tags
│   │   ├── study.css              # study shell, matrix, week, reviews, drawer, picker
│   │   └── study-extras.css       # today hub, prioritize + review sheets, demand pips
│   └── js/
│       ├── app.js                 # timetable UI, views, reminders, subscription, compare
│       ├── study-app.js           # study entry: wiring, keyboard, import/export handlers
│       ├── config.js              # manifest path, fetch cache policy, UI defaults
│       ├── i18n.js                # localize({en, ar})
│       ├── data/
│       │   ├── loader.js          # cache-aware fetch, missing-file diagnostics
│       │   ├── options.js         # dropdown model: programs → years → levels → groups
│       │   └── programs.js        # findProgram / findAcademicYear
│       ├── student/
│       │   ├── assignments.js     # load assignment documents from manifest
│       │   └── resolver.js        # pure ID resolution + error classes
│       ├── study/
│       │   ├── data.js            # academic context: boot, setCohort, busyFor, capacityFor, exams
│       │   ├── store.js           # S state, persistence, date math, inbox, ledger, migration
│       │   ├── planner.js         # pure logic: filter/sort/auto-plan/leitner/pace/gaps
│       │   ├── views.js           # all rendering incl. hub, sheets, picker, drawer
│       │   ├── timer.js           # timestamp pomodoro + the session-logging contract
│       │   └── export.js          # .ics / .csv / gcal template / whole-plan backup
│       ├── schedule/
│       │   ├── engine.js          # normalization + materialization + composition
│       │   ├── recurrence.js      # dates, teaching weeks, rotations, blackouts
│       │   ├── exceptions.js      # cancel / move / reschedule / update / replace
│       │   ├── shorthand.js       # "LN 5 Microbiology" parser
│       │   ├── labels.js          # shorthand titles + subject colours index
│       │   ├── reminders.js       # reminder plan + browser scheduler
│       │   ├── sorting.js         # chronological sort + conflict detection
│       │   ├── electives.js       # optional-course catalog merge
│       │   └── compare.js         # cross-cohort slot finder + side-by-side matrix
│       └── calendar/
│           ├── ics-generator.js   # RFC 5545 writer (folding, UTC, VALARM)
│           └── calendar-links.js  # feed URL templates + Google links
│
├── data/
│   ├── manifest.json              # version, timezone, paths, feeds, cohorts
│   ├── changelog.json             # human-readable publication history
│   ├── institution/
│   │   ├── settings.json          # name, timezone, week start, locales, privacy
│   │   ├── locations.json         # buildings, codes, floors
│   │   └── events.json            # college-wide calendar & activities
│   ├── programs/programs.json     # programs → academic years → semesters
│   ├── electives/                 # optional-course catalogs
│   ├── students/assignments/
│   │   ├── pharmd/2026-2027.json
│   │   └── clinical-pharmacy/2026-2027.json
│   └── schedules/
│       ├── pharmd/2026-2027/semester-5/
│       │   ├── courses.json  lectures.json  practicals.json
│       │   └── exams.json    exceptions.json
│       └── clinical-pharmacy/2026-2027/semester-3/
│           ├── courses.json  lectures.json  practicals.json
│           └── exams.json    exceptions.json
│
├── calendar/feeds/                # generated, committed, served by Pages
│   ├── institution.ics
│   ├── pharmd/2026-2027/
│   │   ├── year-3/group-{1,2,3}[-a|-b].ics    # canonical, year-scoped
│   │   └── group-{1,2,3}[-a|-b].ics           # preserved aliases
│   └── clinical-pharmacy/2026-2027/
│       ├── year-2/group-{1,2}[-a|-b].ics      # canonical, year-scoped
│       └── group-{1,2}[-a|-b].ics             # preserved aliases
│
├── schemas/                       # JSON Schema contracts
│   ├── manifest.schema.json
│   ├── programs.schema.json
│   ├── assignments.schema.json
│   ├── events.schema.json
│   ├── exceptions.schema.json
│   └── institution-events.schema.json
│
├── tools/
│   ├── validate-data.py           # dependency-free structural validator
│   └── generate-calendars.mjs     # static feed generator (uses the same engine)
│
└── tests/
    ├── engine.test.mjs
    ├── exams.test.mjs
    ├── institution-allday.test.mjs
    ├── resolver.test.mjs
    └── shorthand.test.mjs
```

> The generator removes the legacy stray `calendar/feeds/institution/group-null.ics` on every run.
> The canonical college-wide feed is `calendar/feeds/institution.ics`.
>
> `study.html` and the `study/**` modules are **not** part of the published data contract: there is
> no schema for them, no validator entry, and no feed. They read repository data and write only to
> the visitor's browser.

---

## 5. Data model reference

Study-plan state is deliberately excluded from this section — it is user-local, not published data. See §11.6 for its shape.

### 5.1 `data/manifest.json`

Discovery root. The client never hardcodes dataset paths.

| Field | Purpose |
|---|---|
| `schemaVersion` | Contract version |
| `dataVersion` | Publication timestamp; drives client cache invalidation |
| `timezone` | Always `Africa/Cairo` |
| `paths.*` | `programs`, `settings`, `locations`, `institutionEvents`, `changelog` |
| `assignments[]` | One entry per **cohort** |
| `assignments[].programId` / `academicYearId` | Cohort identity |
| `assignments[].yearLevel` | Grade (1-based). Makes the manifest self-describing so feed URLs can be built without loading the assignment doc |
| `assignments[].legacyAlias` | `true` = this cohort also publishes the pre-year flat paths, keeping old subscriptions alive |
| `assignments[].path` | Assignment document |
| `calendarFeeds.baseUrl` | `calendar/feeds` |
| `calendarFeeds.pathTemplate` | `{programId}/{academicYearId}/group-{group}.ics` |
| `calendarFeeds.subdivisionPathTemplate` | `…/group-{group}-{subdivisionLower}.ics` |
| `calendarFeeds.levelPathTemplate` | `…/year-{level}/group-{group}.ics` |
| `calendarFeeds.levelSubdivisionPathTemplate` | `…/year-{level}/group-{group}-{subdivisionLower}.ics` |

**Rule:** the level templates are used whenever the year level is known — unconditionally, not only when several cohorts share a program year. The flat templates are used only for cohorts with no year level, and for explicit legacy aliases.

### 5.2 `data/programs/programs.json`

`programs[] → academicYears[] → semesters[]`.

Semester fields: `id`, `name{en,ar}`, **`yearLevel`** (1-based grade), `validFrom`, `validUntil`, `status` (`draft|published|cancelled|completed`), `datasets{courses,lectures,practicals,exams,exceptions}`, `blackouts[]`, `sourceReview[]`.

`validFrom` is consumed by the study module's pace maths (§11.4) as the semester start reference, so a wrong window here shows up as an unrealistic "per week to finish" figure rather than a crash.

Blackout:

```json
{
  "id": "fall-2026-midterm-week",
  "from": "2026-10-31",
  "to": "2026-11-05",
  "blocksAcademicEvents": true,
  "blockTypes": ["lecture", "practical"],
  "excludedFromRotation": true
}
```

### 5.3 `data/institution/locations.json` and `settings.json`

Buildings carry `id`, `code` (shorthand letter), `name{en,ar}`, `floors[]`. Settings carry `institutionId`, `calendarName`, `timezone`, `weekStartDay` (`Saturday`), `defaultLocale`, `locales`, `privacy.notice`.

`weekStartDay` and `timezone` are honoured by the study planner too, so its weeks and "today" agree with the timetable page.

### 5.4 `data/students/assignments/<program>/<year>.json`

```json
{
  "programId": "pharmd",
  "academicYearId": "2026-2027",
  "yearLevel": 3,
  "rules": [
    {
      "id": "pharmd-2026-2027-group-1",
      "practicalGroup": 1,
      "from": "2415001",
      "to": "2415076",
      "subdivisions": [
        { "name": "A", "from": "2415001", "to": "2415038" },
        { "name": "B", "from": "2415039", "to": "2415076" }
      ]
    }
  ],
  "overrides": []
}
```

- `to: null` means *open-ended* ("to the end").
- `students: ["…"]` supports explicit lists instead of ranges.
- `overrides[]` win over rules: `{ studentId, practicalGroup, subdivision, yearLevel?, reason }`.

### 5.5 `courses.json`

```json
{ "id": "02-06-02305", "code": "02-06-02305",
  "title": { "en": "Basic Pharmacology" }, "color": "#1a73e8" }
```

`color` is the single source of subject colouring across grid, chips, agenda tags, legend, **and the study module's matrix rows, week cards and demand pips**.

### 5.6 Academic events (`lectures.json`, `practicals.json`, `exams.json`)

All three share one shape: `{ "events": [ … ] }`.

| Field | Notes |
|---|---|
| `id` | Stable, never reused |
| `courseId` | Must exist in `courses.json` |
| `type` | `lecture` \| `practical` \| `examination` |
| `day` | Weekday name for recurring events |
| `date` | `YYYY-MM-DD` for one-off events (overrides `day`) |
| `start` / `end` | 24-hour `HH:MM` local time |
| `groups` | `[1,2,3]`, `["all"]`, or omitted = everyone |
| `subdivisions` | Optional `["A"]` restriction at event level |
| `sessions[]` | Group-specific times (see below) |
| `rotation` | Alternating-week rule (see §8.3) |
| `location` | `{ building, floor, room }` |
| `shorthand` / `displayCode` | Human notation / calendar title |
| `validFrom` / `validUntil` | Optional validity window |
| `allDay` | All-day examination (no times) |
| `title`, `description` | Override course title; carry tutorial topics |
| `sourceReview[]` | Verification flags (see §17) |

Session:

```json
{ "group": 1, "subdivision": "A", "batch": "1A-1",
  "from": "2415001", "to": "2415010",
  "students": ["2435001"],
  "start": "09:00", "end": "10:00" }
```

`from`/`to`/`students` restrict a session to specific seat numbers — this is how ChemSketch batches and the Quiz slots are modelled.

### 5.7 `exceptions.json`

```json
{ "id": "…", "eventId": "…", "date": "2026-11-10",
  "action": "cancel", "group": 1, "newDate": "…",
  "day": "…", "start": "…", "end": "…",
  "location": { … }, "replacementEventId": "…", "keepIdentity": false }
```

Actions: `cancel`, `move`, `reschedule`, `update`, `replace`. Omitting `group` makes it a wildcard for all groups. Exceptions never mutate the recurring definition. Moving *backwards* in a week requires an explicit `newDate` (otherwise a data error is reported rather than guessing).

### 5.8 `data/institution/events.json`

College-wide calendar and activities, independent of any timetable.

- Timing: `date`, or `startDate`(+`endDate`), or `day`+`validFrom`+`validUntil`; `allDay: true` for date ranges.
- `audience.scope`: `all` \| `program` \| `academic-year` \| `semester` \| `group` \| `custom` (`custom` supports `all`/`any`/`none` rule lists).
- `status`: `draft` \| `published` \| `cancelled` \| `completed`. Only `published` (and `cancelled`, rendered struck-through) reach the public timetable.

A `scope: "all"` event appears for **every** student and in **every** feed without duplicating it into any program file. The study planner treats all-day events as **banners, never as busy time**, so a college-wide notice does not consume a study slot.

### 5.9 `data/changelog.json`

`entries[]` with `id`, `publishedAt`, `summary{en}`, `affected{programId,academicYearId,semesterId}`, `calendarFeedAffected`, `notes[]`.

---

## 6. Shorthand notation

Compact, case-insensitive notation for humans. **Structured fields remain authoritative** — shorthand is never the only representation.

| Part | Values |
|---|---|
| Event type | `L` lecture · `P` practical/section · `E` examination |
| Building | `N` New Building · `O` Old Building (from `locations.json`) |
| Floor | Optional integer, `0` = ground |
| Title | Remaining text |

| Shorthand | Meaning |
|---|---|
| `LN 5 Microbiology` | Lecture, New Building, floor 5 |
| `LO 0 Drug Information` | Lecture, Old Building, ground floor |
| `PN 7 Basic Pharmacology` | Practical, New Building, floor 7 |
| `PN 4 Drug Design (ChemSketch)` | Practical, New Building, floor 4, ChemSketch cycle |
| `EO 2 Drug Design (Quiz 1)` | Examination, Old Building, floor 2 |
| `PN Drug Design` | Practical, floor intentionally unspecified |

`displayCode` becomes the event title in the UI **and** the ICS `SUMMARY`; the full course title/topic goes into the tooltip and `DESCRIPTION`. The parser rejects unknown types/buildings and missing titles instead of guessing.

---

## 7. Student ID resolution

`assets/js/student/resolver.js` is pure and fully unit-tested.

1. Normalize: trim, strip internal whitespace, **keep leading zeroes**.
2. Individual `overrides` win; more than one override → `AmbiguousAssignmentError`.
3. Match `rules` by explicit `students` list or numeric range (`BigInt` comparison, so long IDs are safe).
4. More than one matching rule, or matches across cohorts → `AmbiguousAssignmentError`.
5. Resolve subdivision; if the group matches but no subdivision covers the ID, keep the group and return `subdivisionStatus: "unresolved"` + `SUBDIVISION_UNRESOLVED`.
6. No match → `StudentNotFoundError`.
7. Return `{ studentId, programId, academicYearId, yearLevel, practicalGroup, subdivision, subdivisionStatus, source, warnings }`.

The presentation layer never sees ID ranges — it receives a normalized assignment object, identical in shape to the one produced by manual selection.

The study module accepts the **same** object shape, either from the manual cascade or from `cohortFromId()` (its own "…or your student ID" field calls the same resolver). Its persistence key is built from `programId|academicYearId|yearLevel|practicalGroup|subdivision` only — **no student ID is ever written to storage** (§18).

---

## 8. Scheduling semantics

### 8.1 Materialization

For each definition: one-off `date` → that date; otherwise expand the weekday across the semester window, clipped by `validFrom`/`validUntil`. Practicals iterate `sessions`; other types use event-level times. All-day examinations materialize without times.

### 8.2 Blackouts

`isAcademicBlackoutDate()` drops occurrences whose type is listed in `blockTypes` inside any blackout range. Examinations are unaffected, so mid-term week shows exams only.

### 8.3 Teaching weeks and A/B rotation

`teachingWeekNumber()` counts Saturday-start weeks from `semester.validFrom`, **skipping** weeks that overlap a blackout with `excludedFromRotation !== false`. `getRotationSubdivision()` maps that count through `rotation.sequence` starting at `rotation.startWeek`.

```json
"rotation": { "type": "alternating-subdivisions",
              "sequence": ["A","B"], "startWeek": 1,
              "excludeBlackouts": true }
```

With the Fall 2026 anchor (`2026-09-19`) and the mid-term blackout:

| Teaching week | Calendar week | Subdivision |
|---|---|---|
| 1 | 19–25 Sep | A |
| 2 | 26 Sep–2 Oct | B |
| 3 | 3–9 Oct | A |
| 4 | 10–16 Oct | B |
| 5 | 17–23 Oct | A |
| 6 | 24–30 Oct | B |
| — | 31 Oct–5 Nov | *mid-term blackout, not counted* |
| 7 | 7–13 Nov | A |
| 8 | 14–20 Nov | B |
| 9 | 21–27 Nov | A |
| 10 | 28 Nov–4 Dec | B |
| 11 | 5–11 Dec | A |
| 12 | 12–18 Dec | B |

This drives **PharmD Phytochemistry I** (Wed) and **Clinical Biochemistry-I** (Tue). Drug Information tutorials instead use **explicit dates**, because the department's own sequence resumes with Group B on 8 Nov rather than following a pure alternation.

### 8.4 Session selection

A session is kept when: group matches, its `subdivision` (if any) matches the effective subdivision (rotation result, else the student's), and the student's ID falls in `from`/`to` or `students` (when a student ID is known). Subgroup feeds therefore contain only that subgroup's weeks and batches.

### 8.5 Exceptions, targeting, merge, conflicts

Exceptions apply to materialized occurrences by `eventId` + `date` (+ optional `group`). Institution events are filtered by audience. Everything is merged by UID (a `published` occurrence supersedes a `cancelled` one), sorted by date/time/type/title, then scanned for overlaps. Overlaps are **reported**, never silently "fixed"; institution overlaps are warnings, academic overlaps are errors.

Because the study planner reads the *post-merge, post-exception* event list, a cancelled class automatically frees its hour for study, and a moved lecture automatically blocks its new hour. No study-side reconciliation is needed.

---

## 9. Calendar feeds

Base: `https://hunterthief.github.io/Collage-Scheduler/calendar/feeds/`

### 9.1 Canonical, year-scoped paths

The year level is part of the feed identity, so 1st / 2nd / 3rd / 4th year can never collide and a feed URL never changes meaning when a new year is added.

| Cohort | Path pattern |
|---|---|
| PharmD, Year 3 | `pharmd/2026-2027/year-3/group-{1,2,3}.ics` |
| PharmD, Year 3 subgroups | `pharmd/2026-2027/year-3/group-{1,2,3}-{a,b}.ics` |
| Clinical, Year 2 | `clinical-pharmacy/2026-2027/year-2/group-{1,2}.ics` |
| Clinical, Year 2 subgroups | `clinical-pharmacy/2026-2027/year-2/group-{1,2}-{a,b}.ics` |
| College-wide only | `institution.ics` |

Example: `…/pharmd/2026-2027/year-3/group-1-a.ics`

### 9.2 Preserved aliases (pre-year paths)

Cohorts marked `legacyAlias: true` in the manifest also publish the original flat paths, byte-identical to their canonical feed. These are the URLs already in students' calendars.

```text
pharmd/2026-2027/group-1.ics … group-3-b.ics
clinical-pharmacy/2026-2027/group-1.ics … group-2-b.ics
```

Only one cohort per program + academic year may own an alias; the generator raises an error if two claim the same path.

**Totals:** 16 canonical feeds (1 college-wide + 9 PharmD + 6 Clinical) and 15 preserved aliases.

### 9.3 Adding a new year level

Add the semester with its `yearLevel`, add the assignment document, add the manifest cohort entry with that `yearLevel`. The new cohort publishes to `year-N/…`; existing cohorts keep their own canonical paths **and** their aliases. Nothing that is already subscribed changes.

### 9.4 ICS conformance

- `VERSION:2.0`, `METHOD:PUBLISH`, `CALSCALE:GREGORIAN`, `X-WR-CALNAME`, `X-WR-TIMEZONE`.
- Timed events converted from `Africa/Cairo` to UTC `…Z` (two-pass offset resolution).
- All-day events use `DTSTART;VALUE=DATE` with an **exclusive** `DTEND`.
- Every content line folded at 75 octets with CRLF + space.
- Text escaped (`\`, `;`, `,`, newlines).
- Stable `UID`: `institutionId:eventId:date:group:subdivision:start` (institution events: `institutionId:eventId:date`).
- `SEQUENCE` = FNV-1a hash of the event's content, so edits bump it and identity survives time/room changes.
- `SUMMARY` = shorthand title; `DESCRIPTION` = full title, type, course, group, subdivision, batch, topic, review notes; `LOCATION` = building/floor/room; `CATEGORIES` = course code; `STATUS:CANCELLED` for cancellations.

### 9.5 Reminders

`VALARM` / `ACTION:DISPLAY` with `TRIGGER:-PT1H` for the **first timed event of each day** and `TRIGGER:-PT15M` for every later timed event. All-day and cancelled events get no alarm.

### 9.6 Subscribing

**Primary — one click.** The site's **Subscribe in Google Calendar** button opens
`https://www.google.com/calendar/render?cid=<webcal feed URL>`, which drops the student straight
into Google's subscription confirmation. One click, confirm, done. The subscription then stays
live and updates itself whenever CI republishes the feed.

**Backup — manual Add by URL.** If no confirmation prompt appears, the **Add manually (backup)**
button copies the feed URL to the clipboard and opens Google's official
`calendar.google.com/calendar/u/0/r/settings/addbyurl` page. Paste into **URL of calendar** and
click **Add calendar**. This route is always available and never depends on the `cid` endpoint.

**Other clients.** Apple Calendar, Outlook and Thunderbird accept the same `https://` or
`webcal://` URL directly, and they honour the feed's `VALARM` reminders.

**Known behaviours**
- Google has historically been intermittent with the `render?cid=` endpoint. It is the default
  because it works for the common case; the manual route exists precisely so a failure is never
  a dead end.
- If Google reports that the calendar already exists, remove the old entry from the calendar list
  before re-adding.
- Never paste a feed URL into an *email address* field — that produces "is not a valid email
  address".
- Google **ignores `VALARM` and per-event colours on subscribed calendars**, which is why the site
  carries its own reminder engine and why subjects are identified by shorthand name.
- Google refreshes subscribed feeds on its own schedule (hours to days). The website and the
  `.ics` files update immediately after publication.

### 9.7 Study-plan calendar output is a download, not a feed

The study module's **📅 Calendar (.ics)** button (§11.8) produces a **file download** built by the
same `eventsToIcs()` writer. There is **no published study feed URL**, because a study plan is
private to one browser and cannot be materialized server-side on GitHub Pages. Import it via
Google Calendar → Settings → Import & export, or open it directly on iPhone/Mac. Re-export after
major plan changes; it is a snapshot, not a live subscription.

---

## 10. The web app (timetable)

`index.html` + `assets/js/app.js`.

- **Lookup card** with three modes: Student ID, Year & group, Compare groups; the manual mode exposes Program / Academic year / **Year** / Practical group, all derived from data.
- **Summary strip**: masked ID, lookup method, program, academic year, year level, semester, group, subdivision, subject-colour legend, and any data notes.
- **Week / Day** grids: sticky day headers and time gutter, all-day row, overlap columns, current-time line, AM/PM gutter labels, 🔔 reminder badges, subject colours, tooltips with full title + room + reminder.
- **List** agenda grouped by day with type/reminder/cancelled/review tags.
- **Reminders panel**: opt-in toggle (persisted), permission status, test button, toast fallback; schedules a rolling 36-hour window and re-rolls on tab focus.
- **Subscription panel**: one-click subscribe as the primary action; manual Add-by-URL backup that auto-copies the feed URL; copy button; `.ics` preview download named after group/subgroup/year.
- **Compare panel**: slot finder across all cohorts at a chosen time (free / busy / no-schedule), and a side-by-side day matrix with a ★ reference group, ✓/✗ swap check and common free windows.
- **Electives card**: tick optional courses; choice stored locally only; merged into the grid and the `.ics` preview, with per-course feeds.
- Privacy notice from `settings.json`; mobile-first layout with no sideways scrolling.
- Header links to the study plan (§11).

---

## 11. Study plan

`study.html` + `assets/js/study-app.js` + `assets/js/study/**` + `assets/css/study.css` + `assets/css/study-extras.css`.

### 11.1 What it is, and two rules that explain most of its behaviour

The study plan is the **decision layer** on top of the execution layer. The timetable page answers *"what is already in my week?"*; this page answers *"what do I do right now, in what order, with what energy, and am I on pace?"*

**Rule 1 — the sheet starts empty on purpose.** Nothing is pre-filled, no durations are guessed, no subjects are invented. Subjects, colours, class times and exam dates arrive from repository JSON through `study/data.js`; the study *content* (what a lecture is, how long it takes, when it happens) is the student's.

**Rule 2 — the plan never books you into a class.** Every free-hour figure is the complement of the cohort's real published events inside the student's study window. Auto-plan and the exported clock times both walk those same gaps, so a study block cannot land on a lecture. Worst case it is flagged *outside your usual study window* (overflow), which is a window problem, not a collision.

Everything is stored under one per-cohort key (§11.6), participates in a 25-deep undo stack, and survives reload. There is no account, no sync and no upload.

### 11.2 Module layout

| File | Responsibility |
|---|---|
| `study/store.js` | `S` state, the only date arithmetic, persistence, migration, GTD inbox, minute ledger, streak/audit, anchoring |
| `study/data.js` | academic context: `boot`, `setCohort`, `cohortFromId`, `busyFor`, `capacityFor`, `nextExamFor`, `upcomingExams`, `winS/winE` |
| `study/planner.js` | pure logic: filter/sort, free gaps, clock times, auto-plan, Leitner, Eisenhower/Pareto/frog, pace, wrap-day, summary |
| `study/views.js` | all rendering: hero, hub, library, matrix, week, reviews, drawer, picker, both sheets, timer paint, tuning |
| `study/timer.js` | timestamp pomodoro + the session-logging contract |
| `study/export.js` | `.ics`, `.csv`, single-lecture Google Calendar template, whole-plan backup |
| `study-app.js` | entry point: cohort bootstrap, timer wiring, every `data-action` handler, keyboard, import |

Dependency direction: `study-app.js` → `{store, data, planner, export, timer, views}`; `views`/`planner`/`timer`/`export` → `store` + `data`; `data` → the shared `schedule/**`, `data/**`, `student/**` layers. `store` depends only on `schedule/recurrence.js`. No cycle.

### 11.3 The five surfaces

| Surface | Desktop | Mobile (≤880px) | Contents |
|---|---|---|---|
| Top bar | sticky | sticky (exactly one) | brand · today's date · Sound |
| Hero + Cohort | top of Plan | top of Plan | title, semester line, exam chips, 3 stat cards, program/year/group selects, student-ID shortcut |
| **Today hub** | under cohort | under cohort | 🐸 frog · live counts · 📥 capture · ⚡/↻/🌙 · 🔥 streak |
| Work area | Library + canvas + rail | 4 bottom tabs: Plan · Lectures · Focus · More | matrix / week / reviews, library, timer, export / tuning / progress |
| Sheets | right slide-over | bottom sheet | ⚡ Prioritize · ↻ Weekly review |

The Matrix / Week / Reviews switcher is a segmented pill that scrolls with the page rather than a second sticky bar — deliberate, so no hint text is ever clipped on small screens. The matrix on mobile is **not** a horizontally scrolling table: each subject becomes a header line (colour bar + name + **＋12**) with its 12 boxes wrapped beneath it, so nothing is frozen, clipped or sideways.

### 11.4 Techniques and where each one is enforced

Named technique → the code that implements it. This is the map to read before changing behaviour.

| Technique | Implementation | Notes |
|---|---|---|
| GTD **capture** | `store.openInboxItem()` · hub form `onCapture()` | Writing something down costs less than organising it; no subject/duration required |
| GTD **clarify / organize** | Prioritize inbox rows · `x-inbox-promote` → `blankLecture()` + `openDrawer()` | One tap turns a vague worry into a schedulable lecture slot (snapshot-able) |
| GTD **engage** | `planner.frogPick()`, matrix, `prioritizeLists()` | Choosing from curated lists, not from raw inventory |
| **Eat the frog** | `planner.frogPick()` · `views.renderHub()` · `x-frog` → `timer.start()` | Scored across lectures **and** inbox from real exam distance × priority × size; the frog's matrix chip gets a gold ring |
| **Eisenhower** urgent×important | `planner.quadrantOf()` / `urgencyOf()` / `importanceOf()` | Urgency from `data.nextExamFor()` (≤7 d) or an assigned day ≤2 d away — never guessed. Importance = MoSCoW `must`/`should` |
| **Pareto 80/20** | `planner.prioritizeLists()` (`starN`) · ⭐ in `renderMatrix()` + `renderPrioritize()` | Top ~20% of Q1 by `leverageOf()` |
| **2-minute rule** | `store.toggleInbox()` → `addManual()` | Completing a 2m item banks 2 minutes into the ledger, so it feeds the streak and audit |
| **Energy / biological prime time** | lecture `demand` field (drawer segment) · `planner.peakEndMin()` / `isPeak()` | Peak = window open + 40% of the window, rounded to 15 min. Demand is **orthogonal to priority**: priority = "does it matter?", demand = "what attention does it need?" |
| **Energy-aware placement** | `planner.autoPlan()` ordering + `timingsFor()` | Within each touched day, deep → medium → light; since clock times fill earliest-first gaps, deep work lands in the morning peak and light work drifts late/overflow. Week cards confirm with `▲ peak` |
| **Interleaving vs blocking** | `settings.mix` · `planner.interleaveQueue()` | Mixed practice improves discrimination between similar subjects; blocking suits single-topic sprints |
| **Spaced repetition (Leitner)** | `planner.BOX_DAYS`, `markDone()`, `revPass()`, `revAgain()`, `currentStage()`, `reviewQueue()` | B1–B5 = 1/3/7/14/30 days. "Again" lapses to B1 **with no penalty** and increments `review.lapses` |
| **GTD weekly review** | `views.renderReviewSheet()` · `RITUAL` · `store.plan.review` | Five steps with **live counts** from real state and deep links into the exact view that fixes each one |
| **Backward pacing / Parkinson** | `planner.paceFor()` | Compares done vs the linear share of `semester.validFrom` → exam; emits `perWeek` and a `behind` flag |
| **Habit streak + time audit** | `store.streakDays()` / `auditDays()` / `weekMinutes()` | Streak walks back from today and tolerates an unlogged *morning*; audit bars are real logged minutes only |
| **Shutdown / wrap-up** | `planner.wrapDay()` · `x-wrap` | Pulls today's undone planned work back to the pool and reports open recalls. Deliberately does **not** auto-commit tomorrow |
| **Anchoring guard** | `store.suggestEst()` | Drawer shows the median estimate of that subject's already-timed lectures, so slot 9 isn't guessed in isolation |
| **Capacity-aware placement** | `data.capacityFor()` / `busyFor()` + `planner.freeGapsFor()` / `timingsFor()` | Union of real busy blocks → gaps, tagged in-window / after / before |
| **Overcommitment guard** | `views.renderWeek()` (`over5`) | >5 undone blocks in one day flags `⚠ n` |
| **Hand-off, not lock-in** | `export.studyEvents()` / `recallEvents()` / `exportCSV()` / `gcalUrl()` / `exportBackup()` | Same RFC 5545 writer as the published feeds |

### 11.5 Surfaces in detail

**Today hub.** 🐸 frog with **Start** (binds the timer and runs it — same path as 🎯 Focus now) or **Do it** for a 2m task. Live counts: `📥` open inbox · `⏳` days to nearest real exam (red ≤3, amber ≤7, green beyond) · `⏱` minutes logged today · `📚` remaining estimated minutes. Capture row with **★** important, **2m**, and context (`@reading @lab @computer @email @calls @errands`). Buttons **⚡ Prioritize** (`p`), **↻ Weekly review** (`w`, red dot once ≥7 days stale), **🌙 Wrap day**, and 🔥 streak.

**⚡ Prioritize sheet.** Interleave/Block pill + peak tip · inbox rows (✓ / → Lecture / ✕ / inline due date) · live 2×2 with ⭐ · per-subject pace table. Urgency and importance both come from real data, so the grid is a report, not an opinion.

**↻ Weekly review sheet.** Pace tiles (remaining minutes · days to nearest exam · hours/week to finish · subjects behind) · 7-day audit sparkline (y-axis floored at 60 min so one mediocre day doesn't read as heroic) with streak and lapse counts · five-step ritual whose counts reset as the underlying problems are fixed. **Mark reviewed today** stamps the date and clears the hub dot.

**▦ Matrix.** Rows = subjects, columns = lecture 1…12. **＋12** creates the empty slots for a subject, skipping numbers that already exist and never overwriting work. Per chip: `●` demand pip, `⭐` high-leverage, `!` must-and-undone, gold ring = today's frog, `—` = no time set, column-load footer. Row header shows done/total, minutes, and `⚠ N/wk` / `✓ pace` / `exam Nd`.

**🗓 Week.** Per day: `TODAY`/`PAST`, overcommit flag, Planned/Free with green/amber/red meter, the arithmetic line (`2h 30m in class · window 9:00 AM–9:00 PM · peak ends 1:45 PM`), real class chips in subject colour, 📌 all-day banners, and lecture cards with computed clock time, demand dot and `▲ peak`. **⚡ Auto-plan** fills this week's remaining free capacity (priority → exam date → longest first, then interleave, then deep-first within each day) and reports placed / left / still-untimed; it refuses past weeks. **＋** on a day opens the picker (search, unassigned first); cards can be moved or taken off the week. **No drag-and-drop anywhere** — it is the one interaction that silently breaks on touch.

**↻ Reviews.** Due / coming-up / mastered groups with `B2/5` stage pills, **✓ Got it** (promote), **Again** (lapse to B1 tomorrow), **+1d** (snooze, no promotion). Pre-Leitner plans migrate automatically: old `+1/+3/+7` rows become boxes 1/2/3.

**⏱ Focus.** 25/5/15, long break every 4, all editable in Tuning. Timestamp-driven so a backgrounded tab doesn't drift; the ring repaints on return. Binding a lecture flips `todo → doing`; the first undone lecture auto-binds if none is chosen.

**Log invariant (the reason the numbers can be trusted).** `timer.logFocus()` writes a dated session row on **every** committed delta, not only on completion. Therefore `Σ sessions[date]` and `Σ actual` added that day are always equal, so the hub's `⏱ today`, the 🔥 streak, the review sparkline and the drawer's *Actual vs estimate* bar cannot disagree — including partial, paused sessions. (An earlier revision gated session rows at `delta ≥ 5`, which silently dropped 3-minute pause-and-walk-away from the streak while still crediting the lecture.)

**More tab.** Export panel (`.ics` · `.csv` · plain text · backup/restore/clear) · Tuning · Progress (per subject done/total/minutes with ✓/⚠ pace marks, plus logged-vs-estimated calibration error and this week's minutes).

### 11.6 Client state model

Not repository data. No schema, no validator, no feed. Key:

```text
cs-study-v2:<programId>|<academicYearId>|<yearLevel>|<practicalGroup>|<subdivision>
```

No student ID appears in the key or in any stored field — switching cohorts switches plans, and two students in the same group share a key only in the trivial sense that neither's data leaves their own browser.

| Field | Shape | Purpose |
|---|---|---|
| `lectures[]` | `{ id, c, num, title, est, pri, status, day, order, actual, notes, demand, sessions[], completedAt, reviews[] }` | the sheet. `est: 0` is a legitimate "not set", not an error |
| `views[]` | saved filter/sort/tab bundles, seeded with All / 🔥 Exam crunch / ⏳ Needs a time | |
| `settings` | `{ focus, short, long, cycle, dayStart, dayEnd, autoStart, sound, mix, energyPlan, icsRecalls }` | defaults 25/5/15/4, 09:00–21:00, interleave, energy on, recalls on |
| `anchor` | ISO date | the planning week |
| `inbox[]` | `{ id, text, imp, two, ctx, due, done, doneAt }` | GTD captures |
| `manual{}` | `{ "YYYY-MM-DD": minutes }` | 2-minute wins, clamped ≥0 |
| `review` | `{ last, checks{}, lapses }` | ritual state |

`loadPlan()` migrates older records defensively: missing `demand` → `medium`, missing `box` → derived from index, missing extras → fresh defaults. `savePlan()` swallows quota/private-mode failures rather than throwing.

### 11.7 Keyboard

| Key | Action |
|---|---|
| `/` | focus lecture search |
| `n` | new lecture |
| `p` | ⚡ Prioritize sheet |
| `w` | ↻ Weekly review sheet |
| `Space` | start / pause the timer |
| `Ctrl/Cmd + Z` | undo (25-deep) |
| `Esc` | close picker → then sheet → then drawer |

Suppressed while typing in a field, or while a sheet/drawer/picker is open.

### 11.8 Export contract

| Output | Contents | Notes |
|---|---|---|
| **📅 Calendar (.ics)** | undone scheduled lectures + open Leitner recalls | timed lectures get real clock times in free gaps (`overflow` noted in `DESCRIPTION`); untimed become all-day "flexible study task" so nothing is dropped; recalls become all-day `↻ Recall B2 · Subject` markers, gated by Tuning. All-day events carry no `VALARM` by spec — a quiet calendar nag, not a notification storm. Download only (§9.7) |
| **✅ Task apps (.csv)** | undone lectures **+ open inbox captures** prefixed `[Inbox]` | Todoist/TickTick columns; ★ → priority 1 else 3; context and 2m in the description; due date honoured |
| **📋 Copy plain text** | whole plan as text | per-subject done/timed/pace, week day-by-day with computed times, totals, inbox backlog |
| **📅 Google Calendar** (per lecture, drawer) | template link | pre-filled from the lecture's computed time; needs a day assigned |
| **💾 Backup / ⬆ Restore** | `version: 3` — `lectures, views, settings, anchor, inbox, manual, review` | full fidelity across devices. Restore validates shape (IDs must resolve to this cohort's subjects) and is undoable. `version: 2` files restore the sheet only |

### 11.9 Design decisions worth knowing before editing

- **Demand is orthogonal to priority**, and both are orthogonal to exam date. Three axes, one 2×2 plus a pip — collapsing them into a single "importance" score is the mistake this module is built to avoid.
- **Again is free.** Forgetting is the mechanism of spaced repetition; punishing honesty teaches users to lie to the app. The lapse count exists as a *comprehension* signal, consumed by the pace step.
- **Wrap-day does not auto-commit tomorrow.** A shutdown ritual that silently rolls work forward is how planners become fiction.
- **Counts are derived, never stored.** Inbox size, remaining minutes, pace, overdue recalls — all computed from state at render, so the ritual checklist cannot go stale relative to reality.
- **One render path.** `views.renderAll()` paints every surface including any open sheet, so there is no second sync mechanism to fall out of step.
- **Blank start is a feature.** Seeding example lectures would violate Rule 1 and make the pace maths lie.

### 11.10 Honest limits

- Deep/light is **ordering**, not gap *sizing*. A 90-minute deep block will take the first gap large enough rather than being split across two 45-minute morning gaps. A gap-packing pass would be the next step.
- Study `.ics` is a snapshot download, not a subscribed feed (static hosting).
- Recall markers are all-day and therefore alarm-free; the in-app Reviews tab and the weekly ritual carry the real prompting.
- The module has **no automated tests** (§14) — it is client-only and exercised by the manual verification list in §11.11.
- Full backup fidelity requires a `version: 3` file.
- Private/incognito mode: `localStorage` writes fail silently and nothing persists.

### 11.11 Manual verification checklist

Hard reload, then:

1. Console clean — no `does not provide an export named …` (that class of error is what a mislabelled module file produces).
2. Bind a lecture, run Focus ~3 min, **Pause** (not complete). Lecture actual bar shows 3m **and** hub `⏱ today` **and** the review sparkline **and** 🔥 streak all agree.
3. Week → **＋** on a day → picker opens with search, unassigned first → tap places it. Move and unassign paths work. `Esc` closes picker → sheet → drawer.
4. Capture 2 tasks (one ★, one 2m) → `p` → both in inbox; tick the 2m one → +2 min in the ledger; **→ Lecture** on the ★ one → opens its drawer pre-titled.
5. `w` → tick a ritual row (persists across reload) → **Mark reviewed today** → footer updates, hub red dot clears.
6. Matrix: demand pips present, frog chip gold-ringed, ⭐ on top-20% of Q1, `⚠ N/wk` / `✓ pace` once exams exist.
7. Drawer: **Focus demand** segment, median-estimate hint, pace note.
8. Tuning → set demands deep/medium/light across a subject, give them times, **⚡ Auto-plan** → deep cards carry `▲ peak` in the earliest gaps. Flip **Week ordering** to Block, re-run → subjects cluster.
9. **💾 Backup** → open the JSON, confirm `inbox`, `manual`, `review`, `anchor`, `version: 3` → **🗑 Clear** → **⬆ Restore** → inbox, ritual, streak and Leitner boxes all return.
10. With Tuning → *Put recalls in .ics* on, mark a lecture done → **📅 Calendar (.ics)** → import → `↻ Recall B1 · Subject` all-day marker on the +1d date. Toggle off → only study blocks.
11. **✅ Task apps (.csv)** → `[Inbox] …` rows present.
12. **🌙 Wrap day** → today's undone planned work returns to the pool, undoable from the toast.

---

## 12. Local development

Requirements: **Python 3.12+** and **Node 22+**. No npm dependencies, no install step.

```bash
# serve the site (must be over HTTP, not file://)
python -m http.server 8080        # or: npm run preview
# → http://localhost:8080                 (timetable)
# → http://localhost:8080/study.html      (study plan)

# validate all data contracts and references
python tools/validate-data.py     # or: npm run validate

# run the engine test suite
node --test tests/                # or: npm test

# regenerate every static feed into calendar/feeds/
node tools/generate-calendars.mjs # or: npm run generate-calendars
```

After editing JS or CSS, hard-reload with DevTools → Network → **Disable cache** (`Ctrl/Cmd + Shift + R`); ES modules are cached aggressively. The study plan needs no generator run — it reads the same JSON the timetable page reads.

---

## 13. Data editing cookbook

Every recipe below is **data-only**. Finish with: validate → test → generate → bump `dataVersion` → changelog → commit → push.

**Add a program**
1. Append to `data/programs/programs.json` (`id`, `name`, `academicYears[]`, `semesters[]` with `yearLevel`, `datasets`, `blackouts`).
2. Create `data/schedules/<program>/<year>/<semester>/{courses,lectures,practicals,exams,exceptions}.json`.
3. Create `data/students/assignments/<program>/<year>.json` with `yearLevel`, ranges and subdivisions.
4. Add the cohort to `manifest.assignments` with `programId`, `academicYearId`, `yearLevel`, `path`. Dropdowns, feeds **and the study plan's subject rows** appear automatically.

**Add a year level to an existing program** — add the semester with its `yearLevel`, add its assignment document, add a manifest cohort entry with that `yearLevel`. Leave `legacyAlias` off the new cohort; the original cohort keeps owning the flat paths.

**Add an academic year / semester** — append under the program; set `yearLevel`, window, datasets. No engine change.

**Add a course** — append to `courses.json` with a unique `id`, `code`, `title`, `color`.

**Add a lecture** — append to `lectures.json` with `day`, `start`, `end`, `groups`, `location`, `shorthand`, `displayCode`.

**Add a practical** — append to `practicals.json` with `sessions[]` per group (add `subdivision`/`batch`/`from`/`to` when sections are split).

**Make a section alternate A/B** — add the `rotation` block from §8.3. Choose `startWeek` so the observed week lands on the right letter; the pattern backdates automatically.

**Add an exam / quiz** — append to `exams.json` with `date` (+`sessions` for per-subgroup slots), or `allDay: true` when the time is not yet announced. This is what drives the study plan's exam chips, Eisenhower urgency and pace maths.

**Cancel one occurrence** — add a `cancel` exception referencing `eventId` + `date`. It renders struck-through, exports `STATUS:CANCELLED`, **and frees that hour for study** (§8.5).

**Remove a slot entirely** — delete the definition (and any exceptions referencing it). Use this when a recurring window produced *only* cancelled dates.

**Move a lecture to another weekday from a date** — split into two definitions with adjacent `validFrom`/`validUntil` windows (this is how Drug Information moved from Tuesday to Wednesday on 18 Nov).

**Add a college-wide event** — append to `data/institution/events.json` only. No timetable file is touched. All-day events appear as banners in the study week without consuming capacity.

**Recolour a subject** — change that course's `color`.

**Change student ranges** — edit the assignment file; keep `sourceReview` notes for anything unverified.

---

## 14. Validation and tests

`tools/validate-data.py` (standard library only) checks:

- JSON syntax and required fields for every referenced file.
- Manifest keys, `Africa/Cairo` timezone, dataset path existence.
- Unique program / year / semester / course / event / institution-event IDs.
- Course, program, year and semester references.
- Time (`HH:MM`) and date (`YYYY-MM/YYYY-MM-DD`) formats; `start < end`; validity and blackout ordering.
- Building codes and integer floors.
- Assignment ranges: numeric, ordered, non-overlapping; explicit-list duplicates; subdivision ranges.
- Sessions: group present, `from ≤ to`, and **batch-aware duplicate detection** — `group + subdivision + batch` or `group + subdivision + time` must be unique (multiple batches per group are legitimate).
- `rotation` shape, `allDay` boolean, exception references/actions/dates, and the requirement to name a `group` when an exception targets a multi-session event.
- Institution audience scopes and their references; every event must have a materializable window.

Semantic behaviour is covered by `node --test`:

| Suite | Covers |
|---|---|
| `engine.test.mjs` | shared lectures for all groups, group-specific practicals, college-wide events without classes, cancel exceptions, overlap detection, mid-term blackout keeping exams |
| `exams.test.mjs` | examinations materialize once on their exact date for every group |
| `institution-allday.test.mjs` | all-day single date and multi-day range overlap logic |
| `resolver.test.mjs` | range + subdivision resolution, uncovered-subdivision gap, open-ended ranges, unknown IDs, ambiguous matches |
| `shorthand.test.mjs` | `L/P/E`, `N/O`, floor `0`, compact/lowercase forms, rejection of bad input |

Schedule conflicts are intentionally detected in the JS engine only, so there is exactly one scheduling implementation.

**The study module is deliberately outside both suites.** It publishes no data, so the Python validator has nothing to check, and it holds no scheduling logic, so there is no second engine to regression-test against `engine.test.mjs`. Its correctness rests on (a) importing only the tested shared layers, and (b) the manual checklist in §11.11. If it ever grows logic worth locking down, the natural homes are `tests/study-planner.test.mjs` for `planner.js` (pure, DOM-free by construction) and `tests/study-store.test.mjs` for date math, Leitner promotion and the ledger — both import cleanly without a browser.

---

## 15. CI/CD and deployment

`.github/workflows/ci.yml` runs on every push and pull request:

1. `actions/checkout`, Python 3.12, Node 22.
2. **Validate data** → `python tools/validate-data.py`.
3. **Run tests** → discovers `*.test.{js,mjs,cjs}` and runs `node --test` (fails with a clear message if none are found).
4. **Generate feeds** → `node tools/generate-calendars.mjs`, writing canonical year-scoped feeds plus any declared legacy aliases, and removing the legacy stray institution file.
5. **Publish feeds** *(push to default branch only)* → `touch .nojekyll`, `git add .nojekyll calendar/feeds`, and if anything changed, commit `chore: regenerate calendar feeds [skip ci]` and push. Requires `permissions: contents: write`. The `[skip ci]` tag plus the no-change guard prevent loops.
6. **Upload artifact** `calendar-feeds` for inspection.

Deployment: **Settings → Pages → Deploy from a branch → `main` / root**. `.nojekyll` disables Jekyll processing.

> An Actions **artifact is not a published site**. Feeds are only reachable on Pages because step 5 commits them into the repository.
>
> Study-plan changes (steps 1–4 are no-ops for them) go live straight from the repo — `study.html`, `study.css`, `study-extras.css` and `study/**` are ordinary static assets.

---

## 16. Current dataset

### PharmD — Semester 5 (Year 3), 2026/2027

- **7 courses**, **8 lecture definitions**, **19 practical definitions**, **10 examinations**.
- Practicals: 5 weekly (Scientific Writing, Basic Pharmacology, Pharmaceutics III, Pharmaceutical Microbiology, Phytochemistry I) + 9 dated Drug Information tutorials + 4 ChemSketch cycles + 1 Wet Lab cycle.
- **ChemSketch** (Simulation lab, New Building floor 4): Wednesdays 30 Sep (A), 7 Oct (B), 14 Oct (A), 21 Oct (B). Six hourly slots 09–10, 10–11, 11–12, 12–13, 13–14, 14–15, ordered `1A, 1A, 3A, 3A, 2A, 2A`, each restricted to a seat-number batch.
- **Wet Lab**: Wednesdays, 09–11 (section 1), 11–13 (section 3), 13–15 (section 2); Week 1 = Group A, Week 2 = Group B. Held in the Pharmaceutical Chemistry Lab (Old Building, floor 2) and Organic Chemistry Lab (New Building, floor 4). Structure stored but **not materialized** until dates are confirmed.
- **Drug Information tutorials** (Computer Hall, New Building ground floor): 27 Sep A, 4 Oct B, 11 Oct A, 18 Oct B, 25 Oct A, 8 Nov B, 15 Nov A, 22 Nov B, 29 Nov A+B — topics carried in each event's description.
- **Examinations**: 7 mid-terms (31 Oct–5 Nov, New Building); **Drug Design Quiz 1** on 18 Nov in the Pharmaceutical Chemistry Lab (Old Building, floor 2), six 30-minute slots `1A 09:00, 1B 10:00, 3A 11:00, 3B 12:00, 2A 13:00, 2B 14:00` — all students attend the same week, and students from higher levels attend at their fixed time starting from the first section; **Drug Information final practical** A on 6 Dec, B on 13 Dec (times/rooms not yet announced, stored all-day).
- Groups **1, 2, 3**, each with **A/B** subdivisions (`2415001`–`2415076`, `2415077`–`2415148`, `2415149`–end).
- Drug Information lecture: Monday until 29 Oct, then **Wednesday from 18 Nov**; the Tuesday 10/17 Nov occurrences were cancelled and removed entirely.

### PharmD (Clinical Pharmacy Program) — Semester 3 (Year 2), 2026/2027

- **8 courses**, **8 lecture definitions**, **6 practical definitions**, examinations pending publication.
- Groups **1, 2**, each with **A/B** (`2510001`–`2510047`, `2510048`–end).
- **Biochemistry-I** practical alternates A/B (10 Nov = A, 17 Nov = B, backdated to 22 Sep = A); all other Clinical practicals run weekly for every group.
- The college-wide mid-term blackout applies; no Clinical exam timetable has been supplied yet.

### Institution

Fall 2026/2027 academic calendar transcribed as college-wide all-day events: registration windows, fee penalties, add/drop, 6 October holiday, mid-term week, end of classes, revision, final-exam period, results, mid-year vacation.

> **Effect on the study plan.** The 7 mid-term exams and Drug Design Quiz 1 are what populate the exam chips, drive Eisenhower urgency and make `paceFor()` meaningful for PharmD Year 3. Because Clinical examinations are still unpublished, the Clinical study plan shows `—` for exam proximity and treats `must` priority as the urgency proxy — the page degrades gracefully rather than inventing dates.

---

## 17. Data caveats (`sourceReview`)

Unverified information is **never silently presented as confirmed**. Records carry `sourceReview[]` codes, the UI shows a `Needs review` badge, and the ICS `DESCRIPTION` repeats the note.

| Code | Meaning |
|---|---|
| `SEMESTER_WINDOW_FROM_PROVISIONAL_CALENDAR` | Semester bounds come from a calendar that states its dates are approximate |
| `CALENDAR_DATES_APPROXIMATE` | Same disclaimer on individual college-wide events |
| `HOLIDAY_DATE_SUBJECT_TO_CHANGE` | 6 October holiday marked with an asterisk in the source |
| `REVISION_PLACEMENT_AMBIGUOUS` | Revision bullet shares a row with "End of classes" |
| `MERGED_CELL_SPAN` | Final-exam span inferred from a merged table cell |
| `RESULTS_VACATION_TENSION` | Results week and vacation start share 23 Jan |
| `SCOPE_ALL_TEMPORAL` | Fall calendar uses `scope: all`; re-target when spring datasets exist |
| `LOCATION_MULTI_UNCONFIRMED` | Source lists two halls for one practical |
| `SUBDIVISION_GAP` | PharmD group 2: ID `2415113` covered by neither A nor B |
| `SUBDIVISION_TRANSCRIPTION_AMBIGUOUS` | PharmD group 3 B boundary needs confirmation |
| `OPEN_ENDED_RANGE` | Clinical group 2 / 2B and PharmD 3B printed as "to the end" |
| `DATE_UNCONFIRMED` | Drug Design Wet Lab has structure but no calendar dates |
| `EXAM_TIMETABLE_NOT_YET_PUBLISHED` | Clinical examinations awaiting publication |
| `TIME_UNCONFIRMED`, `LOCATION_UNCONFIRMED` | Drug Information final practical exams: date/group only |
| `SOURCE_TYPO_CORRECTED` | `2215095 → 2415095`, `2215148 → 2415148` |
| `EXTERNAL_IDS_PRESENT` | ChemSketch batch 3B-4 includes `2435001`, `2435002` |
| `DAY_CHANGED_BY_DEPARTMENT_INSTRUCTION` | Drug Information lecture moved to Wednesday |
| `ALTERNATING_A_B_PATTERN`, `EVERY_WEEK_ALL_GROUPS` | Department confirmations of section cadence |
| `QUIZ_MODELED_AS_EXAMINATION` | Quiz 1 modelled as an assessment, not a section |

Because the study plan inherits exam dates and semester windows from this same data, `SEMESTER_WINDOW_FROM_PROVISIONAL_CALENDAR` and `EXAM_TIMETABLE_NOT_YET_PUBLISHED` propagate into its pace figures as caution, not as false precision — an unannounced exam yields `—`, never a guessed deadline.

---

## 18. Privacy and security

- **No authentication.** The student ID is a lookup key; the UI states plainly that schedules are public and the ID is not a password.
- **No name directory**, no personal data beyond ID ranges that the faculty already publishes.
- IDs are masked in the summary (`•••5001`) and never persisted; only the reminder preference and the last-seen `dataVersion` are stored in `localStorage`.
- No analytics, no trackers, no third-party runtime requests — everything is served from the same origin.
- **Study-plan state never leaves the browser.** Lectures, notes, inbox captures, focus logs, streaks and review history live under one `localStorage` key derived from `programId|academicYearId|yearLevel|practicalGroup|subdivision` — **no student ID, no name, no device identifier**. There is no sync endpoint, so there is nothing to breach and no server-side copy to delete.
- The only way plan data crosses devices is a **user-initiated JSON backup** they download and hold themselves. `savePlan()` fails silently under quota or private mode rather than leaking state elsewhere.
- Because the data is public by design, **do not commit anything confidential** to `data/`.

---

## 19. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| One-click subscribe opens Google but no confirmation appears | Intermittent `render?cid=` behaviour, or the calendar is already subscribed | Use **Add manually (backup)** — it copies the URL and opens Add by URL. Remove any existing entry first |
| Feed URL has no year segment | Older build gated the year behind "more than one cohort" | Year-scoped templates are now used whenever the level is known; manifest cohorts carry `yearLevel` |
| Existing feed URL stopped working after adding a year | Flat path ownership was implicit | Mark the original cohort `legacyAlias: true`; it keeps publishing the flat copies |
| `'fetch' called on an object that does not implement interface Window` | Native `fetch` invoked with the wrong receiver | `loader.js` calls `Reflect.apply(fn, globalThis, [url, init])`; never store a bare `fetch` reference |
| `Failed to load …/lectures.json: 404` | Dataset file absent or path/case mismatch | Create the exact path from `programs.json`; the loader lists all missing datasets at once |
| `Loading module … was blocked because of a disallowed MIME type ("text/html")` | A JS module is missing, so Pages returns its 404 HTML page; the whole `app.js` graph fails and **every** button stops working | Create the missing file (this happened with `schedule/reminders.js`) |
| `Cannot find module '…/tests'` | `tests/` not committed | Commit `tests/*.test.mjs`; CI discovers test files and fails with a readable message |
| Validator: `duplicate session group N` | Older validator assumed one session per group | Batch-aware validator: duplicates are `group+subdivision+batch` or `group+subdivision+time` |
| Google: *"…is not a valid email address"* | Feed URL pasted into an email field | Use the subscribe button, or **Add calendar → From URL** |
| Feed URL returns 404 | Feeds only existed as an Actions artifact | Ensure the CI publish step committed `calendar/feeds/` |
| Search bar overflows on mobile | Auto-sized grid track + sub-16px input focus zoom | `grid-template-columns: minmax(0,1fr)`, `min-width: 0`, 16px inputs, stacked button under 480px |
| Changes don't appear | Cached ES modules / JSON | Hard reload with cache disabled; bump `manifest.dataVersion` |
| Stray `institution/group-null.ics` | Legacy generator revision | Removed automatically by the current generator; canonical feed is `calendar/feeds/institution.ics` |
| Study page: console `… does not provide an export named 'X'` | A study module was written to the wrong path — `study-app.js` (entry) and `study/store.js` (state) are **different files** | Confirm both exist with their distinct first-comment lines; the entry imports *from* `./study/store.js` |
| Study matrix empty on first load | Blank start by design (§11.1) | **＋12** per row, or **Create 12 empty lectures per subject** |
| Chips show `—` | No duration set; untimed lectures can't be auto-planned or given clock times | Set the estimate in the drawer (0 is a legitimate "unknown", but it can't be scheduled) |
| Auto-plan says "not enough free time" | Real classes genuinely consume the week | Honest, not a bug. Widen the study window in Tuning, or cut scope |
| Block flagged "outside your usual study window" | Overflow: fits the day, not the window | Widen the window, or move the block |
| 🔥 streak 0 despite studying | No *logged* minutes yet | Run a focus session or tick a 2m item; the ledger only knows what was recorded |
| Streak and a lecture's actual bar disagree | Would mean a session row wasn't written on a partial commit | Check `timer.logFocus()` writes `sessions.push()` unconditionally for every `delta > 0` (§11.5) |
| Recalls missing from Google | Tuning switch off, or all-day events carry no alarm by spec | Enable **Put recalls in .ics**; expect a quiet all-day marker, not a notification |
| Backup restored but inbox/streak gone | The file is `version: 2` (pre `inbox/manual/review`) | Re-export once to upgrade; v3 carries the whole plan |
| Nothing persists on the study page | Private/incognito mode | Use a normal window; `savePlan()` swallows the failure by design |
| **＋ Add a lecture** does nothing | `views.js` missing the picker exports | `openPicker` / `setPickerQuery` / `pickerAssign` / `pickerMove` / `pickerUnassign` / `closePicker` must all be exported |
| Ritual checkboxes / "Mark reviewed today" dead | Handlers wired to `click` on elements inside `<label>` (double-fire), or missing | Both go through the single `change` dispatcher: `x-check` → `V.checkRitual`, `x-mark-reviewed` → `V.markReviewed` |

---

## 20. Known limitations and roadmap

**Limitations**
- Google ignores feed alarms and per-event colours on subscribed calendars; the in-page engine covers reminders while the tab is open.
- Google's one-click endpoint can be intermittent; the manual Add-by-URL backup is always available.
- Whole-group feeds are a fallback: rotating sections appear every week there, labelled with the active subdivision. Subgroup feeds are the accurate ones.
- Drug Design Wet Lab is stored but not materialized (no confirmed dates).
- Clinical examinations are empty pending publication — the study plan shows `—` for exam proximity there rather than inventing a deadline.
- No `schemas/courses.schema.json` yet; courses are validated structurally by the Python validator.
- Reminders require the page to be open — a static site cannot deliver background push.
- Study `.ics` is a snapshot download, not a subscribed feed (§9.7).
- Study-plan energy-aware placement is **ordering**, not gap sizing (§11.10).
- Study-plan state is browser-local: no sync, no cross-device continuity except a manual JSON backup the user owns.
- The study module has no automated test coverage (§14).

**Roadmap (not implemented, deliberately)**
Name-based lookup · course materials · results · announcements · attendance · room directory / campus maps · event registration · student organizations · academic progress · background notifications · admin data-entry tools · timetable document import · multi-college support · gap-packing for deep blocks · Leitner-box tuning from lapse data · optional server sync behind an explicit opt-in.

The architecture already separates students, programs, events, courses, locations and schedules so these can be added without rewriting the scheduling core, and separates the study module from that core so plan features can be added without touching it.

---

## 21. Contributing conventions

1. **Data first.** If a change can be expressed in JSON, it must be. Never hardcode course names, IDs, groups, years, ranges, buildings or semesters in JS.
2. **Stable identifiers.** Never reuse an event/course/rule `id`; retired IDs stay retired.
3. **Stable URLs.** A published feed path is a promise. Change the scheme only by adding new canonical paths and preserving the old ones as declared aliases.
4. **Structured fields are authoritative.** Shorthand is a display/input convenience.
5. **Flag uncertainty.** Add `sourceReview` rather than guessing dates, rooms or boundaries.
6. **Cancel vs delete.** Use a `cancel` exception for a single occurrence; delete a definition only when its whole window is dead (and remove its exceptions).
7. **Full-file edits.** Replace whole files rather than partial patches, so the repository never drifts from the reviewed version.
8. **One scheduling implementation.** Recurrence, rotation, blackouts, sessions, exceptions, targeting and conflicts live in `schedule/engine.js`. The study module consumes its output and must not reimplement any of it.
9. **Study module: blank start is a rule, not a default.** Never seed lectures, durations or dates. Never write to `data/`. Every mutation goes through `snapshot()` so it is undoable. Keep `demand` orthogonal to `pri`. Keep the ledger single-sourced: every committed minute writes a dated session row.
10. **Study module: file map matters.** `assets/js/study-app.js` is the entry point; `assets/js/study/store.js` is the state layer. They are not interchangeable and share no first-comment line.
11. **Before pushing:** `python tools/validate-data.py` → `node --test tests/` → `node tools/generate-calendars.mjs`, bump `manifest.dataVersion`, add a `changelog.json` entry. (Study-only changes need none of the generator steps, but still bump `dataVersion` if any JSON moved.)
12. **Never commit secrets or personal data.** Everything under `data/` is public.

---

## 22. License

Licensed under the **Apache License, Version 2.0** — see [LICENSE](LICENSE).

```text
Copyright 2026 HunterThief

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0
```

Timetable content originates from faculty documents; the license covers the software and data architecture, not the underlying academic records.

---

## 23. Acknowledgements

Schedule data transcribed from official documents of the **Faculty of Pharmacy, Alexandria University** — Education and Student Affairs Administration, Pharmaceutical Chemistry Department, and Department of Clinical Pharmacy and Pharmacy Practice:

- PharmD 5th Semester lecture and practical timetables, 2026/2027
- PharmD (Clinical Pharmacy Program) 3rd Semester lecture and practical timetables, 2026/2027
- Fall Semester 2026/2027 academic calendar
- PharmD mid-term examination timetable
- Drug Design ChemSketch cycle, Wet Lab cycle and Quiz-1 timetables
- Provisional Drug Information tutorials content and distribution

Any discrepancy between this platform and an official faculty document should be reported so the JSON can be corrected and republished.
