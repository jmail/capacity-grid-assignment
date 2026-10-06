// Calendar dates travel as 'YYYY-MM-DD' strings and are only ever interpreted in
// UTC. Going through local time shifts them by a day for anyone west of Greenwich.

const DAY_MS = 86_400_000

/** Mirrors maxRangeWeeks in api/capacity.go; the server enforces it. */
export const MAX_RANGE_WEEKS = 26

/** A span of whole weeks: `from` is a Monday, `to` is a Sunday. */
export type Range = { from: string; to: string }

function toUTC(iso: string): number {
  const [year, month, day] = iso.split('-').map(Number)
  return Date.UTC(year, month - 1, day)
}

function fromUTC(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

export function isISODate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && fromUTC(toUTC(value)) === value
}

export function addDays(iso: string, days: number): string {
  return fromUTC(toUTC(iso) + days * DAY_MS)
}

/** Monday of the week the date falls in. */
export function startOfWeek(iso: string): string {
  const day = new Date(toUTC(iso)).getUTCDay() // 0 is Sunday
  return addDays(iso, -((day + 6) % 7))
}

/** Sunday of the week the date falls in. */
export function endOfWeek(iso: string): string {
  return addDays(startOfWeek(iso), 6)
}

/** Number of weeks touched by from..to, counting partial weeks. */
export function weekCount(from: string, to: string): number {
  return Math.round((toUTC(startOfWeek(to)) - toUTC(startOfWeek(from))) / (7 * DAY_MS)) + 1
}

/** Today's date where the manager is sitting. */
export function today(): string {
  const now = new Date()
  return fromUTC(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()))
}

/** ISO 8601 week number: week 1 is the week holding the year's first Thursday. */
export function isoWeek(iso: string): { year: number; week: number } {
  const thursday = toUTC(addDays(startOfWeek(iso), 3))
  const year = new Date(thursday).getUTCFullYear()
  const week = Math.floor((thursday - Date.UTC(year, 0, 1)) / (7 * DAY_MS)) + 1
  return { year, week }
}

export function wholeWeeks(from: string, to: string): Range {
  return { from: startOfWeek(from), to: endOfWeek(to) }
}

export function shiftRange(range: Range, weeks: number): Range {
  return { from: addDays(range.from, weeks * 7), to: addDays(range.to, weeks * 7) }
}

/** Why from..to can't be shown, or null when it can. */
export function rangeError(from: string, to: string): string | null {
  if (!isISODate(from) || !isISODate(to)) return 'Pick both a start and an end date.'
  if (from > to) return 'The start date must be on or before the end date.'
  if (weekCount(from, to) > MAX_RANGE_WEEKS) return `Pick ${MAX_RANGE_WEEKS} weeks or fewer.`
  return null
}

const dayMonth = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
const dayMonthYear = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
})

export function formatDay(iso: string): string {
  return dayMonth.format(toUTC(iso))
}

export function formatDayWithYear(iso: string): string {
  return dayMonthYear.format(toUTC(iso))
}
