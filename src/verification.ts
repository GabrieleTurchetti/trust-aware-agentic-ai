/**
 * Verification of presentations and credentials.
 *
 * Every function returns a {@link CheckResult}: `ok`, a stable `reason` and
 * the time spent. The reasons are the vocabulary a future A2A trust layer and
 * its evaluation scripts can rely on.
 *
 * Veramo verifies signatures, challenge and validity periods. What Veramo does
 * not do is done here: the embedded credentials of a presentation are verified
 * one by one, the status bit is read right after the signature check, and the
 * verifier's policy is applied (subject = holder, requested skill, trusted
 * issuers).
 */
import type {
  DIDDocument,
  IError,
  VerifiableCredential,
  VerifiablePresentation,
  W3CVerifiableCredential,
  W3CVerifiablePresentation,
} from '@veramo/core-types'
import { decodeCredentialToObject, decodePresentationToObject, extractIssuer } from '@veramo/utils'
import { performance } from 'node:perf_hooks'
import type { Actor } from './actor.js'
import { SKILL_CREDENTIAL_TYPE } from './credentials.js'
import type { CheckResult } from './events.js'
import { resolveDidDocument } from './identity.js'

export const REASON = {
  accepted: 'accepted',
  presentationSignature: 'invalid presentation signature',
  challenge: 'challenge mismatch',
  audience: 'audience mismatch',
  presentationInvalid: 'invalid presentation',
  noCredential: 'no credential in presentation',
  credentialSignature: 'invalid credential signature',
  credentialMismatch: 'credential does not match its proof',
  credentialExpired: 'expired credential',
  credentialInvalid: 'invalid credential',
  subject: 'subject mismatch',
  skill: 'skill mismatch',
  issuer: 'untrusted issuer',
  revoked: 'revoked credential',
  statusUnavailable: 'status check unavailable',
  serviceFound: 'service endpoint found',
  serviceMissing: 'service endpoint missing',
  resolution: 'DID resolution failed',
} as const

export type Reason = (typeof REASON)[keyof typeof REASON]

export interface StatusCheck {
  revoked: boolean
  details?: Record<string, unknown>
}

/**
 * Reads the status of a credential that carries a `credentialStatus`.
 * The issuer's DID document is passed so the checker can bind the status
 * list to the issuer's on-chain identity. It throws when the status cannot
 * be determined.
 */
export type StatusChecker = (
  credential: VerifiableCredential,
  issuerDocument: DIDDocument,
) => Promise<StatusCheck>

export interface VerifyCredentialOptions {
  /** Required to accept credentials that carry a `credentialStatus`. */
  statusChecker?: StatusChecker
}

export interface VerifyPresentationOptions extends VerifyCredentialOptions {
  /** The challenge the verifier sent; the presentation must be signed over it. */
  challenge: string
  /** Skill the verifier is looking for, matched against `credentialSubject.skill`. */
  skill?: string
  /** Issuer DIDs trusted for that skill. When omitted, any issuer is accepted. */
  trustedIssuers?: string[]
}

type Timer = () => number

function startTimer(): Timer {
  const start = performance.now()
  return () => Math.round((performance.now() - start) * 100) / 100
}

function failure(reason: string, elapsed: Timer, details?: Record<string, unknown>): CheckResult {
  return { ok: false, reason, durationMs: elapsed(), ...(details ? { details } : {}) }
}

function errorDetails(error: IError | undefined): Record<string, unknown> {
  return { errorCode: error?.errorCode, message: error?.message }
}

function presentationReason(error: IError | undefined): string {
  const code = error?.errorCode ?? ''
  const message = error?.message ?? ''
  if (code === 'auth_error') return REASON.challenge
  if (code === 'invalid_config' || /audience/i.test(message)) return REASON.audience
  if (code === 'invalid_signature') return REASON.presentationSignature
  return REASON.presentationInvalid
}

function credentialReason(error: IError | undefined): string {
  const code = error?.errorCode ?? ''
  const message = error?.message ?? ''
  if (code === 'invalid_signature') return REASON.credentialSignature
  if (code === 'invalid_credential') return REASON.credentialMismatch
  if (/expired/i.test(message)) return REASON.credentialExpired
  return REASON.credentialInvalid
}

/**
 * Verifies one credential: signature and validity period through Veramo,
 * then the status bit through `statusChecker` when the credential has a
 * `credentialStatus`. Veramo's own status policy is disabled because the
 * check is done here, explicitly, with the issuer's resolved document.
 */
export async function verifyCredential(
  verifier: Actor,
  credential: W3CVerifiableCredential,
  options: VerifyCredentialOptions = {},
): Promise<CheckResult> {
  const elapsed = startTimer()
  let result: Awaited<ReturnType<typeof verifier.agent.verifyCredential>>
  try {
    result = await verifier.agent.verifyCredential({ credential, policies: { credentialStatus: false } })
  } catch (e) {
    return failure(REASON.credentialInvalid, elapsed, { message: (e as Error).message })
  }
  if (!result.verified) {
    let reason = credentialReason(result.error)
    // Veramo reports a credential whose JSON differs from its JWT payload with
    // no error code: detect that case by verifying the signed JWT on its own.
    if (!result.error?.errorCode && typeof credential !== 'string' && typeof credential.proof?.jwt === 'string') {
      const jwtAlone = await verifier.agent.verifyCredential({
        credential: credential.proof.jwt,
        policies: { credentialStatus: false },
      })
      if (jwtAlone.verified) reason = REASON.credentialMismatch
    }
    return failure(reason, elapsed, errorDetails(result.error))
  }
  const vc = decodeCredentialToObject(credential)
  const issuer = extractIssuer(vc, { removeParameters: true })
  const details: Record<string, unknown> = { issuer, subject: vc.credentialSubject.id }

  if (vc.credentialStatus) {
    if (!options.statusChecker) {
      return failure(REASON.statusUnavailable, elapsed, { ...details, credentialStatus: vc.credentialStatus })
    }
    try {
      const issuerDocument = await resolveDidDocument(verifier, issuer)
      const status = await options.statusChecker(vc, issuerDocument)
      Object.assign(details, status.details)
      if (status.revoked) return failure(REASON.revoked, elapsed, details)
    } catch (e) {
      return failure(REASON.statusUnavailable, elapsed, { ...details, message: (e as Error).message })
    }
  }
  return { ok: true, reason: REASON.accepted, durationMs: elapsed(), details }
}

function isSkillCredential(vc: VerifiableCredential): boolean {
  const types = Array.isArray(vc.type) ? vc.type : [vc.type]
  return types.includes(SKILL_CREDENTIAL_TYPE) || typeof vc.credentialSubject.skill === 'string'
}

/**
 * Verifies a presentation received in answer to `challenge`:
 *
 * 1. presentation signature, holder, challenge and audience (Veramo);
 * 2. every embedded credential, with {@link verifyCredential}, including its status bit;
 * 3. a skill credential for the requested skill whose subject is the holder
 *    and whose issuer is trusted.
 *
 * The credentials are taken from the signed JWT payload, never from the outer
 * JSON, so that a tampered JSON copy cannot change what is verified.
 */
export async function verifyPresentation(
  verifier: Actor,
  presentation: W3CVerifiablePresentation,
  options: VerifyPresentationOptions,
): Promise<CheckResult> {
  const elapsed = startTimer()
  // Work on the signed payload only: what Veramo verifies is the JWT, not the outer JSON.
  const jwt: unknown = typeof presentation === 'string' ? presentation : presentation?.proof?.jwt
  if (typeof jwt !== 'string') {
    return failure(REASON.presentationInvalid, elapsed, { message: 'only JWT presentations are supported' })
  }
  let vpResult: Awaited<ReturnType<typeof verifier.agent.verifyPresentation>>
  try {
    vpResult = await verifier.agent.verifyPresentation({ presentation: jwt, challenge: options.challenge })
  } catch (e) {
    return failure(REASON.presentationInvalid, elapsed, { message: (e as Error).message })
  }
  if (!vpResult.verified) {
    return failure(presentationReason(vpResult.error), elapsed, errorDetails(vpResult.error))
  }
  const vp: VerifiablePresentation = decodePresentationToObject(jwt)
  const holder = vp.holder
  const credentials = vp.verifiableCredential ?? []
  if (credentials.length === 0) {
    return failure(REASON.noCredential, elapsed, { holder })
  }

  const verified: Array<{ vc: VerifiableCredential; details: Record<string, unknown> }> = []
  for (const credential of credentials) {
    const check = await verifyCredential(verifier, credential, options)
    if (!check.ok) {
      return failure(check.reason, elapsed, { holder, ...check.details })
    }
    verified.push({ vc: decodeCredentialToObject(credential), details: check.details ?? {} })
  }

  const skillCredentials = verified.filter(({ vc }) => isSkillCredential(vc))
  const matching = options.skill
    ? skillCredentials.filter(({ vc }) => vc.credentialSubject.skill === options.skill)
    : skillCredentials
  if (matching.length === 0) {
    return failure(REASON.skill, elapsed, {
      holder,
      requestedSkill: options.skill,
      presentedSkills: skillCredentials.map(({ vc }) => vc.credentialSubject.skill),
    })
  }

  const { vc, details } = matching[0]!
  const issuer = extractIssuer(vc, { removeParameters: true })
  if (vc.credentialSubject.id !== holder) {
    return failure(REASON.subject, elapsed, { holder, subject: vc.credentialSubject.id })
  }
  if (options.trustedIssuers && !options.trustedIssuers.includes(issuer)) {
    return failure(REASON.issuer, elapsed, { holder, issuer, trustedIssuers: options.trustedIssuers })
  }
  return {
    ok: true,
    reason: REASON.accepted,
    durationMs: elapsed(),
    details: { holder, issuer, skill: vc.credentialSubject.skill, ...details },
  }
}

/**
 * Checks that a DID document lists a service endpoint, for example the URL of
 * the agent's Agent Card. The document is resolved through the verifier's own
 * resolver, i.e. read from the chain.
 */
export async function verifyServiceEndpoint(
  verifier: Actor,
  did: string,
  expected: { type: string; serviceEndpoint: string },
): Promise<CheckResult> {
  const elapsed = startTimer()
  let document: DIDDocument
  try {
    document = await resolveDidDocument(verifier, did)
  } catch (e) {
    return failure(REASON.resolution, elapsed, { did, message: (e as Error).message })
  }
  const services = document.service ?? []
  const service = services.find((s) => s.type === expected.type && s.serviceEndpoint === expected.serviceEndpoint)
  if (!service) return failure(REASON.serviceMissing, elapsed, { did, expected, services })
  return { ok: true, reason: REASON.serviceFound, durationMs: elapsed(), details: { did, service } }
}
