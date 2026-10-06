import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CapacityResponse } from './api'
import { CapacityGrid } from './CapacityGrid'

// The first rows of the seed, as the API reports them for the starter range.
function capacity(overrides?: Partial<CapacityResponse>): CapacityResponse {
  return {
    from: '2025-12-29',
    to: '2026-01-18',
    weeks: ['2025-12-29', '2026-01-05', '2026-01-12'],
    people: [
      { id: 1, name: 'Ana Ferreira', weeklyHours: 40, allocated: [40, 0, 30] },
      { id: 4, name: 'Dee Okafor', weeklyHours: 40, allocated: [0, 45, 40] },
      { id: 5, name: 'Eli Nakamura', weeklyHours: 0, allocated: [0, 20, 0] },
    ],
    ...overrides,
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

// Each test decides what the server says.
let respond: (url: URL, init?: RequestInit) => Response | Promise<Response>
const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
  Promise.resolve(respond(new URL(String(input), 'http://localhost'), init)),
)
const requests = (method: string) => fetchMock.mock.calls.filter(([, init]) => (init?.method ?? 'GET') === method)

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  fetchMock.mockClear()
})

function renderGrid(from = '2025-12-29', to = '2026-01-18') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const ui = (rangeFrom: string, rangeTo: string) => (
    <QueryClientProvider client={client}>
      <CapacityGrid from={rangeFrom} to={rangeTo} />
    </QueryClientProvider>
  )
  const view = render(ui(from, to))
  return { showRange: (rangeFrom: string, rangeTo: string) => view.rerender(ui(rangeFrom, rangeTo)) }
}

async function rowOf(name: string) {
  return within((await screen.findByText(name)).closest('tr')!)
}

async function changeWeeklyHours(user: ReturnType<typeof userEvent.setup>, name: string, hours: string) {
  await user.click(await screen.findByRole('button', { name: new RegExp(`Edit weekly hours for ${name}`) }))
  const input = screen.getByRole('spinbutton', { name: `Weekly hours for ${name}` })
  await user.clear(input)
  await user.type(input, hours)
  await user.click(screen.getByRole('button', { name: 'Save' }))
}

describe('CapacityGrid', () => {
  it('flags over-allocation in words, and only where allocation exceeds capacity', async () => {
    respond = () => json(capacity())
    renderGrid()

    const dee = await rowOf('Dee Okafor')
    expect(dee.getByText('+5h over')).toBeInTheDocument()
    expect(dee.getByText('Over in 1 week')).toBeInTheDocument()
    expect(dee.getByText('full')).toBeInTheDocument() // 40 of 40 is not over

    const ana = await rowOf('Ana Ferreira')
    expect(ana.queryByText(/over/i)).not.toBeInTheDocument()

    // Nothing to divide by, but the allocation is still a problem.
    const eli = await rowOf('Eli Nakamura')
    expect(eli.getByText('+20h over')).toBeInTheDocument()

    expect(screen.getByText(/of 3 people over-allocated/)).toHaveTextContent('2 of 3')
  })

  it('says it is loading before the first response', () => {
    respond = () => new Promise<Response>(() => {})
    renderGrid()

    expect(screen.getByRole('status')).toHaveTextContent('Loading capacity…')
  })

  it('explains a failed load and recovers on Try again', async () => {
    let attempts = 0
    respond = () => (++attempts === 1 ? json({ error: 'internal error' }, 500) : json(capacity()))
    const user = userEvent.setup()
    renderGrid()

    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load capacity")
    await user.click(screen.getByRole('button', { name: 'Try again' }))

    expect(await screen.findByText('Dee Okafor')).toBeInTheDocument()
  })

  it('ignores a slow response for a range the manager has already left', async () => {
    const slow = deferred<Response>()
    const nextRange = capacity({
      from: '2026-01-05',
      to: '2026-01-25',
      weeks: ['2026-01-05', '2026-01-12', '2026-01-19'],
      people: [{ id: 1, name: 'Ana Ferreira', weeklyHours: 40, allocated: [0, 30, 16] }],
    })
    respond = (url) => (url.searchParams.get('from') === '2025-12-29' ? slow.promise : json(nextRange))

    const { showRange } = renderGrid('2025-12-29', '2026-01-18')
    showRange('2026-01-05', '2026-01-25')
    expect(await screen.findByText('16h')).toBeInTheDocument()

    slow.resolve(json(capacity()))
    await new Promise((settle) => setTimeout(settle, 0))

    expect(screen.getByText('16h')).toBeInTheDocument()
    expect(screen.queryByText('Dee Okafor')).not.toBeInTheDocument()
  })

  it('applies a save to every week in the row without loading the range again', async () => {
    const save = deferred<Response>()
    respond = (_url, init) => (init?.method === 'PATCH' ? save.promise : json(capacity()))
    const user = userEvent.setup()
    renderGrid()

    await changeWeeklyHours(user, 'Dee Okafor', '48')

    // Shown at once, and marked as not yet confirmed.
    const dee = await rowOf('Dee Okafor')
    expect(dee.getByText('Saving…')).toBeInTheDocument()
    expect(dee.getByText('3h free')).toBeInTheDocument()
    expect(dee.queryByText(/over/i)).not.toBeInTheDocument()

    save.resolve(json({ id: 4, name: 'Dee Okafor', weeklyHours: 48 }))
    await waitFor(() => expect(dee.queryByText('Saving…')).not.toBeInTheDocument())

    expect(dee.getByText('48h free')).toBeInTheDocument() // nothing allocated
    expect(dee.getByText('3h free')).toBeInTheDocument() // 45 of 48
    expect(dee.getByText('8h free')).toBeInTheDocument() // 40 of 48
    expect(screen.getByText(/of 3 people over-allocated/)).toHaveTextContent('1 of 3')

    expect(requests('PATCH')).toHaveLength(1)
    expect(JSON.parse(String(requests('PATCH')[0][1]?.body))).toEqual({ weeklyHours: 48 })
    expect(requests('GET')).toHaveLength(1)
  })

  it('puts the saved value back when a save fails, says so, and lets the manager retry', async () => {
    let failing = true
    respond = (_url, init) => {
      if (init?.method !== 'PATCH') return json(capacity())
      if (failing) return json({ error: 'internal error' }, 500)
      return json({ id: 4, name: 'Dee Okafor', weeklyHours: 48 })
    }
    const user = userEvent.setup()
    renderGrid()

    await changeWeeklyHours(user, 'Dee Okafor', '48')

    const dee = await rowOf('Dee Okafor')
    expect(await dee.findByRole('alert')).toHaveTextContent(
      "Couldn't save 48 h/week. The server had a problem. Still 40 h/week.",
    )
    // The grid shows what the server has, not what was typed.
    expect(dee.getByText('+5h over')).toBeInTheDocument()
    expect(dee.getByRole('button', { name: /currently 40/ })).toBeInTheDocument()

    failing = false
    await user.click(dee.getByRole('button', { name: 'Retry' }))

    await waitFor(() => expect(dee.queryByRole('alert')).not.toBeInTheDocument())
    expect(dee.getByText('3h free')).toBeInTheDocument()
    expect(dee.getByRole('button', { name: /currently 48/ })).toBeInTheDocument()
  })

  it('does not offer a retry when the server rejected the value itself', async () => {
    respond = (_url, init) =>
      init?.method === 'PATCH' ? json({ error: 'weeklyHours must be between 0 and 168' }, 400) : json(capacity())
    const user = userEvent.setup()
    renderGrid()

    await changeWeeklyHours(user, 'Dee Okafor', '48')

    const dee = await rowOf('Dee Okafor')
    expect(await dee.findByRole('alert')).toHaveTextContent('weeklyHours must be between 0 and 168')
    expect(dee.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument()
    expect(dee.getByRole('button', { name: 'Dismiss' })).toBeInTheDocument()
  })

  it('does not send a value that cannot be weekly hours', async () => {
    respond = () => json(capacity())
    const user = userEvent.setup()
    renderGrid()

    await user.click(await screen.findByRole('button', { name: /Edit weekly hours for Dee Okafor/ }))
    const input = screen.getByRole('spinbutton', { name: 'Weekly hours for Dee Okafor' })
    await user.clear(input)
    await user.type(input, '200')

    expect(screen.getByText('Enter between 0 and 168 hours.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    expect(requests('PATCH')).toHaveLength(0)
  })
})
