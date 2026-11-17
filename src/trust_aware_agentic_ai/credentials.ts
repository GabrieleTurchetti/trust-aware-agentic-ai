/**
 * Issuing credentials and building presentations.
 *
 * Credentials and presentations use the JWT proof format (`application/vc+jwt`
 * in the Agent Card of the end-to-end example), signed with ES256K by the
 * secp256k1 key that controls the signer's did:ethr.
 */
import type {
  CredentialStatusReference,
  VerifiableCredential,
  VerifiablePresentation,
  W3CVerifiableCredential,
} from '@veramo/core-types'
import { randomBytes } from 'node:crypto'
import type { Actor } from './actor.js'

export const SKILL_CREDENTIAL_TYPE = 'SkillCredential'
export const CREDENTIALS_CONTEXT = 'https://www.w3.org/2018/credentials/v1'

const ONE_YEAR_MS = 365 * 24 * 3600 * 1000

export interface SkillCredentialInput {
  /** DID of the issuer; it must be managed by the issuing actor. */
  issuer: string
  /** DID of the holder (the agent that owns the skill). */
  subject: string
  /** Skill id, e.g. `flight-booking`. */
  skill: string
  /** Free-text licence information, as in the end-to-end example. */
  licence?: string
  issuanceDate?: Date
  /** Defaults to one year after the issuance date. */
  expirationDate?: Date
  /** Status list entry, when the issuer supports revocation. */
  credentialStatus?: CredentialStatusReference
}

/** Issues a `SkillCredential` signed by the issuer's controller key. */
export async function issueSkillCredential(
  issuer: Actor,
  input: SkillCredentialInput,
): Promise<VerifiableCredential> {
  const issuanceDate = input.issuanceDate ?? new Date()
  const expirationDate = input.expirationDate ?? new Date(issuanceDate.getTime() + ONE_YEAR_MS)
  return issuer.agent.createVerifiableCredential({
    credential: {
      '@context': [CREDENTIALS_CONTEXT],
      type: ['VerifiableCredential', SKILL_CREDENTIAL_TYPE],
      issuer: { id: input.issuer },
      issuanceDate: issuanceDate.toISOString(),
      expirationDate: expirationDate.toISOString(),
      credentialSubject: {
        id: input.subject,
        skill: input.skill,
        ...(input.licence ? { licence: input.licence } : {}),
      },
      ...(input.credentialStatus ? { credentialStatus: input.credentialStatus } : {}),
    },
    proofFormat: 'jwt',
  })
}

/** A fresh, unpredictable challenge for a presentation request. */
export function randomNonce(bytes = 16): string {
  return randomBytes(bytes).toString('base64url')
}

export interface PresentationInput {
  /** DID of the holder; it must be managed by the presenting actor. */
  holder: string
  /** Credentials to present, as objects or compact JWTs. */
  credentials: W3CVerifiableCredential[]
  /** Challenge received from the verifier, signed into the presentation as `nonce`. */
  challenge: string
  /** DID of the intended verifier, signed into the presentation as `aud`. */
  verifier?: string
}

/** Builds a Verifiable Presentation signed by the holder over the verifier's challenge. */
export async function createPresentation(
  holder: Actor,
  input: PresentationInput,
): Promise<VerifiablePresentation> {
  return holder.agent.createVerifiablePresentation({
    presentation: {
      holder: input.holder,
      ...(input.verifier ? { verifier: [input.verifier] } : {}),
      type: ['VerifiablePresentation'],
      verifiableCredential: input.credentials,
    },
    challenge: input.challenge,
    proofFormat: 'jwt',
  })
}
