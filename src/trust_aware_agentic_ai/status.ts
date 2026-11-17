/**
 * On-chain credential status (revocation).
 *
 * The `StatusList` contract keeps one bitstring per issuer, keyed by the
 * issuer's Ethereum address, which is also the controller address of its
 * did:ethr. A credential points to its bit with a `credentialStatus` entry:
 *
 * ```json
 * {
 *   "id": "eip155:31337:0x<contract>/0x<issuer>/3",
 *   "type": "EthereumStatusListEntry",
 *   "statusPurpose": "revocation",
 *   "statusListIndex": "3",
 *   "statusListContract": "eip155:31337:0x<contract>"
 * }
 * ```
 *
 * A verifier never trusts the issuer address written in the credential: it
 * derives the address from the issuer's resolved DID document, so only the
 * DID controller can flip the bit of a credential it issued.
 */
import type { CredentialStatusReference, DIDDocument, IIdentifier, VerifiableCredential } from '@veramo/core-types'
import { KmsEthereumSigner } from '@veramo/did-provider-ethr'
import { getEthereumAddress } from '@veramo/utils'
import { Contract, getAddress, type Provider } from 'ethers'
import type { Actor } from './actor.js'
import { controllerKey, ethereumAddressOf } from './identity.js'
import type { StatusChecker } from './verification.js'

export const STATUS_ENTRY_TYPE = 'EthereumStatusListEntry'
export const STATUS_PURPOSE_REVOCATION = 'revocation'

/** Human-readable ABI of `contracts/StatusList.sol`. */
export const STATUS_LIST_ABI = [
  'function setStatus(uint256 index, bool value)',
  'function getStatus(address issuer, uint256 index) view returns (bool)',
  'function getWord(address issuer, uint256 word) view returns (uint256)',
  'event StatusChanged(address indexed issuer, uint256 indexed index, bool value)',
]

export interface StatusListLocation {
  chainId: number
  /** Address of the deployed `StatusList` contract. */
  address: string
}

/** CAIP-10 style identifier of the contract: `eip155:<chainId>:<address>`. */
export function statusListId(location: StatusListLocation): string {
  return `eip155:${location.chainId}:${getAddress(location.address)}`
}

export function parseStatusListId(id: unknown): StatusListLocation {
  const match = typeof id === 'string' ? /^eip155:(\d+):(0x[0-9a-fA-F]{40})$/.exec(id) : null
  if (!match) throw new Error(`invalid statusListContract reference: ${String(id)}`)
  return { chainId: Number(match[1]), address: getAddress(match[2]!) }
}

/** Builds the `credentialStatus` entry for bit `index` of `issuerAddress`'s list. */
export function statusEntry(
  location: StatusListLocation,
  issuerAddress: string,
  index: number,
  statusPurpose = STATUS_PURPOSE_REVOCATION,
): CredentialStatusReference {
  if (!Number.isInteger(index) || index < 0) throw new Error(`invalid status list index: ${index}`)
  const contract = statusListId(location)
  return {
    id: `${contract}/${getAddress(issuerAddress)}/${index}`,
    type: STATUS_ENTRY_TYPE,
    statusPurpose,
    statusListIndex: String(index),
    statusListContract: contract,
  }
}

/** Reads one bit of an issuer's list. */
export async function readStatusBit(
  provider: Provider,
  location: StatusListLocation,
  issuerAddress: string,
  index: number,
): Promise<boolean> {
  const contract = new Contract(location.address, STATUS_LIST_ABI, provider)
  return Boolean(await contract.getStatus!(issuerAddress, index))
}

/**
 * The Ethereum address that controls a did:ethr, taken from its resolved
 * document (`blockchainAccountId` of the `#controller` verification method).
 */
export function controllerAddressOf(document: DIDDocument): string | undefined {
  const methods = document.verificationMethod ?? []
  const controller = methods.find((vm) => vm.id.endsWith('#controller')) ?? methods[0]
  if (!controller) return undefined
  const address = getEthereumAddress(controller)
  return address ? getAddress(address) : undefined
}

/**
 * The issuer side of the status list: allocates indexes for new credentials
 * and flips bits with transactions signed by the issuer's controller key,
 * through its key management system.
 */
export class StatusListIssuer {
  readonly issuerAddress: string
  private nextIndex: number

  constructor(
    private readonly actor: Actor,
    readonly identifier: IIdentifier,
    readonly location: StatusListLocation,
    options: { firstIndex?: number } = {},
  ) {
    this.issuerAddress = ethereumAddressOf(identifier)
    this.nextIndex = options.firstIndex ?? 1
  }

  /** Reserves the next free index of this issuer's list. */
  allocateIndex(): number {
    return this.nextIndex++
  }

  /** The `credentialStatus` entry to put in a credential with the given index. */
  entry(index: number): CredentialStatusReference {
    return statusEntry(this.location, this.issuerAddress, index)
  }

  /** Sets bit `index` (true = revoked). Returns the transaction hash once mined. */
  async setStatus(index: number, revoked: boolean): Promise<{ txHash: string; blockNumber: number }> {
    const signer = new KmsEthereumSigner(
      controllerKey(this.identifier),
      { agent: this.actor.agent },
      this.actor.provider,
    )
    const contract = new Contract(this.location.address, STATUS_LIST_ABI, signer)
    const tx = await contract.setStatus!(index, revoked)
    const receipt = await tx.wait()
    return { txHash: receipt.hash, blockNumber: receipt.blockNumber }
  }

  revoke(index: number): Promise<{ txHash: string; blockNumber: number }> {
    return this.setStatus(index, true)
  }

  isRevoked(index: number): Promise<boolean> {
    return readStatusBit(this.actor.provider, this.location, this.issuerAddress, index)
  }
}

/**
 * The verifier side: a {@link StatusChecker} that reads the bit referenced by
 * `credentialStatus` from the chain the verifier is connected to.
 */
export function createStatusChecker(options: { provider: Provider; chainId: number }): StatusChecker {
  return async (credential: VerifiableCredential, issuerDocument: DIDDocument) => {
    const status = credential.credentialStatus
    if (!status) return { revoked: false }
    if (status.type !== STATUS_ENTRY_TYPE) {
      throw new Error(`unsupported credentialStatus type: ${status.type}`)
    }
    const location = parseStatusListId(status.statusListContract)
    if (location.chainId !== options.chainId) {
      throw new Error(`status list is on chain ${location.chainId}, verifier is connected to chain ${options.chainId}`)
    }
    const index = Number(status.statusListIndex)
    if (!Number.isInteger(index) || index < 0) {
      throw new Error(`invalid statusListIndex: ${status.statusListIndex}`)
    }
    const issuerAddress = controllerAddressOf(issuerDocument)
    if (!issuerAddress) throw new Error(`issuer document ${issuerDocument.id} has no Ethereum address`)
    const revoked = await readStatusBit(options.provider, location, issuerAddress, index)
    return {
      revoked,
      details: { statusListContract: status.statusListContract, statusListIndex: index, issuerAddress },
    }
  }
}
