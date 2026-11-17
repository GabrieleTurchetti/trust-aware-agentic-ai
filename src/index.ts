/**
 * Entry point of the `trust-aware-agentic-ai` library: did:ethr identities,
 * Verifiable Credentials, on-chain revocation and verification, independent
 * of A2A for now. Everything a future A2A trust extension needs is exported
 * from here.
 */
export * from './actor.js'
export * from './chain.js'
export * from './credentials.js'
export * from './events.js'
export * from './identity.js'
export * from './status.js'
export * from './verification.js'

export type {
  CredentialStatusReference,
  DIDDocument,
  IIdentifier,
  VerifiableCredential,
  VerifiablePresentation,
} from '@veramo/core-types'
