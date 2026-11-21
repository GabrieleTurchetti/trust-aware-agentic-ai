/**
 * Delegation: Booking sends a flight search to an airline over A2A, with ADK's
 * `RemoteA2AAgent`, and reads its reply.
 */
import type { AgentCard } from '@a2a-js/sdk'
import { InMemoryRunner, RemoteA2AAgent } from '@google/adk'
import type { DiscoveredAgent } from './discovery.js'
import type { FlightOffer, FlightSearch, SearchResult } from './flights.js'

export interface AirlineReply {
  airline: string
  url: string
  offers: FlightOffer[]
  /** Why there are no offers, when the airline says so. */
  note?: string
  /** Error reported by `RemoteA2AAgent`, e.g. a failed task. */
  error?: string
  /** Round trip of the A2A request. */
  durationMs: number
}

/** ADK agent names must be JavaScript identifiers. */
function agentName(card: AgentCard): string {
  const name = card.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  return /^[a-z_]/.test(name) ? name : `agent_${name}`
}

/** Sends the search to the airline over A2A and returns its offers, or why there are none. */
export async function askAirline(airline: Pick<DiscoveredAgent, 'url' | 'card'>, search: FlightSearch): Promise<AirlineReply> {
  const remote = new RemoteA2AAgent({
    name: agentName(airline.card),
    description: airline.card.description,
    // The card read during discovery: no second fetch.
    agentCard: airline.card,
  })

  // The remote agent runs inside Booking's ADK runtime, in a session of its
  // own: the search is the only message it forwards.
  const runner = new InMemoryRunner({ agent: remote, appName: 'booking' })
  const start = performance.now()
  let result: SearchResult | undefined
  let error: string | undefined
  for await (const event of runner.runEphemeral({
    userId: 'booking',
    newMessage: { role: 'user', parts: [{ text: JSON.stringify(search) }] },
  })) {
    if (event.errorMessage) error = event.errorMessage
    for (const part of event.content?.parts ?? []) {
      if (part.text) result = parseSearchResult(part.text) ?? result
    }
  }
  return {
    airline: airline.card.name,
    url: airline.url,
    offers: result?.offers ?? [],
    ...(result?.note ? { note: result.note } : {}),
    ...(error !== undefined ? { error } : {}),
    durationMs: performance.now() - start,
  }
}

function parseSearchResult(text: string): SearchResult | undefined {
  try {
    const value = JSON.parse(text) as SearchResult
    return Array.isArray(value.offers) ? value : undefined
  } catch {
    return undefined
  }
}

/** The cheapest offer among all replies; on a tie, the first airline asked wins. */
export function pickCheapest(replies: readonly AirlineReply[]): FlightOffer | undefined {
  let cheapest: FlightOffer | undefined
  for (const reply of replies) {
    for (const offer of reply.offers) {
      if (!cheapest || offer.price < cheapest.price) cheapest = offer
    }
  }
  return cheapest
}
