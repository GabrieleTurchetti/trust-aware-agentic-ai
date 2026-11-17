import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { parseEther, Wallet } from 'ethers'
import {
  type ChainSetup,
  fundAddress,
  HARDHAT_ACCOUNT_0,
  HARDHAT_CHAIN_ID,
  NETWORK_NAME,
  readArtifact,
  setupLocalChain,
  startLocalChain,
} from 'trust-aware-agentic-ai'
import { TEST_PORTS } from './helpers.js'

const RPC_URL = `http://127.0.0.1:${TEST_PORTS.chain}`

/** The chain id answered at the URL, or undefined when nothing answers. */
async function chainIdAt(rpcUrl: string): Promise<number | undefined> {
  try {
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
    })
    return Number(((await response.json()) as { result: string }).result)
  } catch {
    return undefined
  }
}

describe('local chain', { timeout: 120_000 }, () => {
  let setup: ChainSetup | undefined

  before(async () => {
    setup = await setupLocalChain({ port: TEST_PORTS.chain })
  })

  after(async () => {
    await setup?.stop()
  })

  it('runs a Hardhat node with the development network settings', async () => {
    assert.equal(await chainIdAt(RPC_URL), HARDHAT_CHAIN_ID)
    assert.deepEqual(setup!.network, {
      name: NETWORK_NAME,
      chainId: HARDHAT_CHAIN_ID,
      rpcUrl: RPC_URL,
      registry: setup!.registry,
    })
  })

  it('deploys the DID registry and the status list from account #0', async () => {
    const provider = setup!.deployer.provider!
    assert.equal(setup!.deployer.address, HARDHAT_ACCOUNT_0.address)
    assert.notEqual(await provider.getCode(setup!.registry), '0x')
    assert.notEqual(await provider.getCode(setup!.statusList), '0x')
    assert.notEqual(setup!.registry, setup!.statusList)
  })

  it('funds an address from the deployer', async () => {
    const { address } = Wallet.createRandom()
    await fundAddress(setup!.deployer, address, '0.5')
    assert.equal(await setup!.deployer.provider!.getBalance(address), parseEther('0.5'))
  })

  it('refuses to start a second node on a port in use', async () => {
    await assert.rejects(startLocalChain({ port: TEST_PORTS.chain }), /already in use/)
  })

  it('stops the node and frees the port', async () => {
    await setup!.stop()
    setup = undefined
    assert.equal(await chainIdAt(RPC_URL), undefined)
  })
})

describe('contract artifacts', () => {
  it('reads the compiled StatusList contract', () => {
    const { abi, bytecode } = readArtifact('StatusList')
    assert.ok(abi.length > 0)
    assert.match(bytecode, /^0x[0-9a-f]+$/)
  })

  it('explains how to build a missing artifact', () => {
    assert.throws(() => readArtifact('Missing'), /npm run compile/)
  })
})
