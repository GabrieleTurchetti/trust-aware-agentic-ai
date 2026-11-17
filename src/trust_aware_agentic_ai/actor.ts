/**
 * One Veramo agent per actor.
 *
 * Every actor (issuer, holder or verifier) gets its own agent with its own
 * SQLite database, key store and encrypted private key store.
 * Nothing is shared between actors: the only things that travel between them
 * are DIDs, credentials, presentations and nonces.
 */
import { createAgent, type TAgent } from '@veramo/core'
import type {
  ICredentialPlugin,
  IDataStore,
  IDataStoreORM,
  IDIDManager,
  IKeyManager,
  IResolver,
} from '@veramo/core-types'
import { CredentialProviderJWT } from '@veramo/credential-jwt'
import { CredentialPlugin } from '@veramo/credential-w3c'
import { DataStore, DataStoreORM, DIDStore, Entities, KeyStore, migrations, PrivateKeyStore } from '@veramo/data-store'
import { DIDManager } from '@veramo/did-manager'
import { EthrDIDProvider } from '@veramo/did-provider-ethr'
import { DIDResolverPlugin } from '@veramo/did-resolver'
import { KeyManager } from '@veramo/key-manager'
import { KeyManagementSystem, SecretBox } from '@veramo/kms-local'
import { Resolver } from 'did-resolver'
import { JsonRpcProvider } from 'ethers'
import { getResolver as ethrDidResolver } from 'ethr-did-resolver'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { DataSource } from 'typeorm'

type EthrResolverNetworks = Extract<Parameters<typeof ethrDidResolver>[0], { networks?: unknown }>['networks']
type EthrResolverNetwork = NonNullable<EthrResolverNetworks>[number]

export type TrustAgent = TAgent<
  IDIDManager & IKeyManager & IResolver & ICredentialPlugin & IDataStore & IDataStoreORM
>

/** A did:ethr network, i.e. a chain with an ERC-1056 registry deployed on it. */
export interface EthrNetwork {
  /** Human-readable name used in DIDs: `did:ethr:<name>:0x...`. */
  name: string
  chainId: number
  rpcUrl: string
  /** Address of the ERC-1056 `EthereumDIDRegistry` contract. */
  registry: string
}

export interface ActorOptions {
  /** Short name, also used for the database file name. */
  name: string
  /** Directory holding the actor's SQLite file. */
  dataDir: string
  /** The network on which the actor creates and resolves did:ethr identities. */
  ethr: EthrNetwork
  /** Delete a pre-existing database first (default: true). */
  fresh?: boolean
  /** Hex secret for the private key store; random when omitted. */
  secretKey?: string
}

export interface Actor {
  readonly name: string
  readonly agent: TrustAgent
  readonly dbFile: string
  readonly ethr: EthrNetwork
  /** The actor's own JSON-RPC connection to the chain. */
  readonly provider: JsonRpcProvider
  close(): Promise<void>
}

export const KMS_NAME = 'local'

export function ethrProviderName(networkName: string): string {
  return `did:ethr:${networkName}`
}

export async function createActor(options: ActorOptions): Promise<Actor> {
  const { name, dataDir, ethr, fresh = true } = options
  mkdirSync(dataDir, { recursive: true })
  const dbFile = join(dataDir, `${name}.sqlite`)
  if (fresh) {
    for (const suffix of ['', '-journal', '-wal', '-shm']) rmSync(dbFile + suffix, { force: true })
  }
  const secretKey = options.secretKey ?? (await SecretBox.createSecretKey())

  const db = await new DataSource({
    type: 'better-sqlite3',
    database: dbFile,
    synchronize: false,
    migrationsRun: true,
    migrations,
    entities: Entities,
    logging: false,
  }).initialize()

  // cacheTimeout -1: the local chain mines instantly, so cached nonces and balances would be stale.
  const provider = new JsonRpcProvider(
    ethr.rpcUrl,
    { chainId: ethr.chainId, name: ethr.name },
    { staticNetwork: true, cacheTimeout: -1 },
  )
  provider.pollingInterval = 200
  const network = { ...ethr, provider }
  const didProvider = ethrProviderName(ethr.name)

  // ethr-did-resolver ships CommonJS typings that refer to the CommonJS build of
  // ethers, while this module imports the ESM build: same package, same runtime
  // objects, but TypeScript sees two different `Provider` classes.
  const resolverNetwork = network as unknown as EthrResolverNetwork

  const agent: TrustAgent = createAgent<
    IDIDManager & IKeyManager & IResolver & ICredentialPlugin & IDataStore & IDataStoreORM
  >({
    plugins: [
      new KeyManager({
        store: new KeyStore(db),
        kms: { [KMS_NAME]: new KeyManagementSystem(new PrivateKeyStore(db, new SecretBox(secretKey))) },
      }),
      new DIDManager({
        store: new DIDStore(db),
        defaultProvider: didProvider,
        providers: { [didProvider]: new EthrDIDProvider({ defaultKms: KMS_NAME, networks: [network] }) },
      }),
      new DIDResolverPlugin({ resolver: new Resolver(ethrDidResolver({ networks: [resolverNetwork] })) }),
      new CredentialPlugin([new CredentialProviderJWT()]),
      new DataStore(db),
      new DataStoreORM(db),
    ],
  })

  return {
    name,
    agent,
    dbFile,
    ethr,
    provider,
    async close() {
      provider.destroy()
      await db.destroy()
    },
  }
}
