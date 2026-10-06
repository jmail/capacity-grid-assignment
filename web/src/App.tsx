import { useEffect, useState } from 'react'
import { CapacityGrid } from './CapacityGrid'
import { rangeError, wholeWeeks, type Range } from './dates'
import { RangeControls } from './RangeControls'

// The range the grid opens on when the URL doesn't name one.
const FROM = '2025-12-29'
const TO = '2026-01-16'

function initialRange(): Range {
  const params = new URLSearchParams(window.location.search)
  const from = params.get('from') ?? ''
  const to = params.get('to') ?? ''
  return rangeError(from, to) === null ? wholeWeeks(from, to) : wholeWeeks(FROM, TO)
}

// The range lives here, above the grid, because the team overview page will
// share it with the logged-time timeline.
export function App() {
  const [range, setRange] = useState(initialRange)

  // Keep the range in the URL so a manager can share or reload what they see.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    params.set('from', range.from)
    params.set('to', range.to)
    window.history.replaceState(null, '', `?${params}`)
  }, [range])

  return (
    <main>
      <h1>Team capacity</h1>
      <RangeControls range={range} onChange={setRange} />
      <CapacityGrid from={range.from} to={range.to} />
    </main>
  )
}
