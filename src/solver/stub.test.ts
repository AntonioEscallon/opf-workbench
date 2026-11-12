// The stub must behave like a solver: converge on the demo case, balance power, fail with named elements.
import { describe, expect, it } from 'vitest'
import { seedCase } from '../model/seed'
import { applyPatches, convertToFixedPQ } from '../model/ops'
import { DEFAULT_SETTINGS } from './interface'
import type { Objective } from './interface'
import { stubSolver } from './stub'
import { translate } from './codes'

const run = (c = seedCase(), objective: Objective = 'economic_dispatch') =>
  stubSolver.solve({ format: 'opf-workbench/solver-input@1', case: c, objective, settings: DEFAULT_SETTINGS, meta: { run: 1, version: 1, hash: 'x' } })

describe('stub solver', () => {
  it('solves the demo case and balances power', () => {
    const r = run()
    expect(r.status).not.toBe('failed')
    const s = r.summary!
    expect(s.mismatch).toBeLessThan(1e-5)
    expect(s.genP - s.loadP - s.lineLossP - s.txLossP).toBeCloseTo(0, 3)
    expect(s.loadP).toBeCloseTo(271.9, 1)
    expect(s.lineLossP + s.txLossP).toBeGreaterThan(2)
    expect(s.lineLossP + s.txLossP).toBeLessThan(25)
    expect(s.minVm).toBeGreaterThan(0.9)
    console.log(JSON.stringify({ status: r.status, ...s, worst: s.worst?.text }, null, 1))
    console.log(r.log.slice(0, 12).join('\n'))
  })

  it('reacts to a fixed-P/Q conversion (Q at bus 12 changes)', () => {
    const base = seedCase()
    const a = run(applyPatches(base, convertToFixedPQ(base, 'load:12-1', 0.8, true).patches))
    const b = run(applyPatches(base, convertToFixedPQ(base, 'load:12-1', 0.8, false).patches))
    const vm = (r: typeof a) => r.buses.find((x) => x.id === 12)!.vm
    expect(vm(a)).toBeGreaterThan(vm(b))
  })

  it('fails with 403 and names the field when P min > P max', () => {
    const c = seedCase(); c.generators[3].pmin = 60
    const r = run(c)
    expect(r.code).toBe(403)
    expect(translate(r, c).message).toBe('Generator 8-1, field P min (value 60).')
  })

  it('all objectives run', () => {
    for (const o of ['max_q_reserve', 'manage_voltage', 'min_generation', 'transfer_limit', 'max_loadability'] as Objective[]) {
      const r = run(seedCase(), o)
      expect(r.status, o).not.toBe('failed')
    }
    expect(run(seedCase(), 'max_loadability').summary!.loadability).toBeGreaterThan(1)
  })
})
