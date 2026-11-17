import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { SigningKey, Wallet } from 'ethers'
import {
  addServiceEndpoint,
  type ChainSetup,
  controllerAddressOf,
  controllerKey,
  ethereumAddressOf,
  fundAddress,
  HARDHAT_ACCOUNT_0,
  type IIdentifier,
  REASON,
  resolveDidDocument,
  setupLocalChain,
  verifyServiceEndpoint,
} from 'trust-aware-agentic-ai'
import { closeActors, createActors, TEST_PORTS, type TestActor, tempDir } from './helpers.js'

type Key = IIdentifier['keys'][number]

function identifierWith(keys: Key[], controllerKeyId?: string): IIdentifier {
  return {
    did: 'did:ethr:development:0x02',
    provider: 'did:ethr:development',
    keys,
    services: [],
    ...(controllerKeyId ? { controllerKeyId } : {}),
  }
}

function secp256k1Key(kid: string, signingKey: SigningKey): Key {
  return { kid, kms: 'local', type: 'Secp256k1', publicKeyHex: signingKey.compressedPublicKey.slice(2) }
}

describe('identity helpers', () => {
  const account0 = secp256k1Key('account-0', new SigningKey(HARDHAT_ACCOUNT_0.privateKey))
  const random = secp256k1Key('random', Wallet.createRandom().signingKey)

  it('derives the Ethereum address of the controller key', () => {
    assert.equal(ethereumAddressOf(identifierWith([account0], 'account-0')), HARDHAT_ACCOUNT_0.address)
  })

  it('uses the controller key rather than the first key', () => {
    const identifier = identifierWith([random, account0], 'account-0')
    assert.equal(controllerKey(identifier).kid, 'account-0')
    assert.equal(ethereumAddressOf(identifier), HARDHAT_ACCOUNT_0.address)
  })

  it('refuses identifiers without a secp256k1 controller key', () => {
    assert.throws(() => ethereumAddressOf(identifierWith([{ ...account0, type: 'Ed25519' }], 'account-0')), /secp256k1/)
    assert.throws(() => controllerKey(identifierWith([])), /no keys/)
  })
})

describe('did:ethr on a local chain', { timeout: 120_000 }, () => {
  const data = tempDir('identity')
  const agentCard = { type: 'AgentCard', serviceEndpoint: 'http://localhost:9001/.well-known/agent-card.json' }
  let setup: ChainSetup | undefined
  let ita: TestActor, booking: TestActor

  before(async () => {
    setup = await setupLocalChain({ port: TEST_PORTS.identity })
    ;({ ita, booking } = await createActors(['ita', 'booking'], data.dir, setup.network))
    await fundAddress(setup.deployer, ethereumAddressOf(ita.id))
  })

  after(async () => {
    await closeActors({ ita, booking })
    await setup?.stop()
    data.cleanup()
  })

  it('resolves a new DID without any transaction', async () => {
    const document = await resolveDidDocument(booking.actor, ita.id.did)
    assert.equal(document.id, ita.id.did)
    assert.equal(controllerAddressOf(document), ethereumAddressOf(ita.id))
    assert.deepEqual(document.service ?? [], [])
  })

  it('publishes a service endpoint with a registry transaction', async () => {
    assert.equal((await verifyServiceEndpoint(booking.actor, ita.id.did, agentCard)).reason, REASON.serviceMissing)
    const txHash = await addServiceEndpoint(ita.actor, ita.id.did, { id: `${ita.id.did}#agent-card`, ...agentCard })
    assert.match(txHash, /^0x[0-9a-f]{64}$/)
    const result = await verifyServiceEndpoint(booking.actor, ita.id.did, agentCard)
    assert.equal(result.ok, true, result.reason)
    assert.equal(result.reason, REASON.serviceFound)
  })

  it('only resolves DIDs on the networks it is configured for', async () => {
    const elsewhere = ita.id.did.replace(':development:', ':mainnet:')
    await assert.rejects(resolveDidDocument(booking.actor, elsewhere), /unknownNetwork/)
    assert.equal((await verifyServiceEndpoint(booking.actor, elsewhere, agentCard)).reason, REASON.resolution)
  })
})
