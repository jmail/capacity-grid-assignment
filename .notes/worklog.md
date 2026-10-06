# Worklog

Running notes on how this got built — decisions, assumptions, dead ends, and anything
left unfinished. Append as you go; a line or two per entry is right.

---

## The data

- Seed: 500 people, 12 projects, 126,195 assignment rows, 2025-06-02 to 2027-01-03.
- `hours_per_day` holds 0.125 to 1.0. First read was "these are fractions of a day, multiply by 8". Wrong:
  every logical assignment is 15 rows, 14 of x and one of 2x, adding up to 16x (Ana: 14 × 0.5 + 1.0 = 8h/day).
  The query sums rows as they are. De-duplicating the "duplicates" would report 1.5h/day.
- REVERSED LATER, see "Weekends count" below. First assumption: working days are Monday to Friday. 46,665 rows end on a weekend, none start on one. Ana's
  Mon–Sun assignment at 8h/day is 40h (exactly full) under this rule and 56h if weekends count. Seed-wide the
  95th-percentile week is exactly 40h and the maximum 45h; counting weekends would make 4,779 of 13,741
  allocated person-weeks over instead of 1,626. Weekend work, holidays and time off are not modelled.
- Seen, left alone: every third week is almost empty (w/c 2025-12-22: 0 people allocated, 2026-01-12: 4,
  2026-02-02: 0). Checked by counting assignments directly; it is the seed's three-week cycle, not the query.
- Seen under the Mon–Fri rule (no longer how it is counted): over-allocation was nearly all part-timers. Of the
  1,626 over person-weeks one belonged to a 40h person (Dee, 45h); the rest were 20/24/32h people booked up to 40h.
- Eli Nakamura has 0 capacity and 20h allocated. Shown as "+20h over". Nothing in the grid is a percentage,
  so there is nothing to divide by zero.

## API

- A range is widened to whole weeks and echoed back. The starter range ends on a Friday; a clipped week would
  show part of the allocation against a full week of capacity.
- One request is capped at 26 weeks (400 beyond that). People are not paginated: fine for 500, not for
  thousands. Deferred, see the end.
- Shape: capacity once per person, allocations as an array aligned with `weeks`. The schema has one
  `weekly_hours` per person, so every over-allocation flag is derived at render and an edit changes one number.
  26 weeks × 500 people is 63 KB in about 0.17s.
- Query plan for 26 weeks uses the `(start_date, end_date)` index once per week. `EXPLAIN ANALYZE` reported
  231ms, about 176ms of it starting `generate_series`. Not investigated; the same request over HTTP takes 0.17s.
- `PATCH /api/people/{id}` takes `{"weeklyHours": n}`, 0 to 168, stored to two decimals, and returns the stored
  person. Last write wins; there is no version column to do better without touching the schema.
- Editing weekly hours also changes capacity for past weeks, because the schema has no effective date. Left.

## Grid

- After a save: the cache only holds values the server confirmed. An unconfirmed edit is kept beside it, keyed
  by person, and laid over the row while saving. On success every cached range is patched from the PATCH
  response, with no refetch. A range request that was in flight during the save is restarted, since it may
  have read the old value.
- A failed save has nothing to roll back. The row shows the saved value again, with what was typed, why it
  failed, and Retry (only for network and 5xx failures; a 400 would fail the same way again).
- Added TanStack Query for the per-range cache and for dropping responses to ranges the manager has left,
  rather than hand-rolling both.
- The range lives in `App` and in the URL, not in the grid, because the overview page will share it with the
  timeline.

## What went wrong along the way

- Added the dependency and ran the tests locally: green. The running app showed Vite's "Failed to resolve
  import" because the web container had not installed it. `docker compose restart web` re-runs `npm install`.
- Looking at the running grid: every "Inés" came after every "Ingrid". The database collation compares bytes
  (`datlocprovider = c`). Wrote a test that failed, then ordered by `COLLATE "und-x-icu"`.
- Looking at the running grid: a save error widened the person column and shifted every week. The column now
  has a fixed width. The grid box also spanned the page for a three-week range; it now hugs the table.
- The roster has right-to-left names (Hebrew, Arabic). Names are rendered with `dir="auto"`.
- "This week" kept whatever span was on screen and only moved its start, so with four months showing it still
  loaded four months. Caught by clicking through the app by hand, not by a test. It now shows the current week
  only, with a test that failed first.
- The range controls were a row of three look-alike buttons (previous, this week, next) beside the dates. Using
  it showed the problem: nothing said that two of them move the range and one replaces it. The week steppers
  now sit on either side of the dates they move and keep the span; "This week" stands apart.

- Asked whether changing the range runs more queries than it needs to, and measured instead of guessing. A
  request the manager has left is aborted in the browser, and that reaches Postgres: after dropping a 26-week
  request at 20ms nothing was left running. But the API logged every one as `capacity rows: context canceled`
  and tried to answer 500. Cancelled requests are now dropped quietly, with a test that failed first.
- No debounce on range changes, on purpose: it would delay every single step, and superseded requests are
  cancelled anyway. What is still redundant: a one-week step refetches the whole window, and changing From and
  then To loads the range in between.

- A Go test pinned the seed's `weekly_hours` and failed once Ana had been edited to 41.12 through the app. The
  test was wrong, not the app: it asserted a number the product lets managers change. It now pins allocations
  only, and the PATCH test restores whatever value it found rather than assuming the seed's.

- Weekly hours were accepted at any precision and silently rounded to two decimals on save: typing 41.12566476
  stored 41.13, a number nobody chose. Found by typing it into the running grid. Weekly hours are now quarter
  hours (0.25 covers contracts like 37.5 and 38.75); anything finer is refused in the editor and by the API
  instead of being rounded. This replaces "stored to two decimals" above.

## Three questions raised while using it

- Two managers with the grid open: the later save used to win silently, decided from a number that was no
  longer true. This replaces "last write wins" above. A save now carries the value it is changing from, and the
  API applies it only if that is still what is stored; otherwise 409 with the stored person. The grid then
  shows the other manager's value and asks: save mine anyway, or keep theirs. No version column exists and the
  schema is fixed, so the value itself is the precondition (40 → 32 → 40 by someone else goes unnoticed, which
  is harmless here). A 409 that reports the very value being saved is treated as saved: it is our own earlier
  attempt whose reply was lost. Checked against the running stack with a second writer.
- Still missing for two managers: nothing pushes the change. The second one keeps seeing the old number until
  they save, come back to the tab after 30s, or change the range.
- Changing weekly hours changes past weeks too. That is wrong for a manager, and not fixable here: there is one
  `weekly_hours` per person and the schema is fixed. It needs capacity with a start date, capacity per cell in
  the response, and a separate, deliberate way to correct history. For now the editor says "Applies to every
  week, past ones included" so the effect is at least not a surprise.
- Pagination for a few thousand people: not built, and it is the largest gap. It is not one change but four
  that have to land together: a cursor in the API (name collation, id), the over-allocated filter and count
  moved to the server, loading further pages in the grid, and row virtualisation. Half of that would have put
  the save path at risk for the last half hour. The range is capped at 26 weeks; the people axis is not capped.
- The web container died once while files were being saved (Vite read `api.ts` mid-write: ENOENT on the bind
  mount). `docker compose up -d web` brought it back. Environment, not code.

## Weekends count

- Reversed the Mon–Fri assumption. It was defended with seed statistics (no assignment starts on a weekend; the
  95th-percentile week came out at exactly 40h), and that was reading a rule into the data. The schema says
  nothing about who works which days, and people on shifts (retail, first-line support) work weekends as a
  matter of course. Dropping weekends reports a Wednesday-to-Sunday pattern as 24h when the person is booked
  for 40h. A missed overload costs a manager more than a false one, so every day of an assignment now counts.
- What it costs, on the untouched seed: 4,779 of 13,741 allocated person-weeks are over (was 1,626), including
  2,494 of 8,800 for people on 40h, all the way up to 56h (seven days at 8h). In the starter range 146 of 500
  people are over (was 41). Ana's Monday-to-Sunday assignment is 56h against 40h; Bo's Friday-to-Monday one
  puts 48h in one week.
- That may be over-reporting: "Monday to Sunday" could simply be how a one-week assignment was written. The
  data cannot tell the two apart. What settles it is a working pattern per person, or a weekend flag on the
  assignment, and a question to whoever owns the planning data.

## Verified

- Go tests against the seeded database inside the api container: `docker compose exec api go test ./...` (9).
- `docker compose exec web npm test` (32), and `npm run tsc`.
- Walked through in Chromium with screenshots: starter range, over-allocated filter, editing, saving, a save
  whose request was aborted, next week, 26 weeks (0.8s from changing the date to the last column on screen),
  an invalid range, dark scheme with the current week marked, right-to-left names.
- To see a failed save by hand: `docker compose stop api`, save a value, then `docker compose start api` and Retry.

## Not done

- Row virtualisation and people pagination. Everything is rendered: 500 people × 26 weeks is 13,000 cells.
- Capacity that varies by week (effective dates, time off, holidays). It changes the response shape and the
  after-save strategy, since one edit would no longer be one number.
- A cache keyed by week. Moving one week refetches the whole window.
- What a cell is made of: no breakdown by project.
- Live updates between managers. A conflicting save is caught (see above), but only at the moment of saving.
- Not tested with a screen reader. No arrow-key navigation between cells. No end-to-end test in the repo.
