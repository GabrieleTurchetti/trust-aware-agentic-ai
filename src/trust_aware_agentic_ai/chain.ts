/**
 * Local Ethereum chain: lifecycle of the Hardhat node, contract deployment and
 * funding. Examples and tests call {@link setupLocalChain} and `stop()`
 * themselves, so a single command is enough and no separate terminal is needed.
 */
import { ContractFactory, JsonRpcProvider, parseEther, Wallet } from 'ethers'
import { EthereumDIDRegistry } from 'ethr-did-registry'
import { type ChildProcess, spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** Root of the repository: the folder with package.json, hardhat.config.ts and the compiled artifacts. */
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

export const HARDHAT_CHAIN_ID = 31337
/** Network name used in DIDs: `did:ethr:development:0x...`. */
export const NETWORK_NAME = 'development'

/**
 * Hardhat's default development account #0, the deployer. Its key is derived
 * from a public mnemonic and only ever holds value on the local chain.
 */
export const HARDHAT_ACCOUNT_0 = {
  address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
  privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
} as const

export interface LocalChain {
  rpcUrl: string
  chainId: number
  port: number
  stop(): Promise<void>
}

export interface StartChainOptions {
  /** TCP port of the JSON-RPC server (default 8545). */
  port?: number
  /** How long to wait for the node to answer (default 60 s). */
  timeoutMs?: number
}

export function createProvider(rpcUrl: string, chainId = HARDHAT_CHAIN_ID): JsonRpcProvider {
  // cacheTimeout -1: the local chain mines instantly, so cached nonces and balances would be stale.
  const provider = new JsonRpcProvider(rpcUrl, { chainId, name: NETWORK_NAME }, { staticNetwork: true, cacheTimeout: -1 })
  provider.pollingInterval = 200
  return provider
}

async function rpcChainId(rpcUrl: string): Promise<number | undefined> {
  try {
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
      signal: AbortSignal.timeout(1000),
    })
    const body = (await response.json()) as { result?: string }
    return body.result ? Number(body.result) : undefined
  } catch {
    return undefined
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Starts `hardhat node` as a child process and resolves once it answers JSON-RPC calls. */
export async function startLocalChain(options: StartChainOptions = {}): Promise<LocalChain> {
  const port = options.port ?? 8545
  const timeoutMs = options.timeoutMs ?? 60_000
  const rpcUrl = `http://127.0.0.1:${port}`

  if ((await rpcChainId(rpcUrl)) !== undefined) {
    throw new Error(`port ${port} is already in use: is another chain running?`)
  }
  const cli = path.join(PROJECT_ROOT, 'node_modules', 'hardhat', 'dist', 'src', 'cli.js')
  if (!existsSync(cli)) throw new Error(`hardhat is not installed (${cli} not found): run npm install at the repository root`)

  const child: ChildProcess = spawn(process.execPath, [cli, 'node', '--port', String(port)], {
    cwd: PROJECT_ROOT,
    env: { ...process.env, HARDHAT_DISABLE_TELEMETRY_PROMPT: 'true' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const output: string[] = []
  const keepTail = (chunk: Buffer) => {
    output.push(chunk.toString())
    if (output.length > 50) output.shift()
  }
  child.stdout?.on('data', keepTail)
  child.stderr?.on('data', keepTail)
  let exited = false
  child.once('exit', () => {
    exited = true
  })
  const killOnExit = () => {
    if (!exited) child.kill('SIGKILL')
  }
  process.once('exit', killOnExit)

  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (exited) {
      process.off('exit', killOnExit)
      throw new Error(`hardhat node exited during startup:\n${output.join('')}`)
    }
    const chainId = await rpcChainId(rpcUrl)
    if (chainId !== undefined) {
      return {
        rpcUrl,
        chainId,
        port,
        async stop() {
          process.off('exit', killOnExit)
          if (exited) return
          const finished = new Promise<void>((resolve) => child.once('exit', () => resolve()))
          child.kill('SIGTERM')
          await Promise.race([finished, sleep(5000)])
          if (!exited) {
            child.kill('SIGKILL')
            await finished
          }
        },
      }
    }
    await sleep(150)
  }
  child.kill('SIGKILL')
  process.off('exit', killOnExit)
  throw new Error(`hardhat node did not answer within ${timeoutMs} ms:\n${output.join('')}`)
}

/** A wallet for Hardhat's default account #0, connected to the chain. */
export function hardhatWallet(rpcUrl: string): Wallet {
  return new Wallet(HARDHAT_ACCOUNT_0.privateKey, createProvider(rpcUrl))
}

/** Reads a Hardhat artifact produced by `npm run compile`. */
export function readArtifact(contractName: string): { abi: unknown[]; bytecode: string } {
  const file = path.join(PROJECT_ROOT, 'artifacts', 'contracts', `${contractName}.sol`, `${contractName}.json`)
  if (!existsSync(file)) {
    throw new Error(`artifact ${file} not found: run "npm run compile" at the repository root first`)
  }
  const artifact = JSON.parse(readFileSync(file, 'utf8')) as { abi: unknown[]; bytecode: string }
  return { abi: artifact.abi, bytecode: artifact.bytecode }
}

/** Deploys the ERC-1056 registry from the published `ethr-did-registry` package. */
export async function deployDidRegistry(deployer: Wallet): Promise<string> {
  const factory = new ContractFactory(EthereumDIDRegistry.abi, EthereumDIDRegistry.bytecode, deployer)
  const contract = await factory.deploy()
  await contract.waitForDeployment()
  return contract.getAddress()
}

/** Deploys `contracts/StatusList.sol`. */
export async function deployStatusList(deployer: Wallet): Promise<string> {
  const { abi, bytecode } = readArtifact('StatusList')
  const factory = new ContractFactory(abi as never, bytecode, deployer)
  const contract = await factory.deploy()
  await contract.waitForDeployment()
  return contract.getAddress()
}

/** Sends ETH from the deployer to an actor's address so it can pay for its own transactions. */
export async function fundAddress(deployer: Wallet, address: string, amountEth = '1'): Promise<string> {
  const tx = await deployer.sendTransaction({ to: address, value: parseEther(amountEth) })
  await tx.wait()
  return tx.hash
}

export interface ChainSetup {
  chain: LocalChain
  deployer: Wallet
  /** ERC-1056 registry address. */
  registry: string
  /** StatusList contract address. */
  statusList: string
  /** Convenience: the network configuration actors need for did:ethr. */
  network: { name: string; chainId: number; rpcUrl: string; registry: string }
  stop(): Promise<void>
}

/** Starts the chain and deploys both contracts with Hardhat account #0. */
export async function setupLocalChain(options: StartChainOptions = {}): Promise<ChainSetup> {
  const chain = await startLocalChain(options)
  try {
    const deployer = hardhatWallet(chain.rpcUrl)
    const registry = await deployDidRegistry(deployer)
    const statusList = await deployStatusList(deployer)
    return {
      chain,
      deployer,
      registry,
      statusList,
      network: { name: NETWORK_NAME, chainId: chain.chainId, rpcUrl: chain.rpcUrl, registry },
      async stop() {
        deployer.provider?.destroy()
        await chain.stop()
      },
    }
  } catch (e) {
    await chain.stop()
    throw e
  }
}
