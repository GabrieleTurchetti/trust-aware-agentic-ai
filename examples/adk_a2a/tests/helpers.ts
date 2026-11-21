/**
 * Shared fixtures for the tests.
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { FlightSearch } from '../src/flights.js'

/** Root of this example. */
export const EXAMPLE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** The flight of the scenario: return Rome–Milan, 12–13 November 2026. */
export const SCENARIO_SEARCH: FlightSearch = {
  origin: 'Rome',
  destination: 'Milan',
  departureDate: '2026-11-12',
  returnDate: '2026-11-13',
}
