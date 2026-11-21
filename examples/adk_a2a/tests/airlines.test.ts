/**
 * The airline agents over A2A, each in its own process: their Agent Cards,
 * the selection by skill, and their answers to Booking's requests.
 */
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { AIRLINES } from '../src/airline.js'
import { askAirline } from '../src/delegation.js'
import { type DiscoveredAgent, discoverAgents, selectBySkill } from '../src/discovery.js'
import { FLIGHT_BOOKING_SKILL, formatOffer } from '../src/flights.js'
import { type AirlineProcess, startAirlines, stopAirlines } from '../src/launcher.js'
import { SCENARIO_SEARCH } from './helpers.js'

/** Ports different from the demo's (9001, 9002) and from booking.test.ts. */
const PORTS = { ita: 9101, airlineB: 9102 }
/** Nothing listens here. */
const UNREACHABLE = 'http://localhost:9109'

describe('airline agents over A2A', { timeout: 60_000 }, () => {
  let airlines: AirlineProcess[] = []
  let ita: DiscoveredAgent
  let airlineB: DiscoveredAgent

  before(async () => {
    airlines = await startAirlines([
      { profile: AIRLINES.ita, port: PORTS.ita },
      { profile: AIRLINES['airline-b'], port: PORTS.airlineB },
    ])
    const discovery = await discoverAgents(airlines.map((a) => a.url))
    ;[ita, airlineB] = discovery.agents as [DiscoveredAgent, DiscoveredAgent]
  })

  after(async () => {
    await stopAirlines(airlines)
  })

  it('discovery reads the Agent Cards and skips unreachable agents', async () => {
    const discovery = await discoverAgents([...airlines.map((a) => a.url), UNREACHABLE])
    assert.deepEqual(
      discovery.agents.map((a) => [a.card.name, a.card.url, a.card.skills.map((s) => s.id)]),
      [
        ['ITA Airways', `http://localhost:${PORTS.ita}/jsonrpc`, [FLIGHT_BOOKING_SKILL]],
        ['Airline B', `http://localhost:${PORTS.airlineB}/jsonrpc`, [FLIGHT_BOOKING_SKILL]],
      ],
    )
    assert.deepEqual(
      discovery.unreachable.map((u) => u.url),
      [UNREACHABLE],
    )
  })

  it('selection keeps the agents that advertise the skill', () => {
    const hotel: DiscoveredAgent = {
      url: 'http://localhost:9110',
      card: { ...ita.card, name: 'Grand Hotel', skills: [{ id: 'hotel-booking', name: 'Hotel', description: 'Rooms', tags: [] }] },
    }
    assert.deepEqual(
      selectBySkill([ita, hotel, airlineB], FLIGHT_BOOKING_SKILL).map((a) => a.card.name),
      ['ITA Airways', 'Airline B'],
    )
    assert.deepEqual(selectBySkill([ita, airlineB], 'hotel-booking'), [])
  })

  it('each airline answers a flight search over A2A with its offers, cheapest first', async () => {
    const [itaReply, airlineBReply] = await Promise.all([askAirline(ita, SCENARIO_SEARCH), askAirline(airlineB, SCENARIO_SEARCH)])
    assert.equal(itaReply.error, undefined)
    assert.deepEqual(itaReply.offers.map(formatOffer), [
      'AZ2010 FCO→LIN 2026-11-12 07:00, AZ2035 LIN→FCO 2026-11-13 19:00: €240',
      'AZ2022 FCO→LIN 2026-11-12 13:00, AZ2061 LIN→FCO 2026-11-13 21:00: €265',
    ])
    assert.equal(airlineBReply.error, undefined)
    assert.deepEqual(airlineBReply.offers.map(formatOffer), [
      'XB301 FCO→LIN 2026-11-12 06:30, XB318 LIN→FCO 2026-11-13 20:30: €210',
      'XB305 FCO→LIN 2026-11-12 10:15, XB322 LIN→FCO 2026-11-13 22:45: €255',
    ])
  })

  it('an airline says why it has no offers', async () => {
    const reply = await askAirline(ita, { ...SCENARIO_SEARCH, destination: 'Florence' })
    assert.equal(reply.error, undefined)
    assert.deepEqual(reply.offers, [])
    assert.equal(reply.note, 'no flights: ITA Airways does not serve "Florence"')
  })

  it('an invalid search fails the A2A task with the error of the tool', async () => {
    const reply = await askAirline(ita, { ...SCENARIO_SEARCH, departureDate: '12/11/2026' })
    assert.deepEqual(reply.offers, [])
    assert.match(reply.error ?? '', /^Agent run failed: Error in tool 'search_flights'.*expected a date as YYYY-MM-DD/s)
  })
})
