/**
 * Starts and stops the airline agents as separate processes, so that the demo
 * and the tests need a single command. The processes talk to Booking only over
 * A2A (HTTP on localhost).
 */
import { type ChildProcess, spawn } from 'node:child_process'
import path from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { AGENT_CARD_PATH } from '@a2a-js/sdk'
import type { AirlineProfile } from './airline.js'

const EXAMPLE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ENTRY = path.join(EXAMPLE_ROOT, 'src', 'start_airline.ts')
const READY_TIMEOUT_MS = 20_000

export interface AirlineProcess {
  profile: AirlineProfile
  /** Base URL of the airline agent. */
  url: string
  stop(): Promise<void>
}

export interface StartAirlineOptions {
  /** Defaults to the profile's port. */
  port?: number
  /** Receives each line the process prints; ignored by default. */
  onOutput?: (profile: AirlineProfile, line: string) => void
}

/** Starts the airline in its own process and resolves once its Agent Card is served. */
export async function startAirline(profile: AirlineProfile, options: StartAirlineOptions = {}): Promise<AirlineProcess> {
  const port = options.port ?? profile.port
  const url = `http://localhost:${port}`
  // The airlines need no LLM: they do not get the API key.
  const { GOOGLE_API_KEY: _key, GEMINI_API_KEY: _gemini, GOOGLE_GENAI_API_KEY: _genai, ...env } = process.env
  const child = spawn(process.execPath, ['--import', 'tsx', ENTRY, profile.id, '--port', String(port)], {
    cwd: EXAMPLE_ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const output: string[] = []
  for (const stream of [child.stdout!, child.stderr!]) {
    createInterface({ input: stream }).on('line', (line) => {
      output.push(line)
      options.onOutput?.(profile, line)
    })
  }
  // Never leave an airline running if this process exits without stopping it.
  const killOnExit = () => child.kill('SIGKILL')
  process.once('exit', killOnExit)

  const stop = async () => {
    process.removeListener('exit', killOnExit)
    await terminate(child)
  }
  try {
    await waitForAgentCard(url, child, output)
  } catch (e) {
    await stop()
    throw e
  }
  return { profile, url, stop }
}

/** Starts several airlines; if one fails, stops those already started. */
export async function startAirlines(
  airlines: readonly { profile: AirlineProfile; port?: number }[],
  onOutput?: StartAirlineOptions['onOutput'],
): Promise<AirlineProcess[]> {
  const results = await Promise.allSettled(airlines.map(({ profile, port }) => startAirline(profile, { port, onOutput })))
  const started = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []))
  const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected')
  if (failed) {
    await stopAirlines(started)
    throw failed.reason
  }
  return started
}

export async function stopAirlines(airlines: readonly AirlineProcess[]): Promise<void> {
  await Promise.all(airlines.map((airline) => airline.stop()))
}

async function waitForAgentCard(url: string, child: ChildProcess, output: string[]): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`the airline at ${url} exited with code ${child.exitCode}: ${output.join(' | ')}`)
    }
    try {
      const response = await fetch(`${url}/${AGENT_CARD_PATH}`)
      if (response.ok) return
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`the airline at ${url} did not serve its Agent Card within ${READY_TIMEOUT_MS / 1000} s`)
}

function terminate(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve()
  return new Promise((resolve) => {
    const timer = setTimeout(() => child.kill('SIGKILL'), 5_000)
    child.once('exit', () => {
      clearTimeout(timer)
      resolve()
    })
    child.kill('SIGTERM')
  })
}
