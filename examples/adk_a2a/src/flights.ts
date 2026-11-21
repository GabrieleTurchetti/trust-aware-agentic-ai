/**
 * Mock flight search: plausible but fake data, no A2A and no LLM involved.
 *
 * The airlines serve a few Italian cities. A fare grows with the great-circle
 * distance between the airports, so the same search always returns the same
 * offers, and every airline prices the same route differently.
 */
import { z } from 'zod'

/** The skill that the airlines advertise in their Agent Cards and that Booking looks for. */
export const FLIGHT_BOOKING_SKILL = 'flight-booking'

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected a date as YYYY-MM-DD')

/** A flight search, as Booking sends it to the airlines (JSON in a text part) and as its tool receives it. */
export const flightSearchSchema = z.object({
  origin: z.string().min(1).describe('City of departure, in English, e.g. "Rome"'),
  destination: z.string().min(1).describe('City of arrival, in English, e.g. "Milan"'),
  departureDate: isoDate.describe('Date of the outbound flight, as YYYY-MM-DD'),
  returnDate: isoDate.optional().describe('Date of the return flight, as YYYY-MM-DD; omit it for a one-way trip'),
  passengers: z.number().int().min(1).max(9).optional().describe('Number of passengers, 1 if not given'),
})

export type FlightSearch = z.infer<typeof flightSearchSchema>

export interface Flight {
  number: string
  from: string
  to: string
  /** Local date and time, e.g. `2026-11-12T07:00`. */
  departure: string
}

export interface FlightOffer {
  airline: string
  /** Outbound flight, then the return flight if any. */
  flights: Flight[]
  passengers: number
  /** Total price for all passengers. */
  price: number
  currency: 'EUR'
}

/** What an airline answers to a search. */
export interface SearchResult {
  airline: string
  offers: FlightOffer[]
  /** Why there are no offers, when there are none. */
  note?: string
}

/** One daily rotation: an outbound and a return flight, with their departure times. */
export interface Rotation {
  outbound: { number: string; time: string }
  inbound: { number: string; time: string }
  /** Added to the fare of each passenger, e.g. for more convenient times. */
  premium: number
}

/** How an airline prices and schedules its flights. */
export interface Timetable {
  airline: string
  /** One-way fare per passenger: `baseFare + perKm * distance`. */
  baseFare: number
  perKm: number
  rotations: Rotation[]
}

interface City {
  name: string
  airport: string
  lat: number
  lon: number
}

const CITIES: City[] = [
  { name: 'Rome', airport: 'FCO', lat: 41.8003, lon: 12.2389 },
  { name: 'Milan', airport: 'LIN', lat: 45.4451, lon: 9.2767 },
  { name: 'Naples', airport: 'NAP', lat: 40.886, lon: 14.2908 },
  { name: 'Turin', airport: 'TRN', lat: 45.2008, lon: 7.6497 },
  { name: 'Venice', airport: 'VCE', lat: 45.5053, lon: 12.3519 },
  { name: 'Bari', airport: 'BRI', lat: 41.1389, lon: 16.7606 },
  { name: 'Palermo', airport: 'PMO', lat: 38.176, lon: 13.091 },
  { name: 'Catania', airport: 'CTA', lat: 37.4668, lon: 15.0664 },
]

/** Italian names, so that "Roma–Milano" works too. */
const ALIASES: Record<string, string> = {
  roma: 'Rome',
  milano: 'Milan',
  napoli: 'Naples',
  torino: 'Turin',
  venezia: 'Venice',
}

/** The cities the airlines serve, by English name. */
export const SERVED_CITIES: readonly string[] = CITIES.map((c) => c.name)

/** Finds a served city by English or Italian name, ignoring case; `undefined` if not served. */
export function findCity(name: string): City | undefined {
  const key = name.trim().toLowerCase()
  const canonical = ALIASES[key] ?? key
  return CITIES.find((c) => c.name.toLowerCase() === canonical.toLowerCase() || c.airport.toLowerCase() === key)
}

/** Great-circle distance in km (haversine formula). */
export function distanceKm(a: City, b: City): number {
  const rad = (deg: number) => (deg * Math.PI) / 180
  const dLat = rad(b.lat - a.lat)
  const dLon = rad(b.lon - a.lon)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2
  return 2 * 6371 * Math.asin(Math.sqrt(h))
}

const roundTo5 = (amount: number) => Math.round(amount / 5) * 5

/** The airline's offers for the search: the same search always gets the same offers, cheapest first. */
export function searchFlights(timetable: Timetable, search: FlightSearch): SearchResult {
  const { airline } = timetable
  const from = findCity(search.origin)
  const to = findCity(search.destination)
  if (!from || !to) {
    const unknown = !from ? search.origin : search.destination
    return { airline, offers: [], note: `no flights: ${airline} does not serve "${unknown}"` }
  }
  if (from === to) {
    return { airline, offers: [], note: 'no flights: origin and destination are the same city' }
  }
  if (search.returnDate !== undefined && search.returnDate < search.departureDate) {
    return { airline, offers: [], note: 'no flights: the return date is before the departure date' }
  }
  const passengers = search.passengers ?? 1
  const legs = search.returnDate === undefined ? 1 : 2
  const fare = roundTo5(legs * (timetable.baseFare + timetable.perKm * distanceKm(from, to)))
  const offers = timetable.rotations.map((rotation): FlightOffer => {
    const flights: Flight[] = [
      {
        number: rotation.outbound.number,
        from: from.airport,
        to: to.airport,
        departure: `${search.departureDate}T${rotation.outbound.time}`,
      },
    ]
    if (search.returnDate !== undefined) {
      flights.push({
        number: rotation.inbound.number,
        from: to.airport,
        to: from.airport,
        departure: `${search.returnDate}T${rotation.inbound.time}`,
      })
    }
    return { airline, flights, passengers, price: (fare + rotation.premium) * passengers, currency: 'EUR' }
  })
  return { airline, offers: offers.sort((a, b) => a.price - b.price) }
}

/** A short readable form of an offer, e.g. `AZ2010 FCO→LIN 2026-11-12 07:00, AZ2035 LIN→FCO 2026-11-13 19:00: €240`. */
export function formatOffer(offer: FlightOffer): string {
  const flights = offer.flights.map((f) => `${f.number} ${f.from}→${f.to} ${f.departure.replace('T', ' ')}`).join(', ')
  return `${flights}: €${offer.price}`
}
