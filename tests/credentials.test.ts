import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import {
  createPresentation,
  ethereumAddressOf,
  issueSkillCredential,
  randomNonce,
  SKILL_CREDENTIAL_TYPE,
  statusEntry,
  type VerifiableCredential,
} from 'trust-aware-agentic-ai'
import { closeActors, createActors, FLIGHT_SKILL, jwtPayload, OFFLINE_NETWORK, type TestActor, tempDir } from './helpers.js'

/** Where Hardhat account #0 deploys its first contract; never contacted here. */
const STATUS_LIST = { chainId: 31337, address: '0x5FbDB2315678afecb367f032d93F642f64180aa3' }

describe('issuing and presenting, without a chain', () => {
  const data = tempDir('credentials')
  let caa: TestActor, ita: TestActor, booking: TestActor
  let credential: VerifiableCredential

  before(async () => {
    ;({ caa, ita, booking } = await createActors(['caa', 'ita', 'booking'], data.dir, OFFLINE_NETWORK))
    credential = await issueSkillCredential(caa.actor, {
      issuer: caa.id.did,
      subject: ita.id.did,
      skill: FLIGHT_SKILL,
      licence: 'Air Operator Certificate IT-001',
      issuanceDate: new Date('2026-01-01T00:00:00Z'),
    })
  })

  after(async () => {
    await closeActors({ caa, ita, booking })
    data.cleanup()
  })

  it('creates did:ethr identifiers from a compressed secp256k1 public key', () => {
    assert.match(ita.id.did, /^did:ethr:development:0x0[23][0-9a-f]{64}$/)
    assert.equal(ita.id.keys[0]?.type, 'Secp256k1')
  })

  it('issues a SkillCredential as a JWT signed by the issuer', () => {
    assert.deepEqual(credential.type, ['VerifiableCredential', SKILL_CREDENTIAL_TYPE])
    assert.equal(credential.credentialSubject.id, ita.id.did)
    assert.equal(credential.credentialSubject.skill, FLIGHT_SKILL)
    const payload = jwtPayload(credential.proof.jwt)
    assert.equal(payload.iss, caa.id.did)
    assert.equal(payload.sub, ita.id.did)
    assert.equal(payload.vc.credentialSubject.skill, FLIGHT_SKILL)
    assert.equal(payload.vc.credentialSubject.licence, 'Air Operator Certificate IT-001')
  })

  it('makes a credential valid for one year by default', () => {
    const payload = jwtPayload(credential.proof.jwt)
    assert.equal(payload.nbf, Date.parse('2026-01-01T00:00:00Z') / 1000)
    assert.equal(payload.exp, Date.parse('2027-01-01T00:00:00Z') / 1000)
  })

  it('signs the status list entry into the credential', async () => {
    const entry = statusEntry(STATUS_LIST, ethereumAddressOf(caa.id), 7)
    const withStatus = await issueSkillCredential(caa.actor, {
      issuer: caa.id.did,
      subject: ita.id.did,
      skill: FLIGHT_SKILL,
      credentialStatus: entry,
    })
    assert.deepEqual(jwtPayload(withStatus.proof.jwt).vc.credentialStatus, entry)
  })

  it('refuses to issue with a DID that the actor does not control', async () => {
    await assert.rejects(
      issueSkillCredential(booking.actor, { issuer: caa.id.did, subject: ita.id.did, skill: FLIGHT_SKILL }),
      /managed by this agent/,
    )
  })

  it('signs the challenge and the verifier into the presentation', async () => {
    const presentation = await createPresentation(ita.actor, {
      holder: ita.id.did,
      credentials: [credential],
      challenge: 'challenge-1',
      verifier: booking.id.did,
    })
    const payload = jwtPayload(presentation.proof.jwt)
    assert.equal(payload.iss, ita.id.did)
    assert.equal(payload.nonce, 'challenge-1')
    assert.deepEqual([payload.aud].flat(), [booking.id.did])
    assert.deepEqual(payload.vp.verifiableCredential, [credential.proof.jwt])
  })

  it('refuses to present with a DID that the actor does not control', async () => {
    await assert.rejects(
      createPresentation(booking.actor, { holder: ita.id.did, credentials: [credential], challenge: 'challenge-2' }),
    )
  })

  it('generates unpredictable base64url nonces', () => {
    const nonces = new Set(Array.from({ length: 100 }, () => randomNonce()))
    assert.equal(nonces.size, 100)
    for (const nonce of nonces) assert.match(nonce, /^[A-Za-z0-9_-]{22}$/)
    assert.equal(randomNonce(32).length, 43)
  })
})
