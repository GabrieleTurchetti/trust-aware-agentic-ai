/**
 * The airline agents: ADK agents without an LLM, served over A2A.
 *
 * Each airline is a `BaseAgent` subclass that parses the flight search sent by
 * Booking and calls a deterministic ADK `FunctionTool`. ADK's `toA2a()` turns
 * it into an Express application that serves its Agent Card and its JSON-RPC
 * endpoint.
 */
import type { Server } from 'node:http'
import type { AgentCard, AgentSkill } from '@a2a-js/sdk'
import {
  BaseAgent,
  type BaseAgentConfig,
  Context,
  createEvent,
  type Event,
  FunctionTool,
  getA2AAgentCard,
  type InvocationContext,
  toA2a,
} from '@google/adk'
import { FLIGHT_BOOKING_SKILL, flightSearchSchema, searchFlights, type SearchResult, type Timetable } from './flights.js'

export type AirlineId = 'ita' | 'airline-b'

export interface AirlineProfile {
  id: AirlineId
  /** Display name, also the name in the Agent Card. */
  name: string
  /** ADK agent name: a JavaScript identifier. */
  agentName: string
  /** Port of the demo; the tests use others. */
  port: number
  timetable: Timetable
}

export const AIRLINES: Record<AirlineId, AirlineProfile> = {
  ita: {
    id: 'ita',
    name: 'ITA Airways',
    agentName: 'ita_airways',
    port: 9001,
    timetable: {
      airline: 'ITA Airways',
      baseFare: 50,
      perKm: 0.15,
      rotations: [
        { outbound: { number: 'AZ2010', time: '07:00' }, inbound: { number: 'AZ2035', time: '19:00' }, premium: 0 },
        { outbound: { number: 'AZ2022', time: '13:00' }, inbound: { number: 'AZ2061', time: '21:00' }, premium: 25 },
      ],
    },
  },
  'airline-b': {
    id: 'airline-b',
    name: 'Airline B',
    agentName: 'airline_b',
    port: 9002,
    timetable: {
      airline: 'Airline B',
      baseFare: 35,
      perKm: 0.15,
      rotations: [
        { outbound: { number: 'XB301', time: '06:30' }, inbound: { number: 'XB318', time: '20:30' }, premium: 0 },
        { outbound: { number: 'XB305', time: '10:15' }, inbound: { number: 'XB322', time: '22:45' }, premium: 45 },
      ],
    },
  },
}

/** The deterministic tool. It is a regular ADK tool: an `LlmAgent` could use it as well. */
export function searchFlightsTool(timetable: Timetable): FunctionTool<typeof flightSearchSchema> {
  return new FunctionTool({
    name: 'search_flights',
    description: `Returns the ${timetable.airline} flight offers for a search, cheapest first (mock data).`,
    parameters: flightSearchSchema,
    execute: (search) => searchFlights(timetable, search),
  })
}

export interface AirlineAgentConfig extends BaseAgentConfig {
  timetable: Timetable
  /** Receives one readable line per handled search. */
  log?: (line: string) => void
}

/**
 * An ADK agent without an LLM. It reads the flight search (JSON in the text
 * of the request), calls its tool directly and replies with the result as JSON
 * text: ADK turns the reply into an A2A artifact with one text part.
 */
export class AirlineAgent extends BaseAgent<AirlineAgentConfig> {
  private readonly tool: FunctionTool<typeof flightSearchSchema>

  constructor(config: AirlineAgentConfig) {
    super(config)
    this.tool = searchFlightsTool(config.timetable)
  }

  protected async *runAsyncImpl(ctx: InvocationContext): AsyncGenerator<Event, void, void> {
    const text = (ctx.userContent?.parts ?? []).map((part) => part.text ?? '').join('')
    let args: Record<string, unknown>
    try {
      args = JSON.parse(text) as Record<string, unknown>
    } catch {
      throw new Error('expected a flight search as JSON, e.g. {"origin":"Rome","destination":"Milan","departureDate":"2026-11-12"}')
    }
    // Throws `Error in tool 'search_flights': …` when the search does not match the schema.
    const result = (await this.tool.runAsync({ args, toolContext: new Context({ invocationContext: ctx }) })) as SearchResult
    this.config.log?.(
      `search ${args.origin}→${args.destination} ${args.departureDate}${args.returnDate ? `/${args.returnDate}` : ''}: ` +
        (result.offers.length > 0 ? `${result.offers.length} offers from €${result.offers[0]!.price}` : result.note),
    )
    yield createEvent({
      invocationId: ctx.invocationId,
      author: this.name,
      branch: ctx.branch,
      content: { role: 'model', parts: [{ text: JSON.stringify(result) }] },
    })
  }

  protected async *runLiveImpl(): AsyncGenerator<Event, void, void> {
    throw new Error('live mode is not supported by the airline agents')
  }
}

export const flightBookingSkill = (profile: AirlineProfile): AgentSkill => ({
  id: FLIGHT_BOOKING_SKILL,
  name: 'Flight booking',
  description: `Finds ${profile.name} return or one-way flights between Italian cities`,
  tags: ['flight', 'travel', 'italy'],
  examples: ['{"origin":"Rome","destination":"Milan","departureDate":"2026-11-12","returnDate":"2026-11-13"}'],
})

/**
 * The airline's Agent Card. ADK can generate one from the agent
 * (`getA2AAgentCard`), but its only skill is named after the agent: the
 * airline replaces it with the `flight-booking` skill that Booking looks for.
 */
export async function airlineAgentCard(profile: AirlineProfile, agent: BaseAgent, baseUrl: string): Promise<AgentCard> {
  const generated = await getA2AAgentCard(agent, [{ url: `${baseUrl}/jsonrpc`, transport: 'JSONRPC' }])
  return {
    ...generated,
    name: profile.name,
    description: `Flight offers of ${profile.name} between Italian cities (mock data)`,
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['text/plain'],
    skills: [flightBookingSkill(profile)],
  }
}

export interface AirlineServerOptions {
  /** Defaults to the profile's port. */
  port?: number
  /** Receives one readable line per search; silent by default. */
  log?: (line: string) => void
}

export interface AirlineServer {
  /** Base URL: the Agent Card is at `${url}/.well-known/agent-card.json`. */
  url: string
  card: AgentCard
  close(): Promise<void>
}

/** Starts the airline's A2A server on localhost. */
export async function startAirlineServer(profile: AirlineProfile, options: AirlineServerOptions = {}): Promise<AirlineServer> {
  const port = options.port ?? profile.port
  const url = `http://localhost:${port}`
  const agent = new AirlineAgent({
    name: profile.agentName,
    description: `Flight offers of ${profile.name}`,
    timetable: profile.timetable,
    ...(options.log ? { log: options.log } : {}),
  })
  const card = await airlineAgentCard(profile, agent, url)
  // toA2a() serves the card at /.well-known/agent-card.json and A2A at /jsonrpc
  // (and /rest). It refuses to run without authentication unless told so: the
  // servers listen on localhost only.
  const app = await toA2a(agent, { host: 'localhost', port, agentCard: card, allowUnauthenticated: true })
  const server = await new Promise<Server>((resolve, reject) => {
    const server = app.listen(port, 'localhost')
    server.once('listening', () => resolve(server))
    server.once('error', reject)
  })
  return {
    url,
    card,
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve())
        server.closeAllConnections()
      }),
  }
}
