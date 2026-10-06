import { describe, expect, it } from 'vitest'
import type { CapacityResponse } from './api'
import { applyPersonUpdate, cellStatus, overWeeks, weeklyHoursError } from './capacity'

describe('cellStatus', () => {
  it('is over only when allocation exceeds capacity', () => {
    expect(cellStatus(45, 40)).toBe('over')
    expect(cellStatus(40, 40)).toBe('full')
    expect(cellStatus(30, 40)).toBe('under')
    expect(cellStatus(0, 40)).toBe('empty')
  })

  it('treats any allocation against zero capacity as over', () => {
    expect(cellStatus(20, 0)).toBe('over')
    expect(cellStatus(0, 0)).toBe('empty')
  })
})

describe('overWeeks', () => {
  it('counts the weeks above capacity', () => {
    expect(overWeeks([0, 45, 40], 40)).toBe(1)
    expect(overWeeks([0, 45, 40], 48)).toBe(0)
    expect(overWeeks([0, 45, 40], 32)).toBe(2)
  })
})

describe('applyPersonUpdate', () => {
  const data: CapacityResponse = {
    from: '2026-01-05',
    to: '2026-01-11',
    weeks: ['2026-01-05'],
    people: [
      { id: 1, name: 'Ana Ferreira', weeklyHours: 40, allocated: [0] },
      { id: 4, name: 'Dee Okafor', weeklyHours: 40, allocated: [45] },
    ],
  }

  it('replaces the saved person and keeps their allocations', () => {
    const next = applyPersonUpdate(data, { id: 4, name: 'Dee Okafor', weeklyHours: 48 })

    expect(next.people[1]).toEqual({ id: 4, name: 'Dee Okafor', weeklyHours: 48, allocated: [45] })
    expect(data.people[1].weeklyHours).toBe(40) // the cached object is not mutated
  })

  it('leaves everyone else untouched, so their rows do not re-render', () => {
    const next = applyPersonUpdate(data, { id: 4, name: 'Dee Okafor', weeklyHours: 48 })

    expect(next.people[0]).toBe(data.people[0])
  })

  it('returns the same object when there is nothing to change', () => {
    expect(applyPersonUpdate(data, { id: 4, name: 'Dee Okafor', weeklyHours: 40 })).toBe(data)
    expect(applyPersonUpdate(data, { id: 99, name: 'Not in this range', weeklyHours: 10 })).toBe(data)
  })
})

describe('weeklyHoursError', () => {
  it('accepts whole and fractional hours within a week', () => {
    expect(weeklyHoursError('0')).toBeNull()
    expect(weeklyHoursError('37.5')).toBeNull()
    expect(weeklyHoursError('168')).toBeNull()
  })

  it('rejects blanks, non-numbers and impossible values', () => {
    expect(weeklyHoursError('')).not.toBeNull()
    expect(weeklyHoursError('forty')).not.toBeNull()
    expect(weeklyHoursError('-1')).not.toBeNull()
    expect(weeklyHoursError('169')).not.toBeNull()
  })
})
