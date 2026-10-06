import { keepPreviousData, QueryClient, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useState } from 'react'
import { ApiError, fetchCapacity, updateWeeklyHours, type CapacityResponse } from './api'
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

/** An edit the server has not confirmed: still in flight, or rejected. */
export type PendingEdit =
  | { status: 'saving'; weeklyHours: number }
  | { status: 'failed'; weeklyHours: number; message: string; retryable: boolean }

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

  const save = useCallback(
    (id: number, weeklyHours: number) => {
      setEdits((current) => ({ ...current, [id]: { status: 'saving', weeklyHours } }))

      updateWeeklyHours(id, weeklyHours).then(
        (person) => {
          // Weekly hours are the only input to capacity, so the saved person is
          // enough to correct every range we hold, not just the one on screen.
          queryClient.setQueriesData<CapacityResponse>(
            { queryKey: [CAPACITY] },
            (data) => data && applyPersonUpdate(data, person),
          )
          // A range request that was already in flight may have read the old
          // value and would land on top of the line above. Restart those.
          void queryClient.invalidateQueries({
            queryKey: [CAPACITY],
            predicate: (query) => query.state.fetchStatus === 'fetching',
          })
          dismiss(id)
        },
        (error: unknown) => {
          const failure = error instanceof ApiError ? error : new ApiError('Something went wrong.', 0)
          setEdits((current) => ({
            ...current,
            [id]: { status: 'failed', weeklyHours, message: failure.message, retryable: failure.retryable },
          }))
        },
      )
    },
    [queryClient, dismiss],
  )

  return { edits, save, dismiss }
}
