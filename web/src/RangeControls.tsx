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
      <div className="range-nav">
        <button type="button" onClick={() => onChange(shiftRange(range, -1))}>
          ← Previous week
        </button>
        {/* Exactly the current week, not the current span moved to today: the label has to be literal. */}
        <button type="button" onClick={() => onChange(wholeWeeks(today(), today()))}>
          This week
        </button>
        <button type="button" onClick={() => onChange(shiftRange(range, 1))}>
          Next week →
        </button>
      </div>

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
