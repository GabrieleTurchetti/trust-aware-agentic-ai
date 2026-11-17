import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { after, describe, it } from 'node:test'
import { type CheckResult, EventLog, formatEvent } from 'trust-aware-agentic-ai'
import { tempDir } from './helpers.js'

const result = (ok: boolean, reason: string, details?: Record<string, unknown>): CheckResult => ({
  ok,
  reason,
  durationMs: 12.345,
  ...(details ? { details } : {}),
})
const check = { phase: 'unit', verifier: 'did:example:booking', holder: 'did:example:ita' }

describe('event log', () => {
  const data = tempDir('events')
  after(() => data.cleanup())

  it('appends one JSON line per check to a file in a directory it creates', () => {
    const log = new EventLog({ dir: path.join(data.dir, 'nested'), name: 'unit', runId: 'run42', quiet: true })
    assert.match(path.basename(log.file), /^unit-\d{4}-\d{2}-\d{2}T[\d-]+Z-run42\.jsonl$/)
    log.record({ ...check, check: 'valid presentation', expected: 'accepted', result: result(true, 'accepted') })
    log.record({ ...check, check: 'revoked', result: result(false, 'revoked credential', { statusListIndex: 2 }) })

    const lines = readFileSync(log.file, 'utf8').trimEnd().split('\n').map((line) => JSON.parse(line))
    assert.equal(lines.length, 2)
    assert.equal(lines[0].runId, 'run42')
    assert.equal(lines[0].holder, 'did:example:ita')
    assert.equal(lines[0].pass, true)
    assert.equal(lines[1].reason, 'revoked credential')
    assert.equal('pass' in lines[1], false)
    assert.deepEqual(lines[1].details, { statusListIndex: 2 })
  })

  it('counts false accepts and false rejects as unexpected', () => {
    const log = new EventLog({ dir: data.dir, name: 'unit', quiet: true })
    log.record({ ...check, check: 'as expected', expected: 'accepted', result: result(true, 'accepted') })
    log.record({ ...check, check: 'false accept', expected: 'rejected', result: result(true, 'accepted') })
    log.record({ ...check, check: 'false reject', expected: 'accepted', result: result(false, 'revoked credential') })
    log.record({ ...check, check: 'no expectation', result: result(false, 'challenge mismatch') })
    assert.deepEqual(log.all.map((event) => event.pass), [true, false, false, undefined])
    assert.deepEqual(log.summary(), { total: 4, passed: 1, failed: 2 })
  })

  it('prints a check as one readable line', () => {
    const log = new EventLog({ dir: data.dir, name: 'unit', quiet: true })
    const accepted = log.record({ ...check, check: 'valid presentation', expected: 'accepted', result: result(true, 'accepted') })
    const rejected = log.record({ ...check, check: 'replay', expected: 'accepted', result: result(false, 'challenge mismatch') })
    assert.match(formatEvent(accepted), /✔ valid presentation +ACCEPTED accepted +12\.3 ms +\(expected accepted\)/)
    assert.match(formatEvent(rejected), /✘ replay +REJECTED challenge mismatch/)
  })
})
