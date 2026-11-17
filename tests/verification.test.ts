import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import {
  type ChainSetup,
  createPresentation,
  createStatusChecker,
  ethereumAddressOf,
  fundAddress,
  issueSkillCredential,
  randomNonce,
  REASON,
  setupLocalChain,
  statusEntry,
  StatusListIssuer,
  type VerifiableCredential,
  type VerifiablePresentation,
  verifyCredential,
  verifyPresentation,
  type VerifyPresentationOptions,
} from 'trust-aware-agentic-ai'
import { closeActors, createActors, FLIGHT_SKILL, tamperJwt, TEST_PORTS, type TestActor, tempDir } from './helpers.js'

const YEAR_MS = 365 * 24 * 3600 * 1000

describe('verification on a local chain', { timeout: 120_000 }, () => {
  const data = tempDir('verification')
  let setup: ChainSetup | undefined
  let caa: TestActor, ita: TestActor, booking: TestActor, stranger: TestActor
  let statusList: StatusListIssuer
  let valid: VerifiableCredential
  let policy: Omit<VerifyPresentationOptions, 'challenge'>

  /** A flight-booking credential from the CAA to ITA, with its own status bit. */
  const issue = (dates: { issuanceDate?: Date; expirationDate?: Date } = {}) =>
    issueSkillCredential(caa.actor, {
      issuer: caa.id.did,
      subject: ita.id.did,
      skill: FLIGHT_SKILL,
      ...dates,
      credentialStatus: statusList.entry(statusList.allocateIndex()),
    })

  /** The holder answers a fresh nonce with a presentation addressed to Booking, unless told otherwise. */
  const present = async (
    credentials: (VerifiableCredential | string)[],
    options: { holder?: TestActor; verifier?: string } = {},
  ) => {
    const holder = options.holder ?? ita
    const challenge = randomNonce()
    const presentation = await createPresentation(holder.actor, {
      holder: holder.id.did,
      credentials,
      challenge,
      verifier: options.verifier ?? booking.id.did,
    })
    return { challenge, presentation }
  }

  before(async () => {
    setup = await setupLocalChain({ port: TEST_PORTS.verification })
    ;({ caa, ita, booking, stranger } = await createActors(
      ['caa', 'ita', 'booking', 'stranger'],
      data.dir,
      setup.network,
    ))
    await fundAddress(setup.deployer, ethereumAddressOf(caa.id))
    statusList = new StatusListIssuer(caa.actor, caa.id, { chainId: setup.network.chainId, address: setup.statusList })
    valid = await issue()
    policy = {
      skill: FLIGHT_SKILL,
      trustedIssuers: [caa.id.did],
      statusChecker: createStatusChecker({ provider: booking.actor.provider, chainId: setup.network.chainId }),
    }
  })

  after(async () => {
    await closeActors({ caa, ita, booking, stranger })
    await setup?.stop()
    data.cleanup()
  })

  describe('verifyCredential', () => {
    it('accepts a valid credential and reports its issuer, subject and status bit', async () => {
      const result = await verifyCredential(booking.actor, valid, policy)
      assert.equal(result.ok, true, result.reason)
      assert.equal(result.reason, REASON.accepted)
      assert.equal(result.details?.issuer, caa.id.did)
      assert.equal(result.details?.subject, ita.id.did)
      assert.equal(result.details?.statusListIndex, Number(valid.credentialStatus!.statusListIndex))
      assert.ok(result.durationMs > 0)
    })

    it('accepts a credential without status, even without a status checker', async () => {
      const noStatus = await issueSkillCredential(caa.actor, { issuer: caa.id.did, subject: ita.id.did, skill: FLIGHT_SKILL })
      assert.equal((await verifyCredential(booking.actor, noStatus)).reason, REASON.accepted)
    })

    it('rejects an expired credential', async () => {
      const expired = await issue({
        issuanceDate: new Date(Date.now() - 2 * YEAR_MS),
        expirationDate: new Date(Date.now() - YEAR_MS),
      })
      assert.equal((await verifyCredential(booking.actor, expired, policy)).reason, REASON.credentialExpired)
    })

    it('rejects a credential whose signed payload was changed', async () => {
      const forged = tamperJwt(valid.proof.jwt, (payload) => {
        payload.vc.credentialSubject.skill = 'hotel-booking'
      })
      assert.equal((await verifyCredential(booking.actor, forged, policy)).reason, REASON.credentialSignature)
    })

    it('rejects a credential whose JSON no longer matches its proof', async () => {
      const modified = { ...valid, credentialSubject: { ...valid.credentialSubject, skill: 'hotel-booking' } }
      assert.equal((await verifyCredential(booking.actor, modified, policy)).reason, REASON.credentialMismatch)
    })

    it('rejects a revoked credential', async () => {
      const credential = await issue()
      const index = Number(credential.credentialStatus!.statusListIndex)
      await statusList.revoke(index)
      const result = await verifyCredential(booking.actor, credential, policy)
      assert.equal(result.reason, REASON.revoked)
      assert.equal(result.details?.statusListIndex, index)
    })

    it('does not accept a credential whose status it cannot check', async () => {
      assert.equal((await verifyCredential(booking.actor, valid)).reason, REASON.statusUnavailable)
      const elsewhere = await issueSkillCredential(caa.actor, {
        issuer: caa.id.did,
        subject: ita.id.did,
        skill: FLIGHT_SKILL,
        credentialStatus: statusEntry({ chainId: 1, address: setup!.statusList }, ethereumAddressOf(caa.id), 1),
      })
      const result = await verifyCredential(booking.actor, elsewhere, policy)
      assert.equal(result.reason, REASON.statusUnavailable)
      assert.match(String(result.details?.message), /on chain 1/)
    })
  })

  describe('verifyPresentation', () => {
    it('accepts a valid presentation', async () => {
      const { challenge, presentation } = await present([valid])
      const result = await verifyPresentation(booking.actor, presentation, { challenge, ...policy })
      assert.equal(result.ok, true, result.reason)
      assert.equal(result.details?.holder, ita.id.did)
      assert.equal(result.details?.issuer, caa.id.did)
      assert.equal(result.details?.skill, FLIGHT_SKILL)
    })

    it('rejects a presentation that is not a JWT', async () => {
      const presentation = {
        holder: ita.id.did,
        verifiableCredential: [valid],
        proof: { type: 'Ed25519Signature2020' },
      } as unknown as VerifiablePresentation
      const result = await verifyPresentation(booking.actor, presentation, { challenge: randomNonce(), ...policy })
      assert.equal(result.reason, REASON.presentationInvalid)
    })

    it('rejects a presentation signed over another challenge', async () => {
      const { presentation } = await present([valid])
      const result = await verifyPresentation(booking.actor, presentation, { challenge: randomNonce(), ...policy })
      assert.equal(result.reason, REASON.challenge)
    })

    it('rejects a presentation addressed to another verifier', async () => {
      const { challenge, presentation } = await present([valid], { verifier: stranger.id.did })
      assert.equal((await verifyPresentation(booking.actor, presentation, { challenge, ...policy })).reason, REASON.audience)
    })

    it('rejects a presentation without credentials', async () => {
      const { challenge, presentation } = await present([])
      assert.equal((await verifyPresentation(booking.actor, presentation, { challenge, ...policy })).reason, REASON.noCredential)
    })

    it('rejects a presentation whose credential was tampered with', async () => {
      const forged = tamperJwt(valid.proof.jwt, (payload) => {
        payload.vc.credentialSubject.skill = 'hotel-booking'
      })
      const { challenge, presentation } = await present([forged])
      const result = await verifyPresentation(booking.actor, presentation, { challenge, ...policy, skill: 'hotel-booking' })
      assert.equal(result.reason, REASON.credentialSignature)
    })

    it('rejects a credential for another skill', async () => {
      const { challenge, presentation } = await present([valid])
      const result = await verifyPresentation(booking.actor, presentation, { challenge, ...policy, skill: 'hotel-booking' })
      assert.equal(result.reason, REASON.skill)
    })

    it('rejects a credential presented by someone other than its subject', async () => {
      const { challenge, presentation } = await present([valid], { holder: stranger })
      assert.equal((await verifyPresentation(booking.actor, presentation, { challenge, ...policy })).reason, REASON.subject)
    })

    it('rejects a credential from an untrusted issuer', async () => {
      const { challenge, presentation } = await present([valid])
      const result = await verifyPresentation(booking.actor, presentation, {
        challenge,
        ...policy,
        trustedIssuers: [booking.id.did],
      })
      assert.equal(result.reason, REASON.issuer)
    })
  })
})
