import { keepPreviousData, QueryClient, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useState } from 'react'
import { ApiError, fetchCapacity, updateWeeklyHours, type CapacityResponse, type Person } from './api'
import { applyPersonUpdate } from './capacity'

const CAPACITY = 'capacity'

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        // One automatic retry, and only when the server never judged the request.
        retry: (failures, error) => failures < 1 && error instanceof ApiError && error.retryable,
      },
    },
  })
}

/**
 * Loads one range. Each range is cached under its own key, so a response for a
 * range the manager has already left can never be painted over the current one.
 * While the next range loads, the previous one stays on screen.
 */
export function useCapacity(from: string, to: string) {
  return useQuery({
    queryKey: [CAPACITY, from, to],
    queryFn: ({ signal }) => fetchCapacity(from, to, signal),
    placeholderData: keepPreviousData,
  })
}

/** An edit the server has not confirmed: still in flight, rejected, or beaten by someone else's. */
export type PendingEdit =
  | { status: 'saving'; weeklyHours: number }
  | { status: 'failed'; weeklyHours: number; message: string; retryable: boolean }
  | { status: 'conflict'; weeklyHours: number }

/**
 * Saves weekly hours and keeps every cached range correct afterwards.
 *
 * The cache only ever holds values the server confirmed. An unconfirmed edit
 * lives here, keyed by person, and the grid lays it over the cached value while
 * it is saving. A failed save therefore has nothing to roll back.
 */
export function useWeeklyHoursEdits() {
  const queryClient = useQueryClient()
  const [edits, setEdits] = useState<Record<number, PendingEdit>>({})

  const dismiss = useCallback((id: number) => {
    setEdits((current) => {
      const { [id]: _removed, ...rest } = current
      return rest
    })
  }, [])

  // Writes a value the server has confirmed into every range we hold.
  const confirm = useCallback(
    (person: Person) => {
      // Weekly hours are the only input to capacity, so the stored person is
      // enough to correct every cached range, not just the one on screen.
      queryClient.setQueriesData<CapacityResponse>(
        { queryKey: [CAPACITY] },
        (data) => data && applyPersonUpdate(data, person),
      )
      // A range request that was already in flight may have read the old value
      // and would land on top of the line above. Restart those.
      void queryClient.invalidateQueries({
        queryKey: [CAPACITY],
        predicate: (query) => query.state.fetchStatus === 'fetching',
      })
    },
    [queryClient],
  )

  /** `expected` is the saved value the manager was looking at when they made the change. */
  const save = useCallback(
    (id: number, weeklyHours: number, expected: number) => {
      setEdits((current) => ({ ...current, [id]: { status: 'saving', weeklyHours } }))

      updateWeeklyHours(id, weeklyHours, expected).then(
        (person) => {
          confirm(person)
          dismiss(id)
        },
        (error: unknown) => {
          const failure = error instanceof ApiError ? error : new ApiError('Something went wrong.', 0)

          if (failure.status === 409 && failure.current) {
            // Someone else saved first. Their value is what the server holds, so
            // the grid shows it; whether to overwrite it is the manager's call.
            confirm(failure.current)
            if (failure.current.weeklyHours === weeklyHours) {
              // It already holds what we were saving, for example our own earlier
              // attempt whose reply never arrived. Nothing left to decide.
              dismiss(id)
              return
            }
            setEdits((current) => ({ ...current, [id]: { status: 'conflict', weeklyHours } }))
            return
          }

          setEdits((current) => ({
            ...current,
            [id]: { status: 'failed', weeklyHours, message: failure.message, retryable: failure.retryable },
          }))
        },
      )
    },
    [confirm, dismiss],
  )

  return { edits, save, dismiss }
}
