/**
 * The two models the Booking agent can use:
 * - Gemini, configured from environment variables, for the demo;
 * - a rule-based model, deterministic and offline, for the tests and for
 *   `npm run demo -- --deterministic`. It is an ADK `BaseLlm`, so the agent,
 *   its tool and the A2A traffic are exactly those of the Gemini run.
 */
import { BaseLlm, type BaseLlmConnection, Gemini, type LlmRequest, type LlmResponse } from '@google/adk'
import { REQUEST_DATE } from './booking.js'
import { type FlightOffer, type FlightSearch, SERVED_CITIES } from './flights.js'

/**
 * Not ADK's own default (gemini-2.5-flash), which the Gemini API refuses to
 * new users as of November 2026 and replaces with this model in its error.
 */
export const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash'

/** The value of GOOGLE_API_KEY in .env.example. */
const PLACEHOLDER_KEY = 'your-api-key-here'

export class MissingApiKeyError extends Error {
  constructor() {
    super(
      'GOOGLE_API_KEY is not set. Copy .env.example to .env and put your Gemini API key in it, ' +
        'or run the demo without an LLM: npm run demo -- --deterministic',
    )
    this.name = 'MissingApiKeyError'
  }
}

/** Gemini with the key in GOOGLE_API_KEY and the model in GEMINI_MODEL (default {@link DEFAULT_GEMINI_MODEL}). */
export function geminiFromEnv(env: Record<string, string | undefined> = process.env): Gemini {
  const apiKey = env.GOOGLE_API_KEY?.trim()
  if (!apiKey || apiKey === PLACEHOLDER_KEY) throw new MissingApiKeyError()
  return new Gemini({ model: env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL, apiKey })
}

// ---------------------------------------------------------------------------
// Rule-based model
// ---------------------------------------------------------------------------

const MONTH = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)'
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

const CITY_NAMES: Record<string, string> = {
  ...Object.fromEntries(SERVED_CITIES.map((city) => [city.toLowerCase(), city])),
  roma: 'Rome',
  milano: 'Milan',
  napoli: 'Naples',
  torino: 'Turin',
  venezia: 'Venice',
}

/** The next date with this day and month on or after `today` (YYYY-MM-DD). */
function nextOccurrence(day: number, monthName: string, today: string): string {
  const month = MONTHS.indexOf(monthName.slice(0, 3).toLowerCase()) + 1
  const pad = (n: number) => String(n).padStart(2, '0')
  let year = Number(today.slice(0, 4))
  if (`${year}-${pad(month)}-${pad(day)}` < today) year += 1
  return `${year}-${pad(month)}-${pad(day)}`
}

/** The dates in the text, in order: ISO dates, "12–13 November", "12 November", "November 12". */
function findDates(text: string, today: string): string[] {
  const iso = [...text.matchAll(/\b(\d{4}-\d{2}-\d{2})\b/g)].map((m) => m[1]!)
  if (iso.length > 0) return iso
  const range = text.match(new RegExp(`\\b(\\d{1,2})\\s*(?:–|—|-|to|and)\\s*(\\d{1,2})\\s+${MONTH}\\b`, 'i'))
  if (range) return [nextOccurrence(Number(range[1]), range[3]!, today), nextOccurrence(Number(range[2]), range[3]!, today)]
  const dayFirst = [...text.matchAll(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH}\\b`, 'gi'))]
  if (dayFirst.length > 0) return dayFirst.map((m) => nextOccurrence(Number(m[1]), m[2]!, today))
  const monthFirst = [...text.matchAll(new RegExp(`\\b${MONTH}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`, 'gi'))]
  return monthFirst.map((m) => nextOccurrence(Number(m[2]), m[1]!, today))
}

/**
 * Reads a flight search from a request in English, e.g. "a return flight
 * Rome–Milan, 12–13 November": the first two served cities are origin and
 * destination, the first two dates are departure and return. Returns
 * `undefined` when cities or dates are missing.
 */
export function parseTripRequest(text: string, today: string = REQUEST_DATE): FlightSearch | undefined {
  const names = Object.keys(CITY_NAMES).join('|')
  const cities: string[] = []
  for (const match of text.matchAll(new RegExp(`\\b(${names})\\b`, 'gi'))) {
    const city = CITY_NAMES[match[1]!.toLowerCase()]!
    if (!cities.includes(city)) cities.push(city)
  }
  const dates = findDates(text, today)
  if (cities.length < 2 || dates.length === 0) return undefined
  const oneWay = /\bone[\s-]way\b/i.test(text)
  const passengers = text.match(/\b(\d)\s*(?:passengers?|people|persons|adults|travell?ers)\b/i)
  return {
    origin: cities[0]!,
    destination: cities[1]!,
    departureDate: dates[0]!,
    ...(dates.length > 1 && !oneWay ? { returnDate: dates[1]! } : {}),
    ...(passengers ? { passengers: Number(passengers[1]) } : {}),
  }
}

/** The answer after `find_flights`, built from what the tool returned. */
function answerFrom(summary: Record<string, unknown>): string {
  const asked = (summary.airlinesAsked ?? []) as { airline: string }[]
  const cheapest = (summary.cheapest ?? null) as FlightOffer | null
  const names = asked.map((a) => a.airline).join(' and ')
  if (asked.length === 0) return 'No airline agent advertises the flight-booking skill, so I could not search for flights.'
  if (!cheapest) return `I asked ${names}, but none of them has offers for this trip.`
  const flights = cheapest.flights.map((f) => `${f.number} ${f.from}→${f.to} on ${f.departure.replace('T', ' at ')}`).join(' and ')
  const travellers = cheapest.passengers === 1 ? '1 passenger' : `${cheapest.passengers} passengers`
  return `I asked ${names}. The cheapest offer is from ${cheapest.airline}: ${flights}, €${cheapest.price} in total for ${travellers}.`
}

const text = (llmText: string): LlmResponse => ({ content: { role: 'model', parts: [{ text: llmText }] } })

/**
 * A deterministic stand-in for the LLM: it parses the request with regular
 * expressions, calls `find_flights` once, then words the answer from the
 * tool's result. No network, no API key.
 */
export class RuleBasedModel extends BaseLlm {
  constructor(private readonly today: string = REQUEST_DATE) {
    super({ model: 'rule-based' })
  }

  async *generateContentAsync(llmRequest: LlmRequest): AsyncGenerator<LlmResponse, void> {
    const lastParts = llmRequest.contents.at(-1)?.parts ?? []
    const toolResponse = lastParts.find((p) => p.functionResponse?.name === 'find_flights')?.functionResponse
    if (toolResponse) {
      const response = (toolResponse.response ?? {}) as Record<string, unknown>
      yield text(answerFrom((response.result ?? response) as Record<string, unknown>))
      return
    }
    const request = [...llmRequest.contents]
      .reverse()
      .find((c) => c.role === 'user' && c.parts?.some((p) => p.text))
      ?.parts?.map((p) => p.text ?? '')
      .join(' ')
    const search = request ? parseTripRequest(request, this.today) : undefined
    if (!search) {
      yield text(`Please tell me the cities (${SERVED_CITIES.join(', ')}) and the dates of your trip.`)
      return
    }
    yield { content: { role: 'model', parts: [{ functionCall: { name: 'find_flights', args: { ...search } } }] } }
  }

  async connect(): Promise<BaseLlmConnection> {
    throw new Error('the rule-based model has no live mode')
  }
}
