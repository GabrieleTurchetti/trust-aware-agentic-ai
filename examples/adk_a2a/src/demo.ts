/**
 * The demo: Booking finds the cheapest flight among the airline agents over A2A.
 *
 * 1. The two airline agents start, each in its own process.
 * 2. Booking (Gemini, or the rule-based model with --deterministic) handles
 *    the user's request: it reads the Agent Cards, selects the agents with the
 *    flight-booking skill, asks them over A2A and picks the cheapest offer.
 *
 *   npm run demo [-- --deterministic] [-- "<request>"]
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { type BaseLlm, LogLevel, setLogLevel } from '@google/adk'
import { AIRLINES } from './airline.js'
import { BookingError, createBookingAgent, DEFAULT_REQUEST, runBooking } from './booking.js'
import { type AirlineProcess, startAirlines, stopAirlines } from './launcher.js'
import { geminiFromEnv, MissingApiKeyError, RuleBasedModel } from './models.js'

const EXAMPLE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function heading(title: string): void {
  console.log(`\n=== ${title} ===\n`)
}

const args = process.argv.slice(2)
const deterministic = args.includes('--deterministic')
const request = args.filter((a) => !a.startsWith('--')).join(' ').trim() || DEFAULT_REQUEST

// Variables already set in the environment win over those in .env.
const envFile = path.join(EXAMPLE_ROOT, '.env')
if (existsSync(envFile)) process.loadEnvFile(envFile)

let model: BaseLlm
try {
  model = deterministic ? new RuleBasedModel() : geminiFromEnv()
} catch (e) {
  if (!(e instanceof MissingApiKeyError)) throw e
  console.error(`\n${e.message}\n`)
  process.exit(1)
}

// ADK logs at INFO level by default; its warnings and errors are enough here.
setLogLevel(LogLevel.WARN)

// On Ctrl+C or kill, exit through process.exit: the launcher then stops the airlines.
process.once('SIGINT', () => process.exit(130))
process.once('SIGTERM', () => process.exit(143))

/** Returns true when Booking found an offer. */
async function run(): Promise<boolean> {
  heading('1. The airline agents start, each in its own process')
  const airlines: AirlineProcess[] = await startAirlines(
    [{ profile: AIRLINES.ita }, { profile: AIRLINES['airline-b'] }],
    (profile, line) => console.log(`    [${profile.name}] ${line}`),
  )
  try {
    // The child processes print asynchronously: wait for their "listening" lines.
    await new Promise((resolve) => setTimeout(resolve, 200))

    heading('2. Booking handles the request')
    console.log(`User: ${request}`)
    console.log(`Model: ${deterministic ? 'rule-based (deterministic, no LLM)' : `${model.model} (Gemini API)`}\n`)
    const step = (line: string) => console.log(line)
    const booking = createBookingAgent({ model, airlineUrls: airlines.map((a) => a.url), reporter: { step } })
    const answer = await runBooking(booking.agent, request, { step })
    console.log(`\nBooking: ${answer || '(no answer)'}`)
    if (booking.outcomes.length === 0) {
      console.log('\nThe model did not call find_flights, so no airline was asked. Rephrase the request or use --deterministic.')
      return false
    }
    return booking.outcomes.at(-1)!.cheapest !== undefined
  } finally {
    await stopAirlines(airlines)
  }
}

try {
  process.exitCode = (await run()) ? 0 : 1
} catch (e) {
  process.exitCode = 1
  if (e instanceof BookingError) {
    console.error(`\nThe model failed: ${e.message}`)
    console.error('Try again later, set another model in GEMINI_MODEL, or run without an LLM: npm run demo -- --deterministic')
  } else {
    console.error(e)
  }
}
