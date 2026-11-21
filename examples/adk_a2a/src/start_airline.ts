/**
 * Runs one airline agent as its own process, until it receives SIGTERM or SIGINT:
 *
 *   npx tsx src/start_airline.ts ita [--port 9001]
 *   npx tsx src/start_airline.ts airline-b [--port 9002]
 *
 * The demo and the tests start the airlines this way, through src/launcher.ts.
 */
import { AGENT_CARD_PATH } from '@a2a-js/sdk'
import { LogLevel, setLogLevel } from '@google/adk'
import { type AirlineId, AIRLINES, startAirlineServer } from './airline.js'

const [id, flag, value] = process.argv.slice(2)
const profile = AIRLINES[id as AirlineId]
const port = flag === '--port' ? Number(value) : undefined
if (!profile || (flag !== undefined && !(Number.isInteger(port) && port! > 0))) {
  console.error(`usage: tsx src/start_airline.ts <${Object.keys(AIRLINES).join('|')}> [--port <port>]`)
  process.exit(2)
}

// ADK logs at INFO level by default; its warnings and errors are enough here.
setLogLevel(LogLevel.WARN)

try {
  const server = await startAirlineServer(profile, { port, log: (line) => console.log(line) })
  console.log(`listening on ${server.url}, Agent Card at ${server.url}/${AGENT_CARD_PATH}`)
  const stop = () => {
    void server.close().then(() => process.exit(0))
  }
  process.once('SIGTERM', stop)
  process.once('SIGINT', stop)
} catch (e) {
  const error = e as NodeJS.ErrnoException
  console.error(error.code === 'EADDRINUSE' ? `port ${port ?? profile.port} is already in use` : error.message)
  process.exit(1)
}
