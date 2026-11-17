/**
 * Shared fixtures for the tests: temporary data directories, an event log
 * under `events/`, and a way to forge a tampered credential.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { EventLog } from 'trust-aware-agentic-ai'

/** Root of this example: the tests write their event logs under its events/ folder. */
const EXAMPLE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export const FLIGHT_SKILL = 'flight-booking'

export function tempDataDir(prefix: string): { dir: string; cleanup(): void } {
  const dir = mkdtempSync(path.join(tmpdir(), `veramo-credentials-${prefix}-`))
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

export function testEventLog(name: string): EventLog {
  return new EventLog({ dir: path.join(EXAMPLE_ROOT, 'events'), name: `test-${name}`, quiet: true })
}

/**
 * Re-encodes a credential JWT with a modified payload and the original
 * signature, as an attacker without the issuer's key would have to do.
 */
export function tamperJwt(jwt: string, mutate: (payload: Record<string, any>) => void): string {
  const [header, payload, signature] = jwt.split('.')
  const decoded = JSON.parse(Buffer.from(payload!, 'base64url').toString('utf8'))
  mutate(decoded)
  const encoded = Buffer.from(JSON.stringify(decoded)).toString('base64url')
  return `${header}.${encoded}.${signature}`
}
