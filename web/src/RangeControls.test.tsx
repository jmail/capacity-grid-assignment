import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RangeControls } from './RangeControls'

// Seventeen weeks, so a button that only moved the window would be easy to tell apart.
const WIDE = { from: '2026-01-05', to: '2026-05-03' }

describe('RangeControls', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 9, 7, 12)) // Wednesday 7 October 2026
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows only the current week on This week, whatever span was on screen', () => {
    const onChange = vi.fn()
    render(<RangeControls range={WIDE} onChange={onChange} />)

    fireEvent.click(screen.getByRole('button', { name: 'This week' }))

    expect(onChange).toHaveBeenCalledWith({ from: '2026-10-05', to: '2026-10-11' })
  })

  it('moves the whole window by one week and keeps its length', () => {
    const onChange = vi.fn()
    render(<RangeControls range={WIDE} onChange={onChange} />)

    fireEvent.click(screen.getByRole('button', { name: 'Move the range one week earlier' }))
    expect(onChange).toHaveBeenLastCalledWith({ from: '2025-12-29', to: '2026-04-26' })

    fireEvent.click(screen.getByRole('button', { name: 'Move the range one week later' }))
    expect(onChange).toHaveBeenLastCalledWith({ from: '2026-01-12', to: '2026-05-10' })
  })

  it('widens picked dates to whole weeks, and holds back a range it cannot show', () => {
    const onChange = vi.fn()
    render(<RangeControls range={WIDE} onChange={onChange} />)

    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-01-14' } })
    expect(onChange).toHaveBeenLastCalledWith({ from: '2026-01-05', to: '2026-01-18' })

    onChange.mockClear()
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2025-01-01' } })
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('The start date must be on or before the end date.')
  })
})
