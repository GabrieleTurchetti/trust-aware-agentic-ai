/**
 * Fixtures shared by the unit tests: temporary directories, actors with a
 * did:ethr, a network that is never contacted, and JWT helpers.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { type Actor, createActor, createIdentity, type EthrNetwork, type IIdentifier } from 'trust-aware-agentic-ai'

/**
 * Ports of the local chains started by the test files that need one. They
 * differ from the ports of examples/veramo_credentials (8545 for its demo,
 * 8546 for its tests), so everything can run at the same time.
 */
export const TEST_PORTS = {
  chain: 8547,
  identity: 8548,
  status: 8549,
  verification: 8550,
} as const

/**
 * A did:ethr network whose JSON-RPC endpoint is never contacted. Creating
 * identities, issuing credentials and signing presentations work without a
 * chain; resolving a DID does not.
 */
export const OFFLINE_NETWORK: EthrNetwork = {
  name: 'development',
  chainId: 31337,
  rpcUrl: 'http://127.0.0.1:9',
  registry: '0x0000000000000000000000000000000000000001',
}

export const FLIGHT_SKILL = 'flight-booking'

export function tempDir(prefix: string): { dir: string; cleanup(): void } {
  const dir = mkdtempSync(path.join(tmpdir(), `trust-aware-agentic-ai-${prefix}-`))
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

export interface TestActor {
  actor: Actor
  id: IIdentifier
}

/** Creates one actor per name, each with its own database, keys and did:ethr. */
export async function createActors<N extends string>(
  names: readonly N[],
  dataDir: string,
  ethr: EthrNetwork,
): Promise<Record<N, TestActor>> {
  const entries = await Promise.all(
    names.map(async (name) => {
      const actor = await createActor({ name, dataDir, ethr })
      return [name, { actor, id: await createIdentity(actor, { alias: name }) }] as const
    }),
  )
  return Object.fromEntries(entries) as Record<N, TestActor>
}

export async function closeActors(actors: Partial<Record<string, TestActor>>): Promise<void> {
  await Promise.all(Object.values(actors).map((a) => a?.actor.close()))
}

/** Decodes the payload of a compact JWT, without verifying it. */
export function jwtPayload(jwt: string): Record<string, any> {
  return JSON.parse(Buffer.from(jwt.split('.')[1]!, 'base64url').toString('utf8'))
}

/**
 * Re-encodes a JWT with a modified payload and the original signature, as an
 * attacker without the signer's key would have to do.
 */
export function tamperJwt(jwt: string, mutate: (payload: Record<string, any>) => void): string {
  const [header, , signature] = jwt.split('.')
  const payload = jwtPayload(jwt)
  mutate(payload)
  return `${header}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.${signature}`
}
