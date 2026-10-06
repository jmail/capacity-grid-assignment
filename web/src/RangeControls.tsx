import { useEffect, useState } from 'react'
import { formatDayWithYear, rangeError, shiftRange, today, weekCount, wholeWeeks, type Range } from './dates'

type Props = {
  range: Range
  onChange: (range: Range) => void
}

// RangeControls moves the grid a week at a time, jumps to the current week, and
// lets the manager pick the dates directly. Whatever is picked is widened to
// whole weeks, because a column is a week and half a column would not mean anything.
export function RangeControls({ range, onChange }: Props) {
  // The inputs hold what was typed, which may not be a range we can show yet.
  const [draft, setDraft] = useState(range)
  useEffect(() => setDraft(range), [range])

  const problem = rangeError(draft.from, draft.to)
  const weeks = weekCount(range.from, range.to)

  const edit = (next: Range) => {
    setDraft(next)
    if (rangeError(next.from, next.to) === null) onChange(wholeWeeks(next.from, next.to))
  }

  return (
    <div className="range-controls">
      {/* The steppers sit on either side of the dates they move, so they read as "shift this range". */}
      <div className="range-stepper" role="group" aria-label="Date range">
        <button
          type="button"
          onClick={() => onChange(shiftRange(range, -1))}
          aria-label="Move the range one week earlier"
          title="Move the range one week earlier"
        >
          ← 1 week
        </button>
        <label>
          From
          <input
            type="date"
            value={draft.from}
            onChange={(event) => edit({ ...draft, from: event.target.value })}
            aria-invalid={problem !== null}
          />
        </label>
        <label>
          To
          <input
            type="date"
            value={draft.to}
            onChange={(event) => edit({ ...draft, to: event.target.value })}
            aria-invalid={problem !== null}
          />
        </label>
        <button
          type="button"
          onClick={() => onChange(shiftRange(range, 1))}
          aria-label="Move the range one week later"
          title="Move the range one week later"
        >
          1 week →
        </button>
      </div>

      {/* Apart from the steppers: it replaces the range with exactly the current week rather than moving it. */}
      <button type="button" className="this-week" onClick={() => onChange(wholeWeeks(today(), today()))}>
        This week
      </button>

      {problem ? (
        <p className="field-error" role="alert">
          {problem}
        </p>
      ) : (
        <p className="range">
          {weeks} {weeks === 1 ? 'week' : 'weeks'}: {formatDayWithYear(range.from)} – {formatDayWithYear(range.to)}
        </p>
      )}
    </div>
  )
}
