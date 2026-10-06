import { memo, useEffect, useId, useRef, useState, type FormEvent } from 'react'
import type { PersonCapacity } from './api'
import { cellStatus, formatHours, MAX_WEEKLY_HOURS, overWeeks, WEEKLY_HOURS_STEP, weeklyHoursError } from './capacity'
import { addDays, formatDay, formatDayWithYear, isoWeek, startOfWeek, today, weekCount } from './dates'
import { useCapacity, useWeeklyHoursEdits, type PendingEdit } from './useCapacity'

type Props = {
  from: string
  to: string
}

// CapacityGrid renders one row per person and one column per week, showing
// how allocated each person is and making over-allocation obvious.
//
// It reads GET /api/capacity?from=&to= through useCapacity. A person's weekly
// hours are editable from the grid; every flag in their row is derived from that
// one number, so a save corrects the whole row without a reload.
export function CapacityGrid({ from, to }: Props) {
  const { data, error, isError, isFetching, isPlaceholderData, refetch } = useCapacity(from, to)
  const { edits, save, dismiss } = useWeeklyHoursEdits()
  const [onlyOver, setOnlyOver] = useState(false)
  const slow = useSlow(isFetching)

  if (!data) {
    if (isError) {
      return (
        <div className="notice notice-error" role="alert">
          <p>
            Couldn't load capacity for {formatDayWithYear(from)} – {formatDayWithYear(to)}. {error.message}
          </p>
          <button type="button" onClick={() => refetch()}>
            Try again
          </button>
        </div>
      )
    }
    return <GridSkeleton weeks={weekCount(from, to)} slow={slow} />
  }

  // An edit that is still saving is shown as if it had landed.
  const shownHours = (person: PersonCapacity) => {
    const edit = edits[person.id]
    return edit?.status === 'saving' ? edit.weeklyHours : person.weeklyHours
  }
  const isOver = (person: PersonCapacity) => overWeeks(person.allocated, shownHours(person)) > 0
  const overCount = data.people.filter(isOver).length
  // A row with an unconfirmed edit stays put, so its status can't scroll out from under the manager.
  const visible = onlyOver ? data.people.filter((person) => isOver(person) || edits[person.id]) : data.people
  const currentWeek = startOfWeek(today())

  return (
    <section className="capacity" aria-label="Capacity by person and week">
      <div className="toolbar">
        {/* While the next range loads this still counts the previous one, so it is dimmed with the grid. */}
        <p className={isPlaceholderData ? 'summary is-stale' : 'summary'}>
          <strong>{overCount}</strong> of {data.people.length} people over-allocated in this range
        </p>
        <label className="filter">
          <input type="checkbox" checked={onlyOver} onChange={(event) => setOnlyOver(event.target.checked)} />
          Only show over-allocated
        </label>
        <p className="status" role="status">
          {isPlaceholderData && (slow ? 'Still loading, this is taking longer than usual…' : 'Loading…')}
          {!isPlaceholderData && isFetching && 'Refreshing…'}
        </p>
      </div>

      {isError && (
        <div className="notice notice-error" role="alert">
          <p>Couldn't refresh. {error.message} These numbers may be out of date.</p>
          <button type="button" onClick={() => refetch()}>
            Try again
          </button>
        </div>
      )}

      {visible.length === 0 ? (
        <p className="notice">
          {data.people.length === 0 ? 'There is nobody on this team yet.' : 'Nobody is over-allocated in this range.'}
        </p>
      ) : (
        <div className={isPlaceholderData ? 'grid-scroll is-stale' : 'grid-scroll'} aria-busy={isPlaceholderData}>
          <table className="grid">
            <thead>
              <tr>
                <th scope="col" className="person">
                  Person
                </th>
                {data.weeks.map((week) => (
                  <WeekHeader key={week} week={week} current={week === currentWeek} />
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((person) => (
                <PersonRow key={person.id} person={person} edit={edits[person.id]} onSave={save} onDismiss={dismiss} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function WeekHeader({ week, current }: { week: string; current: boolean }) {
  const { week: weekNumber, year } = isoWeek(week)
  return (
    <th scope="col" className={current ? 'week is-current' : 'week'}>
      <span className="week-dates">
        {formatDay(week)} – {formatDay(addDays(week, 6))}
      </span>
      <span className="week-number" title={`ISO week ${weekNumber} of ${year}`}>
        W{weekNumber}
        {current && ' · this week'}
      </span>
    </th>
  )
}

type RowProps = {
  person: PersonCapacity
  edit: PendingEdit | undefined
  /** `expected` is the saved value the manager is changing from. */
  onSave: (id: number, weeklyHours: number, expected: number) => void
  onDismiss: (id: number) => void
}

// Memoised: a save changes one person, and the other few hundred rows are untouched.
const PersonRow = memo(function PersonRow({ person, edit, onSave, onDismiss }: RowProps) {
  const saving = edit?.status === 'saving'
  const weeklyHours = saving ? edit.weeklyHours : person.weeklyHours
  const over = overWeeks(person.allocated, weeklyHours)

  return (
    <tr aria-busy={saving}>
      <th scope="row" className="person">
        {/* dir="auto": the roster has right-to-left names, and each should read in its own direction. */}
        <span className="person-name" dir="auto">
          {person.name}
        </span>
        <WeeklyHoursEditor
          name={person.name}
          weeklyHours={weeklyHours}
          // After a save that didn't land, reopen on what the manager typed rather than making them retype it.
          initialDraft={edit && !saving ? edit.weeklyHours : weeklyHours}
          saving={saving}
          onSave={(hours) => {
            if (hours === person.weeklyHours) onDismiss(person.id)
            else onSave(person.id, hours, person.weeklyHours)
          }}
        />
        {over > 0 && (
          <span className="over-badge">
            Over in {over} {over === 1 ? 'week' : 'weeks'}
          </span>
        )}
        {edit?.status === 'failed' && (
          <div className="save-error" role="alert">
            <p>
              Couldn't save {formatHours(edit.weeklyHours)} h/week. {edit.message} Still {formatHours(person.weeklyHours)}{' '}
              h/week.
            </p>
            {edit.retryable && (
              <button type="button" onClick={() => onSave(person.id, edit.weeklyHours, person.weeklyHours)}>
                Retry
              </button>
            )}
            <button type="button" onClick={() => onDismiss(person.id)}>
              Dismiss
            </button>
          </div>
        )}
        {edit?.status === 'conflict' && (
          // By now the row shows the other manager's value; overwriting it has to be a choice, not a default.
          <div className="save-error" role="alert">
            <p>
              Someone else changed this to {formatHours(person.weeklyHours)} h/week while you were editing, so your{' '}
              {formatHours(edit.weeklyHours)} was not saved.
            </p>
            <button type="button" onClick={() => onSave(person.id, edit.weeklyHours, person.weeklyHours)}>
              Save {formatHours(edit.weeklyHours)} anyway
            </button>
            <button type="button" onClick={() => onDismiss(person.id)}>
              Keep {formatHours(person.weeklyHours)}
            </button>
          </div>
        )}
      </th>
      {person.allocated.map((hours, index) => (
        <AllocationCell key={index} hours={hours} weeklyHours={weeklyHours} />
      ))}
    </tr>
  )
})

function AllocationCell({ hours, weeklyHours }: { hours: number; weeklyHours: number }) {
  const status = cellStatus(hours, weeklyHours)
  // The note carries the meaning in words, so the colour is never the only signal.
  const note = {
    over: `+${formatHours(hours - weeklyHours)}h over`,
    full: 'full',
    under: `${formatHours(weeklyHours - hours)}h free`,
    empty: weeklyHours > 0 ? `${formatHours(weeklyHours)}h free` : 'no capacity',
  }[status]

  return (
    <td className={`cell cell-${status}`}>
      <span className="cell-hours">{formatHours(hours)}h</span>
      <span className="cell-note">{note}</span>
    </td>
  )
}

type EditorProps = {
  name: string
  weeklyHours: number
  initialDraft: number
  saving: boolean
  onSave: (weeklyHours: number) => void
}

function WeeklyHoursEditor({ name, weeklyHours, initialDraft, saving, onSave }: EditorProps) {
  // null while the editor is closed.
  const [draft, setDraft] = useState<string | null>(null)
  const openButton = useRef<HTMLButtonElement>(null)
  const returnFocus = useRef(false)
  const errorId = useId()

  // Closing the editor unmounts the focused input; hand focus back to the button.
  useEffect(() => {
    if (draft === null && returnFocus.current) {
      returnFocus.current = false
      openButton.current?.focus()
    }
  }, [draft])

  if (draft === null) {
    return (
      <button
        ref={openButton}
        type="button"
        className="hours-button"
        // aria-disabled rather than disabled, so keyboard focus survives the save.
        aria-disabled={saving}
        aria-label={`Edit weekly hours for ${name}, currently ${formatHours(weeklyHours)}`}
        onClick={() => {
          if (!saving) setDraft(String(initialDraft))
        }}
      >
        {formatHours(weeklyHours)} h/week
        <span className="hours-hint">{saving ? 'Saving…' : 'Edit'}</span>
      </button>
    )
  }

  const problem = weeklyHoursError(draft)
  const close = () => {
    returnFocus.current = true
    setDraft(null)
  }
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (problem) return
    onSave(Number(draft))
    close()
  }

  return (
    <form
      className="hours-form"
      onSubmit={submit}
      onKeyDown={(event) => {
        if (event.key === 'Escape') close()
      }}
      noValidate
    >
      <input
        type="number"
        inputMode="decimal"
        min={0}
        max={MAX_WEEKLY_HOURS}
        step={WEEKLY_HOURS_STEP}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onFocus={(event) => event.target.select()}
        autoFocus
        aria-label={`Weekly hours for ${name}`}
        aria-invalid={problem !== null}
        aria-describedby={problem ? errorId : undefined}
      />
      <button type="submit" disabled={problem !== null}>
        Save
      </button>
      <button type="button" onClick={close}>
        Cancel
      </button>
      {problem ? (
        <span className="field-error" id={errorId}>
          {problem}
        </span>
      ) : (
        // There is one weekly-hours value per person, with no start date. Say so, rather
        // than let a manager discover that last quarter's numbers moved too.
        <span className="field-hint">Applies to every week, past ones included.</span>
      )}
    </form>
  )
}

function GridSkeleton({ weeks, slow }: { weeks: number; slow: boolean }) {
  return (
    <div className="grid-scroll" aria-busy="true">
      <p className="status" role="status">
        {slow ? 'Still loading, this is taking longer than usual…' : 'Loading capacity…'}
      </p>
      <table className="grid is-skeleton" aria-hidden="true">
        <tbody>
          {Array.from({ length: 8 }, (_, row) => (
            <tr key={row}>
              <th className="person">
                <span className="bone bone-wide" />
              </th>
              {Array.from({ length: weeks }, (_, cell) => (
                <td key={cell} className="cell">
                  <span className="bone" />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** True once `active` has stayed true for longer than a manager would expect. */
function useSlow(active: boolean, afterMs = 4000): boolean {
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    if (!active) {
      setSlow(false)
      return
    }
    const timer = setTimeout(() => setSlow(true), afterMs)
    return () => clearTimeout(timer)
  }, [active, afterMs])
  return slow
}
