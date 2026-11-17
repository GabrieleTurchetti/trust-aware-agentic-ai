/**
 * The business trip scenario, credential layer only, without A2A.
 *
 * 1. Setup: a local Hardhat chain with the ERC-1056 registry and the StatusList
 *    contract, did:ethr identities for the CAA, ITA, Airline B and Booking,
 *    ITA's Agent Card service endpoint, and a `flight-booking` credential with
 *    its own status list index for each airline.
 * 2. Booking challenges both airlines: both accepted, replayed presentations rejected.
 * 3. The CAA revokes Airline B's credential on-chain.
 * 4. Booking challenges both airlines again: ITA accepted, Airline B rejected.
 *
 * The reusable logic lives in the trust-aware-agentic-ai library, at the
 * repository root; this script only tells the story.
 * The local chain is started and stopped here, so `npm run demo` is enough.
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  type Actor,
  addServiceEndpoint,
  createActor,
  createIdentity,
  createPresentation,
  createStatusChecker,
  ethereumAddressOf,
  EventLog,
  fundAddress,
  type IIdentifier,
  issueSkillCredential,
  randomNonce,
  setupLocalChain,
  StatusListIssuer,
  type VerifiableCredential,
  verifyPresentation,
  type VerifyPresentationOptions,
  verifyServiceEndpoint,
} from 'trust-aware-agentic-ai'

/** Root of this example: its data and event logs are written here. */
const EXAMPLE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DATA_DIR = path.join(EXAMPLE_ROOT, 'data')
const EVENTS_DIR = path.join(EXAMPLE_ROOT, 'events')
const FLIGHT_SKILL = 'flight-booking'
/** Where ITA's Agent Card will be served in the A2A examples. */
const ITA_AGENT_CARD = { type: 'AgentCard', serviceEndpoint: 'http://localhost:9001/.well-known/agent-card.json' }

interface Airline {
  name: string
  actor: Actor
  id: IIdentifier
  credential: VerifiableCredential
}

function heading(title: string): void {
  console.log(`\n=== ${title} ===\n`)
}

function show(label: string, value: unknown): void {
  console.log(`${label}: ${typeof value === 'string' ? value : JSON.stringify(value, null, 2)}`)
}

/** A credential with its JWT shortened, for printing. */
function brief(credential: VerifiableCredential): VerifiableCredential {
  const jwt: string = credential.proof.jwt
  return { ...credential, proof: { ...credential.proof, jwt: `${jwt.slice(0, 48)}…(${jwt.length} chars)` } }
}

async function run(log: EventLog): Promise<void> {
  heading('Setup')
  const setup = await setupLocalChain()
  const actors: Actor[] = []
  try {
    const ethr = setup.network
    show('Chain', `${ethr.rpcUrl} (chainId ${ethr.chainId})`)
    show('ERC-1056 registry', setup.registry)
    show('StatusList contract', setup.statusList)

    // Every actor has its own Veramo agent, database and keys.
    const [caa, ita, airlineB, booking] = await Promise.all(
      ['caa', 'ita', 'airline-b', 'booking'].map((name) => createActor({ name, dataDir: DATA_DIR, ethr })),
    )
    actors.push(caa!, ita!, airlineB!, booking!)
    const caaId = await createIdentity(caa!, { alias: 'caa' })
    const itaId = await createIdentity(ita!, { alias: 'ita' })
    const airlineBId = await createIdentity(airlineB!, { alias: 'airline-b' })
    const bookingId = await createIdentity(booking!, { alias: 'booking' })
    show('CAA', caaId.did)
    show('ITA', itaId.did)
    show('Airline B', airlineBId.did)
    show('Booking', bookingId.did)

    // ITA publishes the location of its Agent Card in its DID document, and
    // the CAA will publish revocations: both pay for their own transactions.
    await fundAddress(setup.deployer, ethereumAddressOf(itaId))
    await fundAddress(setup.deployer, ethereumAddressOf(caaId))
    const serviceTx = await addServiceEndpoint(ita!, itaId.did, { id: `${itaId.did}#agent-card`, ...ITA_AGENT_CARD })
    show('Service endpoint transaction', serviceTx)
    log.record({
      phase: 'setup',
      check: 'service endpoint in DID document (ITA)',
      verifier: bookingId.did,
      holder: itaId.did,
      expected: 'accepted',
      result: await verifyServiceEndpoint(booking!, itaId.did, ITA_AGENT_CARD),
    })

    // The CAA issues flight-booking credentials, each with its own status list index.
    const statusList = new StatusListIssuer(caa!, caaId, { chainId: ethr.chainId, address: setup.statusList })
    const issue = async (actor: Actor, id: IIdentifier, name: string, licence: string): Promise<Airline> => {
      const credential = await issueSkillCredential(caa!, {
        issuer: caaId.did,
        subject: id.did,
        skill: FLIGHT_SKILL,
        licence,
        credentialStatus: statusList.entry(statusList.allocateIndex()),
      })
      await actor.agent.dataStoreSaveVerifiableCredential({ verifiableCredential: credential })
      return { name, actor, id, credential }
    }
    const airlines = [
      await issue(ita!, itaId, 'ITA', 'Air Operator Certificate IT-001'),
      await issue(airlineB!, airlineBId, 'Airline B', 'Air Operator Certificate IT-002'),
    ]
    show('Credential issued by the CAA to Airline B', brief(airlines[1]!.credential))

    // Booking trusts the CAA for flight-booking and reads status bits from the chain.
    const policy: Omit<VerifyPresentationOptions, 'challenge'> = {
      skill: FLIGHT_SKILL,
      trustedIssuers: [caaId.did],
      statusChecker: createStatusChecker({ provider: booking!.provider, chainId: ethr.chainId }),
    }

    /** One challenge-response round: Booking sends a nonce, the airline answers with a presentation. */
    const challenge = async (airline: Airline) => {
      const nonce = randomNonce()
      const presentation = await createPresentation(airline.actor, {
        holder: airline.id.did,
        credentials: [airline.credential],
        challenge: nonce,
        verifier: bookingId.did,
      })
      return { nonce, presentation }
    }

    heading('Booking verifies the airlines')
    for (const airline of airlines) {
      const { nonce, presentation } = await challenge(airline)
      log.record({
        phase: 'before revocation',
        check: `valid presentation (${airline.name})`,
        verifier: bookingId.did,
        holder: airline.id.did,
        expected: 'accepted',
        result: await verifyPresentation(booking!, presentation, { challenge: nonce, ...policy }),
      })
      // The same presentation sent again in answer to a new nonce: a replay.
      log.record({
        phase: 'before revocation',
        check: `wrong challenge (${airline.name})`,
        verifier: bookingId.did,
        holder: airline.id.did,
        expected: 'rejected',
        result: await verifyPresentation(booking!, presentation, { challenge: randomNonce(), ...policy }),
      })
    }

    heading('Revocation')
    const airlineBIndex = Number(airlines[1]!.credential.credentialStatus!.statusListIndex)
    const { txHash } = await statusList.revoke(airlineBIndex)
    show('Revocation transaction', txHash)
    const bits: Record<string, boolean> = {}
    for (const airline of airlines) {
      const index = Number(airline.credential.credentialStatus!.statusListIndex)
      bits[`${airline.name} (index ${index})`] = await statusList.isRevoked(index)
    }
    show('CAA status bits', bits)

    heading('Booking verifies the airlines after the revocation')
    for (const airline of airlines) {
      const { nonce, presentation } = await challenge(airline)
      log.record({
        phase: 'after revocation',
        check: `valid presentation (${airline.name})`,
        verifier: bookingId.did,
        holder: airline.id.did,
        expected: airline.name === 'Airline B' ? 'rejected' : 'accepted',
        result: await verifyPresentation(booking!, presentation, { challenge: nonce, ...policy }),
      })
    }
  } finally {
    await Promise.all(actors.map((actor) => actor.close()))
    await setup.stop()
  }
}

const log = new EventLog({ dir: EVENTS_DIR, name: 'demo' })
let crashed = false
try {
  await run(log)
} catch (e) {
  crashed = true
  console.error(e)
}
log.printSummary()
process.exitCode = crashed || log.summary().failed > 0 ? 1 : 0
