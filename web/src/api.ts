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

  /** status 0 means the request never got an answer. */
  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
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
    throw new ApiError(await errorMessage(response), response.status)
  }
  return (await response.json()) as T
}

async function errorMessage(response: Response): Promise<string> {
  if (response.status >= 500) return 'The server had a problem.'
  try {
    const body: unknown = await response.json()
    if (typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string') {
      return body.error
    }
  } catch {
    // Not JSON; fall through to the generic message.
  }
  return `The request was rejected (${response.status}).`
}

export function fetchCapacity(from: string, to: string, signal?: AbortSignal): Promise<CapacityResponse> {
  const params = new URLSearchParams({ from, to })
  return request<CapacityResponse>(`/api/capacity?${params}`, { signal })
}

export function updateWeeklyHours(id: number, weeklyHours: number): Promise<Person> {
  return request<Person>(`/api/people/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ weeklyHours }),
  })
}
