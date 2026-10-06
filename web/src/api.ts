// The wire types mirror api/capacity.go and api/people.go.

export type PersonCapacity = {
  id: number
  name: string
  weeklyHours: number
  /** Hours allocated per week, aligned with CapacityResponse.weeks. */
  allocated: number[]
}

export type CapacityResponse = {
  from: string
  to: string
  /** Monday of each week, ascending. */
  weeks: string[]
  people: PersonCapacity[]
}

export type Person = {
  id: number
  name: string
  weeklyHours: number
}

export class ApiError extends Error {
  readonly status: number
  /** On a 409: what the server holds now, because someone else saved first. */
  readonly current?: Person

  /** status 0 means the request never got an answer. */
  constructor(message: string, status: number, current?: Person) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.current = current
  }

  /** True when sending the same request again could work. */
  get retryable(): boolean {
    return this.status === 0 || this.status >= 500
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(url, init)
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new ApiError("Can't reach the server.", 0)
  }
  if (!response.ok) {
    throw await failure(response)
  }
  return (await response.json()) as T
}

async function failure(response: Response): Promise<ApiError> {
  if (response.status >= 500) return new ApiError('The server had a problem.', response.status)

  let body: { error?: unknown; current?: Person } = {}
  try {
    const parsed: unknown = await response.json()
    if (typeof parsed === 'object' && parsed !== null) body = parsed
  } catch {
    // Not JSON; fall through to the generic message.
  }
  const message = typeof body.error === 'string' ? body.error : `The request was rejected (${response.status}).`
  return new ApiError(message, response.status, body.current)
}

export function fetchCapacity(from: string, to: string, signal?: AbortSignal): Promise<CapacityResponse> {
  const params = new URLSearchParams({ from, to })
  return request<CapacityResponse>(`/api/capacity?${params}`, { signal })
}

/**
 * Saves weekly hours, but only if the server still holds `expectedWeeklyHours`,
 * the value the manager was looking at. If someone else saved first this rejects
 * with a 409 whose `current` is the value that won.
 */
export function updateWeeklyHours(id: number, weeklyHours: number, expectedWeeklyHours: number): Promise<Person> {
  return request<Person>(`/api/people/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ weeklyHours, expectedWeeklyHours }),
  })
}
