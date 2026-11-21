/**
 * The Booking agent with the rule-based model: no LLM, no API key, no network
 * outside localhost.
 */
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { after, before, describe, it } from 'node:test'
import { promisify } from 'node:util'
import { AIRLINES } from '../src/airline.js'
import { createBookingAgent, DEFAULT_REQUEST, runBooking } from '../src/booking.js'
import { type AirlineProcess, startAirlines, stopAirlines } from '../src/launcher.js'
import { DEFAULT_GEMINI_MODEL, geminiFromEnv, MissingApiKeyError, parseTripRequest, RuleBasedModel } from '../src/models.js'
import { EXAMPLE_ROOT, SCENARIO_SEARCH } from './helpers.js'

/** Ports different from the demo's (9001, 9002) and from airlines.test.ts. */
const PORTS = { ita: 9111, airlineB: 9112 }

describe('Booking agent', { timeout: 60_000 }, () => {
  let airlines: AirlineProcess[] = []

  before(async () => {
    airlines = await startAirlines([
      { profile: AIRLINES.ita, port: PORTS.ita },
      { profile: AIRLINES['airline-b'], port: PORTS.airlineB },
    ])
  })

  after(async () => {
    await stopAirlines(airlines)
  })

  it('selects the airline with the cheapest offer', async () => {
    const booking = createBookingAgent({ model: new RuleBasedModel(), airlineUrls: airlines.map((a) => a.url) })
    const answer = await runBooking(booking.agent, DEFAULT_REQUEST)

    assert.equal(booking.outcomes.length, 1, 'find_flights is called once')
    const outcome = booking.outcomes[0]!
    assert.deepEqual(outcome.search, SCENARIO_SEARCH)
    assert.deepEqual(
      outcome.selected.map((a) => a.card.name),
      ['ITA Airways', 'Airline B'],
    )
    const offers = outcome.replies.flatMap((r) => r.offers)
    assert.deepEqual(
      offers.map((o) => `${o.airline} €${o.price}`),
      ['ITA Airways €240', 'ITA Airways €265', 'Airline B €210', 'Airline B €255'],
    )
    assert.equal(outcome.cheapest?.price, Math.min(...offers.map((o) => o.price)))
    assert.equal(outcome.cheapest?.airline, 'Airline B')
    assert.deepEqual(
      outcome.cheapest?.flights.map((f) => f.number),
      ['XB301', 'XB318'],
    )
    assert.match(answer, /cheapest offer is from Airline B: XB301 .* and XB318 .*, €210 in total/)
  })

  it('the rule-based model reads the route and the dates of the request', () => {
    assert.deepEqual(parseTripRequest(DEFAULT_REQUEST), SCENARIO_SEARCH)
    assert.deepEqual(parseTripRequest('a return flight Rome–Milan, 12–13 November'), SCENARIO_SEARCH)
    assert.deepEqual(parseTripRequest('One-way flight from Napoli to Torino on 20 November for 2 passengers'), {
      origin: 'Naples',
      destination: 'Turin',
      departureDate: '2026-11-20',
      passengers: 2,
    })
    // Dates without a year are the next ones after the request date (2 November 2026).
    assert.equal(parseTripRequest('Venice to Bari on 15 October')?.departureDate, '2027-10-15')
    assert.equal(parseTripRequest('Book me a hotel in Milan'), undefined)
  })

  it('without an API key, the demo stops with a clear message', async () => {
    assert.throws(() => geminiFromEnv({}), MissingApiKeyError)
    assert.throws(() => geminiFromEnv({ GOOGLE_API_KEY: 'your-api-key-here' }), MissingApiKeyError)
    // A key is enough to build the model: nothing is sent until it is used.
    assert.equal(geminiFromEnv({ GOOGLE_API_KEY: 'test' }).model, DEFAULT_GEMINI_MODEL)
    assert.equal(geminiFromEnv({ GOOGLE_API_KEY: 'test', GEMINI_MODEL: 'gemini-test' }).model, 'gemini-test')

    // The demo itself: an empty variable wins over the key in .env, if any.
    const run = promisify(execFile)(process.execPath, ['--import', 'tsx', 'src/demo.ts'], {
      cwd: EXAMPLE_ROOT,
      env: { ...process.env, GOOGLE_API_KEY: '' },
    })
    await assert.rejects(run, (e: { code: number; stdout: string; stderr: string }) => {
      assert.equal(e.code, 1)
      assert.match(e.stderr, /GOOGLE_API_KEY is not set\. Copy \.env\.example to \.env/)
      assert.equal(e.stdout, '', 'nothing starts')
      return true
    })
  })
})
