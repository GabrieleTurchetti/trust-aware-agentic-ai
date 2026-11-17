import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import {
  type Actor,
  addServiceEndpoint,
  type ChainSetup,
  type CheckResult,
  createActor,
  createIdentity,
  createPresentation,
  createStatusChecker,
  ethereumAddressOf,
  fundAddress,
  type IIdentifier,
  issueSkillCredential,
  randomNonce,
  REASON,
  setupLocalChain,
  StatusListIssuer,
  type VerifiableCredential,
  verifyCredential,
  verifyPresentation,
  verifyServiceEndpoint,
} from 'trust-aware-agentic-ai'
import { FLIGHT_SKILL, tamperJwt, tempDataDir, testEventLog } from './helpers.js'

/** A port different from the demo's, so the tests can run while a demo chain is up. */
const TEST_PORT = 8546

describe('credentials on a local chain', { timeout: 120_000 }, () => {
  const data = tempDataDir('credentials')
  const log = testEventLog('credentials')
  let setup: ChainSetup
  let caa: Actor, ita: Actor, airlineB: Actor, booking: Actor
  let caaId: IIdentifier, itaId: IIdentifier, airlineBId: IIdentifier, bookingId: IIdentifier
  let statusList: StatusListIssuer
  let itaCredential: VerifiableCredential, airlineBCredential: VerifiableCredential

  before(async () => {
    setup = await setupLocalChain({ port: TEST_PORT })
    const ethr = setup.network
    ;[caa, ita, airlineB, booking] = await Promise.all(
      ['caa', 'ita', 'airline-b', 'booking'].map((name) => createActor({ name, dataDir: data.dir, ethr })),
    )
    caaId = await createIdentity(caa)
    itaId = await createIdentity(ita)
    airlineBId = await createIdentity(airlineB)
    bookingId = await createIdentity(booking)
    await fundAddress(setup.deployer, ethereumAddressOf(caaId))
    await fundAddress(setup.deployer, ethereumAddressOf(itaId))

    statusList = new StatusListIssuer(caa, caaId, { chainId: ethr.chainId, address: setup.statusList })
    const issue = (subject: string) =>
      issueSkillCredential(caa, {
        issuer: caaId.did,
        subject,
        skill: FLIGHT_SKILL,
        credentialStatus: statusList.entry(statusList.allocateIndex()),
      })
    itaCredential = await issue(itaId.did)
    airlineBCredential = await issue(airlineBId.did)
  })

  after(async () => {
    await Promise.all([caa, ita, airlineB, booking].filter(Boolean).map((actor) => actor.close()))
    await setup?.stop()
    data.cleanup()
  })

  const policy = () => ({
    skill: FLIGHT_SKILL,
    trustedIssuers: [caaId.did],
    statusChecker: createStatusChecker({ provider: booking.provider, chainId: setup.network.chainId }),
  })

  /** The holder answers a fresh nonce from Booking with a presentation of `credentials`. */
  const present = async (holder: Actor, holderId: IIdentifier, credentials: (VerifiableCredential | string)[]) => {
    const nonce = randomNonce()
    const presentation = await createPresentation(holder, {
      holder: holderId.did,
      credentials,
      challenge: nonce,
      verifier: bookingId.did,
    })
    return { nonce, presentation }
  }

  const record = (check: string, holder: IIdentifier, expected: 'accepted' | 'rejected', result: CheckResult) =>
    log.record({ phase: 'test', check, verifier: bookingId.did, holder: holder.did, expected, result })

  it('creates did:ethr identifiers on the development network', () => {
    assert.match(itaId.did, /^did:ethr:development:0x[0-9a-f]{66}$/)
  })

  it('accepts a valid presentation', async () => {
    const { nonce, presentation } = await present(ita, itaId, [itaCredential])
    const result = await verifyPresentation(booking, presentation, { challenge: nonce, ...policy() })
    record('valid presentation', itaId, 'accepted', result)
    assert.equal(result.ok, true, result.reason)
    assert.equal(result.reason, REASON.accepted)
    assert.equal(result.details?.skill, FLIGHT_SKILL)
    assert.ok(result.durationMs >= 0)
  })

  it('rejects a presentation with the wrong challenge', async () => {
    const { presentation } = await present(ita, itaId, [itaCredential])
    const result = await verifyPresentation(booking, presentation, { challenge: randomNonce(), ...policy() })
    record('wrong challenge', itaId, 'rejected', result)
    assert.equal(result.ok, false)
    assert.equal(result.reason, REASON.challenge)
  })

  it('rejects a credential once its issuer revokes it', async () => {
    const index = Number(airlineBCredential.credentialStatus!.statusListIndex)
    const before = await present(airlineB, airlineBId, [airlineBCredential])
    const accepted = await verifyPresentation(booking, before.presentation, { challenge: before.nonce, ...policy() })
    assert.equal(accepted.ok, true, accepted.reason)

    await statusList.revoke(index)
    assert.equal(await statusList.isRevoked(index), true)

    const after = await present(airlineB, airlineBId, [airlineBCredential])
    const result = await verifyPresentation(booking, after.presentation, { challenge: after.nonce, ...policy() })
    record('revoked credential', airlineBId, 'rejected', result)
    assert.equal(result.ok, false)
    assert.equal(result.reason, REASON.revoked)
    assert.equal(result.details?.statusListIndex, index)
  })

  it('rejects a credential whose credentialSubject was tampered with', async () => {
    const forged = tamperJwt(itaCredential.proof.jwt, (payload) => {
      payload.vc.credentialSubject.skill = 'hotel-booking'
    })
    const { nonce, presentation } = await present(ita, itaId, [forged])
    const result = await verifyPresentation(booking, presentation, { challenge: nonce, ...policy(), skill: 'hotel-booking' })
    record('tampered credentialSubject', itaId, 'rejected', result)
    assert.equal(result.ok, false)
    assert.equal(result.reason, REASON.credentialSignature)
  })

  it('rejects a credential tampered to point at a valid status bit', async () => {
    const forged = tamperJwt(airlineBCredential.proof.jwt, (payload) => {
      payload.vc.credentialStatus.statusListIndex = itaCredential.credentialStatus!.statusListIndex
    })
    const { nonce, presentation } = await present(airlineB, airlineBId, [forged])
    const result = await verifyPresentation(booking, presentation, { challenge: nonce, ...policy() })
    record('tampered credentialStatus', airlineBId, 'rejected', result)
    assert.equal(result.ok, false)
    assert.equal(result.reason, REASON.credentialSignature)
  })

  it('rejects a credential whose JSON no longer matches its proof', async () => {
    const modified = {
      ...itaCredential,
      credentialSubject: { ...itaCredential.credentialSubject, skill: 'hotel-booking' },
    }
    const result = await verifyCredential(booking, modified, { statusChecker: policy().statusChecker })
    record('credential JSON modified after signing', itaId, 'rejected', result)
    assert.equal(result.ok, false)
    assert.equal(result.reason, REASON.credentialMismatch)
  })

  it('rejects a credential for another skill', async () => {
    const { nonce, presentation } = await present(ita, itaId, [itaCredential])
    const result = await verifyPresentation(booking, presentation, { challenge: nonce, ...policy(), skill: 'hotel-booking' })
    assert.equal(result.ok, false)
    assert.equal(result.reason, REASON.skill)
  })

  it('rejects a credential from an untrusted issuer', async () => {
    const { nonce, presentation } = await present(ita, itaId, [itaCredential])
    const result = await verifyPresentation(booking, presentation, {
      challenge: nonce,
      ...policy(),
      trustedIssuers: [bookingId.did],
    })
    assert.equal(result.ok, false)
    assert.equal(result.reason, REASON.issuer)
  })

  it('rejects a presentation by someone other than the subject', async () => {
    const { nonce, presentation } = await present(booking, bookingId, [itaCredential])
    const result = await verifyPresentation(booking, presentation, { challenge: nonce, ...policy() })
    assert.equal(result.ok, false)
    assert.equal(result.reason, REASON.subject)
  })

  it('rejects a credential with a status entry when no status checker is configured', async () => {
    const { nonce, presentation } = await present(ita, itaId, [itaCredential])
    const result = await verifyPresentation(booking, presentation, { challenge: nonce, skill: FLIGHT_SKILL })
    assert.equal(result.ok, false)
    assert.equal(result.reason, REASON.statusUnavailable)
  })

  it('lets only the issuer change the bits of its own list', async () => {
    const index = statusList.allocateIndex()
    await statusList.revoke(index)
    // ITA calls the same contract with the same index: it only writes its own list.
    const itaAsIssuer = new StatusListIssuer(ita, itaId, { chainId: setup.network.chainId, address: setup.statusList })
    await itaAsIssuer.setStatus(index, false)
    assert.equal(await statusList.isRevoked(index), true)
  })

  it('shows a service endpoint in the resolved DID document', async () => {
    const card = { type: 'AgentCard', serviceEndpoint: 'http://localhost:9001/.well-known/agent-card.json' }
    const missing = await verifyServiceEndpoint(booking, itaId.did, card)
    assert.equal(missing.reason, REASON.serviceMissing)
    await addServiceEndpoint(ita, itaId.did, { id: `${itaId.did}#agent-card`, ...card })
    const result = await verifyServiceEndpoint(booking, itaId.did, card)
    record('service endpoint in DID document', itaId, 'accepted', result)
    assert.equal(result.ok, true, result.reason)
  })
})
