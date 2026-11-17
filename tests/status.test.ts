import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import {
  type ChainSetup,
  controllerAddressOf,
  createProvider,
  createStatusChecker,
  type DIDDocument,
  ethereumAddressOf,
  fundAddress,
  HARDHAT_ACCOUNT_0,
  HARDHAT_CHAIN_ID,
  issueSkillCredential,
  parseStatusListId,
  resolveDidDocument,
  setupLocalChain,
  STATUS_ENTRY_TYPE,
  statusEntry,
  StatusListIssuer,
  type StatusListLocation,
  statusListId,
  type VerifiableCredential,
} from 'trust-aware-agentic-ai'
import { closeActors, createActors, FLIGHT_SKILL, OFFLINE_NETWORK, TEST_PORTS, type TestActor, tempDir } from './helpers.js'

/** Where Hardhat account #0 deploys its first contract, in checksum form. */
const CONTRACT = '0x5FbDB2315678afecb367f032d93F642f64180aa3'
const LOCATION: StatusListLocation = { chainId: HARDHAT_CHAIN_ID, address: CONTRACT.toLowerCase() }
const ISSUER = HARDHAT_ACCOUNT_0.address

/** A resolved did:ethr document, reduced to what the status checker reads. */
function documentFor(address: string): DIDDocument {
  const did = `did:ethr:development:${address}`
  return {
    id: did,
    verificationMethod: [
      {
        id: `${did}#controller`,
        type: 'EcdsaSecp256k1RecoveryMethod2020',
        controller: did,
        blockchainAccountId: `eip155:${HARDHAT_CHAIN_ID}:${address}`,
      },
    ],
  }
}

describe('status list entries', () => {
  it('names the contract CAIP-10 style, with a checksummed address', () => {
    assert.equal(statusListId(LOCATION), `eip155:31337:${CONTRACT}`)
  })

  it('parses a contract reference back', () => {
    assert.deepEqual(parseStatusListId(`eip155:31337:${CONTRACT}`), { chainId: 31337, address: CONTRACT })
  })

  it('rejects malformed contract references', () => {
    for (const bad of ['eip155:31337', `eip155:x:${CONTRACT}`, 'eip155:31337:0x1234', 42, undefined]) {
      assert.throws(() => parseStatusListId(bad), /invalid statusListContract/)
    }
  })

  it('builds the credentialStatus entry of an index', () => {
    assert.deepEqual(statusEntry(LOCATION, ISSUER.toLowerCase(), 3), {
      id: `eip155:31337:${CONTRACT}/${ISSUER}/3`,
      type: STATUS_ENTRY_TYPE,
      statusPurpose: 'revocation',
      statusListIndex: '3',
      statusListContract: `eip155:31337:${CONTRACT}`,
    })
  })

  it('rejects negative and fractional indexes', () => {
    assert.throws(() => statusEntry(LOCATION, ISSUER, -1), /invalid status list index/)
    assert.throws(() => statusEntry(LOCATION, ISSUER, 1.5), /invalid status list index/)
  })

  it('takes the issuer address from the #controller verification method', () => {
    assert.equal(controllerAddressOf(documentFor(ISSUER.toLowerCase())), ISSUER)
    assert.equal(controllerAddressOf({ id: 'did:example:empty' }), undefined)
  })
})

describe('status checker, before it reads the chain', () => {
  // These checks fail before any JSON-RPC call, so the provider is never contacted.
  const provider = createProvider(OFFLINE_NETWORK.rpcUrl)
  const checker = createStatusChecker({ provider, chainId: HARDHAT_CHAIN_ID })
  const issuerDocument = documentFor(ISSUER)
  const withStatus = (changes: Record<string, unknown>) =>
    ({ credentialStatus: { ...statusEntry(LOCATION, ISSUER, 1), ...changes } }) as unknown as VerifiableCredential
  after(() => provider.destroy())

  it('treats a credential without credentialStatus as not revoked', async () => {
    assert.deepEqual(await checker({} as VerifiableCredential, issuerDocument), { revoked: false })
  })

  it('refuses other status entry types', async () => {
    await assert.rejects(checker(withStatus({ type: 'BitstringStatusListEntry' }), issuerDocument), /unsupported/)
  })

  it('refuses a status list on another chain', async () => {
    const elsewhere = withStatus({ statusListContract: statusListId({ chainId: 1, address: CONTRACT }) })
    await assert.rejects(checker(elsewhere, issuerDocument), /on chain 1/)
  })

  it('refuses an invalid index', async () => {
    await assert.rejects(checker(withStatus({ statusListIndex: 'first' }), issuerDocument), /invalid statusListIndex/)
  })

  it('refuses an issuer document without an Ethereum address', async () => {
    await assert.rejects(checker(withStatus({}), { id: 'did:example:empty' }), /no Ethereum address/)
  })
})

describe('status list on a local chain', { timeout: 120_000 }, () => {
  const data = tempDir('status')
  let setup: ChainSetup | undefined
  let caa: TestActor, other: TestActor, booking: TestActor
  let location: StatusListLocation
  let caaList: StatusListIssuer

  before(async () => {
    setup = await setupLocalChain({ port: TEST_PORTS.status })
    ;({ caa, other, booking } = await createActors(['caa', 'other', 'booking'], data.dir, setup.network))
    await fundAddress(setup.deployer, ethereumAddressOf(caa.id))
    await fundAddress(setup.deployer, ethereumAddressOf(other.id))
    location = { chainId: setup.network.chainId, address: setup.statusList }
    caaList = new StatusListIssuer(caa.actor, caa.id, location)
  })

  after(async () => {
    await closeActors({ caa, other, booking })
    await setup?.stop()
    data.cleanup()
  })

  it('allocates indexes in order, from 1 unless told otherwise', () => {
    const list = new StatusListIssuer(caa.actor, caa.id, location)
    assert.deepEqual([list.allocateIndex(), list.allocateIndex()], [1, 2])
    assert.equal(new StatusListIssuer(caa.actor, caa.id, location, { firstIndex: 100 }).allocateIndex(), 100)
  })

  it('builds entries that point at its own list', () => {
    assert.deepEqual(caaList.entry(5), statusEntry(location, ethereumAddressOf(caa.id), 5))
  })

  it('revokes and restores a bit with transactions signed by the issuer', async () => {
    assert.equal(await caaList.isRevoked(3), false)
    const { txHash, blockNumber } = await caaList.revoke(3)
    assert.match(txHash, /^0x[0-9a-f]{64}$/)
    assert.ok(blockNumber > 0)
    assert.equal(await caaList.isRevoked(3), true)
    await caaList.setStatus(3, false)
    assert.equal(await caaList.isRevoked(3), false)
  })

  it('keeps the bits of different 256-bit words apart', async () => {
    await caaList.revoke(255)
    const bits = await Promise.all([254, 255, 256, 511].map((index) => caaList.isRevoked(index)))
    assert.deepEqual(bits, [false, true, false, false])
  })

  it('keeps one list per issuer', async () => {
    const otherList = new StatusListIssuer(other.actor, other.id, location)
    await otherList.revoke(7)
    assert.equal(await otherList.isRevoked(7), true)
    assert.equal(await caaList.isRevoked(7), false)
  })

  it('reads the bit of the issuer named by the resolved DID document', async () => {
    const checker = createStatusChecker({ provider: booking.actor.provider, chainId: location.chainId })
    const credential = await issueSkillCredential(caa.actor, {
      issuer: caa.id.did,
      subject: booking.id.did,
      skill: FLIGHT_SKILL,
      credentialStatus: caaList.entry(42),
    })
    const caaDocument = await resolveDidDocument(booking.actor, caa.id.did)
    assert.equal((await checker(credential, caaDocument)).revoked, false)

    await caaList.revoke(42)
    assert.deepEqual(await checker(credential, caaDocument), {
      revoked: true,
      details: { statusListContract: statusListId(location), statusListIndex: 42, issuerAddress: ethereumAddressOf(caa.id) },
    })
    // The same entry checked against another issuer's document reads that issuer's bit.
    const otherDocument = await resolveDidDocument(booking.actor, other.id.did)
    assert.equal((await checker(credential, otherDocument)).revoked, false)
  })
})
