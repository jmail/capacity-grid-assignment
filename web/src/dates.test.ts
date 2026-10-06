import { describe, expect, it } from 'vitest'
import {
  addDays,
  endOfWeek,
  isISODate,
  isoWeek,
  rangeError,
  shiftRange,
  startOfWeek,
  weekCount,
  wholeWeeks,
} from './dates'

describe('week boundaries', () => {
  it('starts weeks on Monday and ends them on Sunday', () => {
    expect(startOfWeek('2025-12-29')).toBe('2025-12-29') // a Monday
    expect(startOfWeek('2026-01-01')).toBe('2025-12-29') // Thursday, across the year boundary
    expect(startOfWeek('2026-01-04')).toBe('2025-12-29') // Sunday closes the week, it doesn't open one
    expect(endOfWeek('2026-01-16')).toBe('2026-01-18')
  })

  it('widens a range to whole weeks', () => {
    expect(wholeWeeks('2025-12-31', '2026-01-16')).toEqual({ from: '2025-12-29', to: '2026-01-18' })
  })

  it('counts every week a range touches', () => {
    expect(weekCount('2025-12-29', '2026-01-16')).toBe(3)
    expect(weekCount('2026-01-07', '2026-01-07')).toBe(1)
    expect(weekCount('2026-01-04', '2026-01-05')).toBe(2) // Sunday and the Monday after
  })
})

describe('date arithmetic', () => {
  it('moves by calendar days across clock changes, month ends and leap days', () => {
    expect(addDays('2026-03-28', 2)).toBe('2026-03-30') // European clocks go forward on the 29th
    expect(addDays('2026-10-24', 7)).toBe('2026-10-31') // and back on the 25th
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29')
  })

  it('shifts a range by whole weeks without changing its length', () => {
    const range = { from: '2025-12-29', to: '2026-01-18' }
    expect(shiftRange(range, -1)).toEqual({ from: '2025-12-22', to: '2026-01-11' })
    expect(shiftRange(range, 1)).toEqual({ from: '2026-01-05', to: '2026-01-25' })
  })
})

describe('isoWeek', () => {
  it('numbers weeks by the year that holds their Thursday', () => {
    expect(isoWeek('2025-12-22')).toEqual({ year: 2025, week: 52 })
    expect(isoWeek('2025-12-29')).toEqual({ year: 2026, week: 1 }) // starts in December, belongs to 2026
    expect(isoWeek('2026-10-06')).toEqual({ year: 2026, week: 41 })
    expect(isoWeek('2027-01-01')).toEqual({ year: 2026, week: 53 }) // 2026 has 53 weeks
  })
})

describe('rangeError', () => {
  it('accepts a range the grid can show', () => {
    expect(rangeError('2025-12-29', '2026-01-16')).toBeNull()
    expect(rangeError('2026-01-05', '2026-07-05')).toBeNull() // exactly 26 weeks
  })

  it('explains what is wrong otherwise', () => {
    expect(rangeError('', '2026-01-16')).toMatch(/start and an end/)
    expect(rangeError('2026-01-16', '2026-01-05')).toMatch(/on or before/)
    expect(rangeError('2026-01-05', '2026-07-06')).toMatch(/26 weeks or fewer/)
  })

  it('rejects dates that do not exist', () => {
    expect(isISODate('2026-02-30')).toBe(false)
    expect(isISODate('2026-2-3')).toBe(false)
    expect(isISODate('2026-02-28')).toBe(true)
  })
})
