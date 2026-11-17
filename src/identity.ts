/**
 * DID creation, DID document updates and resolution.
 */
import type { DIDDocument, IIdentifier, IKey, IService } from '@veramo/core-types'
import { computeAddress } from 'ethers'
import { type Actor, ethrProviderName } from './actor.js'

/**
 * Creates a new `did:ethr:<network>:0x<compressed public key>` controlled by
 * the actor. The secp256k1 key pair is generated inside the actor's own key
 * management system and never leaves it. Creation is free: an ERC-1056
 * identity exists implicitly, the registry is only written to when the
 * document changes (keys, services, owner).
 */
export async function createIdentity(actor: Actor, options: { alias?: string } = {}): Promise<IIdentifier> {
  return actor.agent.didManagerCreate({
    provider: ethrProviderName(actor.ethr.name),
    alias: options.alias,
    options: { network: actor.ethr.name },
  })
}

/** The key that controls the identifier (signs credentials, presentations and registry transactions). */
export function controllerKey(identifier: IIdentifier): IKey {
  const key = identifier.keys.find((k) => k.kid === identifier.controllerKeyId) ?? identifier.keys[0]
  if (!key) throw new Error(`identifier ${identifier.did} has no keys`)
  return key
}

/** Ethereum address of a did:ethr identifier, derived from its controller key. */
export function ethereumAddressOf(identifier: IIdentifier): string {
  const key = controllerKey(identifier)
  if (key.type !== 'Secp256k1') {
    throw new Error(`identifier ${identifier.did} is not controlled by a secp256k1 key`)
  }
  return computeAddress('0x' + key.publicKeyHex)
}

export interface AddServiceOptions {
  /** Validity of the registry attribute, in seconds (default: one year). */
  ttl?: number
}

/**
 * Adds a service endpoint to a did:ethr document. This sends a `setAttribute`
 * transaction to the ERC-1056 registry, signed by the actor's controller key
 * through its key management system, so the controller address needs some ETH.
 * Returns the transaction hash once the transaction is mined.
 */
export async function addServiceEndpoint(
  actor: Actor,
  did: string,
  service: IService,
  options: AddServiceOptions = {},
): Promise<string> {
  const result: unknown = await actor.agent.didManagerAddService({
    did,
    service,
    options: { ttl: options.ttl ?? 365 * 24 * 3600 },
  })
  if (typeof result === 'string') return result
  if (result && typeof result === 'object' && 'hash' in result) return String((result as { hash: unknown }).hash)
  return String(result)
}

/** Resolves a DID through the actor's own resolver and returns the document, or throws. */
export async function resolveDidDocument(actor: Actor, did: string): Promise<DIDDocument> {
  const result = await actor.agent.resolveDid({ didUrl: did })
  const { error, message } = result.didResolutionMetadata ?? {}
  if (error || !result.didDocument) {
    throw new Error(`cannot resolve ${did}: ${error ?? 'no document'}${message ? ` (${message})` : ''}`)
  }
  return result.didDocument
}
