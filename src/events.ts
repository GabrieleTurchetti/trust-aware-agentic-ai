/**
 * Structured results and the JSONL event log.
 *
 * Every check performed by the trust layer returns a {@link CheckResult}
 * (never a bare boolean), and every check run by a scenario or a test is
 * appended as one JSON line to a file under `events/`, so that runs can be
 * evaluated later (acceptance rates, latencies, false positives...).
 */
import { randomBytes } from 'node:crypto'
import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

export type Outcome = 'accepted' | 'rejected'

/** Outcome of a verification step. */
export interface CheckResult {
  /** `true` when the check passed, e.g. the presentation is accepted. */
  ok: boolean
  /** Short, stable reason such as `accepted`, `challenge mismatch`, `revoked credential`. */
  reason: string
  /** Wall-clock time spent in the check, in milliseconds. */
  durationMs: number
  /** Extra data for debugging and evaluation (DIDs, indexes, tx hashes, raw errors). */
  details?: Record<string, unknown>
}

/** One line of the JSONL event file. */
export interface CheckEvent extends CheckResult {
  ts: string
  runId: string
  /** Part of the scenario the check belongs to, e.g. `setup` or `after revocation`. */
  phase: string
  check: string
  verifier: string
  holder?: string
  /** What the scenario expected, so an evaluator can count false accepts and false rejects. */
  expected?: Outcome
  /** `ok` agrees with `expected` (absent when the scenario had no expectation). */
  pass?: boolean
}

export interface RecordInput {
  phase: string
  check: string
  verifier: string
  holder?: string
  expected?: Outcome
  result: CheckResult
}

export interface EventLogOptions {
  /** Directory of the JSONL file, created if missing. */
  dir: string
  /** File name prefix, e.g. `demo` or `test`. */
  name: string
  runId?: string
  /** Do not echo events to the console. */
  quiet?: boolean
}

export class EventLog {
  readonly file: string
  readonly runId: string
  private readonly quiet: boolean
  private readonly events: CheckEvent[] = []

  constructor(options: EventLogOptions) {
    this.runId = options.runId ?? randomBytes(4).toString('hex')
    this.quiet = options.quiet ?? false
    mkdirSync(options.dir, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    this.file = join(options.dir, `${options.name}-${stamp}-${this.runId}.jsonl`)
  }

  /** Appends the check to the file and prints one readable line. */
  record(input: RecordInput): CheckEvent {
    const { result, expected } = input
    const event: CheckEvent = {
      ts: new Date().toISOString(),
      runId: this.runId,
      phase: input.phase,
      check: input.check,
      verifier: input.verifier,
      ...(input.holder ? { holder: input.holder } : {}),
      ...(expected ? { expected, pass: result.ok === (expected === 'accepted') } : {}),
      ok: result.ok,
      reason: result.reason,
      durationMs: result.durationMs,
      ...(result.details ? { details: result.details } : {}),
    }
    appendFileSync(this.file, JSON.stringify(event) + '\n')
    this.events.push(event)
    if (!this.quiet) console.log(formatEvent(event))
    return event
  }

  get all(): readonly CheckEvent[] {
    return this.events
  }

  summary(): { total: number; passed: number; failed: number } {
    const withExpectation = this.events.filter((e) => e.pass !== undefined)
    const passed = withExpectation.filter((e) => e.pass).length
    return { total: this.events.length, passed, failed: withExpectation.length - passed }
  }

  printSummary(): void {
    const { total, passed, failed } = this.summary()
    console.log()
    console.log(`${total} checks, ${passed} as expected, ${failed} unexpected. Events written to ${this.file}`)
  }
}

export function formatEvent(e: CheckEvent): string {
  const icon = e.pass === undefined ? '·' : e.pass ? '✔' : '✘'
  const outcome = e.ok ? 'ACCEPTED' : 'REJECTED'
  const expectation = e.expected ? `expected ${e.expected}` : 'no expectation'
  return `  ${icon} ${e.check.padEnd(46)} ${outcome.padEnd(8)} ${e.reason.padEnd(34)} ${e.durationMs.toFixed(1).padStart(7)} ms   (${expectation})`
}
