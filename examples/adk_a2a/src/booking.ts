/**
 * The Booking agent: an ADK `LlmAgent` that interprets the user's request and
 * calls one tool, `find_flights`. The tool does the rest deterministically:
 * discovery of the airline agents (Agent Cards), selection by skill,
 * delegation over A2A and choice of the cheapest offer.
 *
 * The model is Gemini in the demo, or the rule-based model of models.ts in
 * the tests: the agent, its tool and the A2A traffic are the same.
 */
import { type BaseLlm, FunctionTool, getFunctionCalls, InMemoryRunner, isFinalResponse, LlmAgent } from '@google/adk'
import { type AirlineReply, askAirline, pickCheapest } from './delegation.js'
import { type DiscoveredAgent, type Discovery, discoverAgents, selectBySkill } from './discovery.js'
import { FLIGHT_BOOKING_SKILL, type FlightOffer, type FlightSearch, flightSearchSchema, formatOffer } from './flights.js'

/** The day of the request in the scenario, Monday 2 November 2026: dates without a year come after it. */
export const REQUEST_DATE = '2026-11-02'

export const DEFAULT_REQUEST = 'Book me a return flight Rome–Milan for 12–13 November.'

export interface Reporter {
  /** Prints one readable step. */
  step(line: string): void
}

export const silentReporter: Reporter = { step: () => {} }

/** What happened during one call of `find_flights`. */
export interface BookingOutcome {
  search: FlightSearch
  discovery: Discovery
  selected: DiscoveredAgent[]
  replies: AirlineReply[]
  cheapest?: FlightOffer
}

export interface FindFlightsOptions {
  /** Base URLs of the agents Booking knows: it reads their Agent Cards. */
  airlineUrls: readonly string[]
  reporter?: Reporter
}

/** Discovery, selection, delegation and choice of the cheapest offer. */
export async function findFlights(search: FlightSearch, options: FindFlightsOptions): Promise<BookingOutcome> {
  const { step } = options.reporter ?? silentReporter

  // 1. Discovery: the Agent Cards of the known agents.
  step(`Discovery: Booking reads the Agent Cards of ${options.airlineUrls.join(', ')}`)
  const discovery = await discoverAgents(options.airlineUrls)
  for (const { url, card } of discovery.agents) {
    step(`  ${card.name} at ${url}: skills ${card.skills.map((s) => s.id).join(', ')}; A2A endpoint ${card.url}`)
  }
  for (const { url, error } of discovery.unreachable) step(`  no Agent Card at ${url}: ${error}`)

  // 2. Selection by skill.
  const selected = selectBySkill(discovery.agents, FLIGHT_BOOKING_SKILL)
  step(
    `Selection: ${selected.length} of ${discovery.agents.length} agents advertise the ${FLIGHT_BOOKING_SKILL} skill` +
      (selected.length > 0 ? `: ${selected.map((a) => a.card.name).join(', ')}` : ''),
  )

  // 3. Delegation over A2A, to all the selected airlines in parallel.
  step(`Delegation: Booking sends ${JSON.stringify(search)} to each of them over A2A`)
  const replies = await Promise.all(selected.map((agent) => askAirline(agent, search)))
  for (const reply of replies) {
    const answer = reply.error
      ? `error: ${reply.error}`
      : `${reply.offers.length} offers${reply.note ? ` (${reply.note})` : ''}`
    step(`  ${reply.airline} answered in ${reply.durationMs.toFixed(0)} ms: ${answer}`)
    for (const offer of reply.offers) step(`    ${formatOffer(offer)}`)
  }

  // 4. The cheapest offer.
  const cheapest = pickCheapest(replies)
  step(cheapest ? `Cheapest offer: ${cheapest.airline}, ${formatOffer(cheapest)}` : 'No airline has offers for this search')
  return { search, discovery, selected, replies, ...(cheapest ? { cheapest } : {}) }
}

/** What `find_flights` returns to the model: the offers, not the protocol details. */
function summaryForModel(outcome: BookingOutcome): Record<string, unknown> {
  return {
    airlinesAsked: outcome.replies.map((r) => ({
      airline: r.airline,
      offers: r.offers.length,
      ...(r.note ? { note: r.note } : {}),
      ...(r.error ? { error: r.error } : {}),
    })),
    offers: outcome.replies.flatMap((r) => r.offers),
    cheapest: outcome.cheapest ?? null,
  }
}

const INSTRUCTION = `You are Booking, a travel booking agent. Users ask you for flights in natural language.
Today is Monday ${REQUEST_DATE}: a date without a year is its next occurrence from today.
To answer a flight request, call find_flights exactly once, with:
- origin and destination: the English names of the cities, e.g. "Rome" and "Milan";
- departureDate and, for a return trip, returnDate, as YYYY-MM-DD;
- passengers, only if the user says how many people travel.
find_flights asks the airline agents for offers and returns them with the cheapest one.
Then answer in at most three sentences: the cheapest offer (airline, flight numbers with dates and times, total price in euros) and which airlines answered. Use only the offers returned by find_flights.
If the request does not say the cities or the dates, ask for them instead of calling find_flights.`

export interface BookingAgent {
  agent: LlmAgent
  /** One entry per call of `find_flights`, for the demo and the tests. */
  outcomes: BookingOutcome[]
}

export function createBookingAgent(options: FindFlightsOptions & { model: BaseLlm }): BookingAgent {
  const outcomes: BookingOutcome[] = []
  const findFlightsTool = new FunctionTool({
    name: 'find_flights',
    description:
      'Finds flight offers for a trip: reads the Agent Cards of the known airline agents, asks those with the ' +
      'flight-booking skill over A2A, and returns all their offers and the cheapest one.',
    parameters: flightSearchSchema,
    execute: async (search) => {
      const outcome = await findFlights(search, options)
      outcomes.push(outcome)
      return summaryForModel(outcome)
    },
  })
  const agent = new LlmAgent({
    name: 'booking',
    description: 'Travel booking agent that finds the cheapest flight among the airline agents',
    model: options.model,
    instruction: INSTRUCTION,
    tools: [findFlightsTool],
    // Gemini only: at most 30 s per attempt, and up to 3 attempts on 408, 429
    // and 5xx answers ("high demand"), so an overloaded API fails within about
    // 1.5 minutes. ADK passes this config to @google/genai with every request.
    generateContentConfig: {
      httpOptions: { timeout: 30_000, retryOptions: { attempts: 3, initialDelay: 2, maxDelay: 10 } },
    },
  })
  return { agent, outcomes }
}

/** The model failed, e.g. the LLM API was unavailable. */
export class BookingError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BookingError'
  }
}

/** Runs Booking on one user request and returns its final answer. */
export async function runBooking(agent: LlmAgent, request: string, reporter: Reporter = silentReporter): Promise<string> {
  const runner = new InMemoryRunner({ agent, appName: 'booking' })
  let answer = ''
  for await (const event of runner.runEphemeral({
    userId: 'alice',
    newMessage: { role: 'user', parts: [{ text: request }] },
  })) {
    if (event.errorMessage) throw new BookingError(event.errorMessage)
    for (const call of getFunctionCalls(event)) {
      reporter.step(`Booking's model calls ${call.name}(${JSON.stringify(call.args)})`)
    }
    if (isFinalResponse(event)) {
      answer = (event.content?.parts ?? []).filter((p) => p.text && !p.thought).map((p) => p.text).join('').trim()
    }
  }
  return answer
}
