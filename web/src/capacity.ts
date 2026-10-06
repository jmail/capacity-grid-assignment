import type { CapacityResponse, Person } from './api'

/** Upper bound for weekly hours; mirrors maxWeeklyHours in api/people.go. */
export const MAX_WEEKLY_HOURS = 168

export type CellStatus = 'over' | 'full' | 'under' | 'empty'

/**
 * How one week looks against capacity. Exactly at capacity is full, not over, and
 * any allocation against zero capacity is over.
 */
export function cellStatus(allocated: number, weeklyHours: number): CellStatus {
  if (allocated > weeklyHours) return 'over'
  if (allocated === 0) return 'empty'
  if (allocated === weeklyHours) return 'full'
  return 'under'
}

export function overWeeks(allocated: number[], weeklyHours: number): number {
  return allocated.filter((hours) => hours > weeklyHours).length
}

/**
 * Replaces one person's details in a cached range. Everyone else keeps their
 * object identity, so memoised rows for other people do not re-render.
 */
export function applyPersonUpdate(data: CapacityResponse, person: Person): CapacityResponse {
  let changed = false
  const people = data.people.map((current) => {
    if (current.id !== person.id) return current
    if (current.weeklyHours === person.weeklyHours && current.name === person.name) return current
    changed = true
    return { ...current, name: person.name, weeklyHours: person.weeklyHours }
  })
  return changed ? { ...data, people } : data
}

/** Why a typed value can't be saved as weekly hours, or null when it can. */
export function weeklyHoursError(input: string): string | null {
  if (input.trim() === '') return 'Enter the hours per week.'
  const hours = Number(input)
  if (!Number.isFinite(hours)) return 'Enter the hours per week as a number.'
  if (hours < 0 || hours > MAX_WEEKLY_HOURS) return `Enter between 0 and ${MAX_WEEKLY_HOURS} hours.`
  return null
}

const hoursFormat = new Intl.NumberFormat('en', { maximumFractionDigits: 2 })

export function formatHours(hours: number): string {
  return hoursFormat.format(hours)
}
