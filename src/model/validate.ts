// Validation, run on every edit. Each issue names one element and field in plain language, says whether it
// blocks a run, and carries a one-click fix when the right fix is obvious. Rule ids stay stable for "explain".
import { isFixedPQ, key, labelOf, FIXED_BAND } from './types'
import type { CaseData, Generator } from './types'

export type Severity = 'error' | 'warning'
export type Patch = { element: string; field: string; value: unknown }
export type Fix = { label: string; patches: Patch[] }
export interface Issue {
  id: string            // rule:element:field, stable across edits
  rule: string
  severity: Severity
  element: string
  field?: string
  message: string
  why?: string          // one line on why it matters
  fix?: Fix
}

/** Unicode minus, trimmed decimals. */
export function n(x: number, d = 3): string {
  const s = Number(x.toFixed(d)).toString()
  return x < 0 ? s.replace('-', '−') : s
}

export const RULES: Record<string, { title: string; severity: Severity; explain: string }> = {
  p_limits: { title: 'P min above P max', severity: 'error', explain: 'The solver rejects a unit whose minimum real power is above its maximum. For a unit that absorbs power (negative P), the minimum is the more negative number.' },
  q_limits: { title: 'Q min above Q max', severity: 'error', explain: 'The solver rejects a unit whose minimum reactive power is above its maximum.' },
  q_equal: { title: 'Q min equals Q max', severity: 'error', explain: 'The solver rejects equal limits. A fixed-output unit needs a hair-wide band around its set point.' },
  pg_outside: { title: 'Scheduled P outside limits', severity: 'warning', explain: 'The dispatch will move the unit inside its limits; the scheduled value is only a starting point.' },
  v_limits: { title: 'V min above V max', severity: 'error', explain: 'The normal voltage band is inverted.' },
  v_emergency: { title: 'Emergency band inside normal band', severity: 'warning', explain: 'Emergency limits (VL, VH) are expected to be at least as wide as normal limits (VN, VX). Assumes VL/VH are emergency limits; to be confirmed.' },
  vm_outside: { title: 'Voltage outside its band', severity: 'warning', explain: 'The starting / last solved voltage is outside VN–VX. The optimizer has to move it or report a violation.' },
  vs_outside: { title: 'Set point outside the bus band', severity: 'warning', explain: 'A regulating unit holds its bus at VS; a VS outside VN–VX forces a voltage violation.' },
  rating_order: { title: 'Ratings out of order', severity: 'warning', explain: 'Expected Rate A (normal) ≤ Rate B (emergency) ≤ Rate C (short-term).' },
  zero_impedance: { title: 'Zero-impedance branch', severity: 'warning', explain: 'R and X are at or below the 1e-4 pu threshold: the solver treats it as a tie and merges the two buses.' },
  islanded: { title: 'Islanded equipment', severity: 'error', explain: 'No in-service path to the reference bus. The solver cannot assign it a voltage angle.' },
  slack_count: { title: 'Reference bus', severity: 'error', explain: 'The case needs exactly one reference (slack) bus.' },
  slack_gen: { title: 'Reference bus without a unit', severity: 'error', explain: 'The reference bus balances the system, so it needs an in-service generator.' },
  missing_bus: { title: 'Unknown bus', severity: 'error', explain: 'The element is connected to a bus that is not in the case.' },
  pv_no_gen: { title: 'Generator bus without a regulating unit', severity: 'warning', explain: 'Bus type 2 (PV) with no in-service voltage-regulating unit is treated as a load bus.' },
  gen_on_pq: { title: 'Regulating unit on a load bus', severity: 'warning', explain: 'A voltage-regulating unit on a type-1 (PQ) bus will not regulate.' },
  fixed_ireg: { title: 'Fixed P/Q unit with a regulated bus', severity: 'warning', explain: 'A fixed P/Q unit does not regulate voltage; IREG should be 0. A copied IREG makes the solver try to regulate a remote bus.' },
  ireg_missing: { title: 'Regulated bus does not exist', severity: 'error', explain: 'IREG points at a bus that is not in the case.' },
}

const gk = (g: Generator) => key.gen(g)

export function validate(c: CaseData): Issue[] {
  const out: Issue[] = []
  const add = (rule: string, element: string, field: string | undefined, message: string, fix?: Fix) =>
    out.push({ id: `${rule}:${element}:${field ?? ''}`, rule, severity: RULES[rule].severity, element, field, message, why: RULES[rule].explain, fix })
  const L = (k: string) => labelOf(k, c)
  const busIds = new Set(c.buses.map((b) => b.id))
  const busById = new Map(c.buses.map((b) => [b.id, b]))

  // --- references
  for (const l of c.loads) if (!busIds.has(l.bus)) add('missing_bus', key.load(l), 'bus', `${L(key.load(l))} is on bus ${l.bus}, which is not in the case.`)
  for (const g of c.generators) if (!busIds.has(g.bus)) add('missing_bus', gk(g), 'bus', `${L(gk(g))} is on bus ${g.bus}, which is not in the case.`)
  for (const b of c.branches) for (const end of [b.from, b.to]) if (!busIds.has(end)) add('missing_bus', key.branch(b), end === b.from ? 'from' : 'to', `${L(key.branch(b))} ends at bus ${end}, which is not in the case.`)

  // --- generators
  for (const g of c.generators) {
    const k = gk(g), name = L(k)
    if (g.pmin > g.pmax) add('p_limits', k, 'pmin', `${name}: minimum P (${n(g.pmin)} MW) must be ≤ maximum P (${n(g.pmax)} MW).`,
      { label: `Swap: P min ${n(g.pmax)}, P max ${n(g.pmin)} MW`, patches: [{ element: k, field: 'pmin', value: g.pmax }, { element: k, field: 'pmax', value: g.pmin }] })
    if (g.qmin > g.qmax) add('q_limits', k, 'qmin', `${name}: minimum Q (${n(g.qmin)} Mvar) must be ≤ maximum Q (${n(g.qmax)} Mvar).`,
      { label: `Swap: Q min ${n(g.qmax)}, Q max ${n(g.qmin)} Mvar`, patches: [{ element: k, field: 'qmin', value: g.qmax }, { element: k, field: 'qmax', value: g.qmin }] })
    else if (g.status && g.qmin === g.qmax) add('q_equal', k, 'qmax', `${name}: Q min and Q max are both ${n(g.qmin)} Mvar; the solver rejects equal limits.`,
      { label: `Widen to ${n(g.qmin - FIXED_BAND)} … ${n(g.qmax + FIXED_BAND)} Mvar`, patches: [{ element: k, field: 'qmin', value: +(g.qmin - FIXED_BAND).toFixed(4) }, { element: k, field: 'qmax', value: +(g.qmax + FIXED_BAND).toFixed(4) }] })
    if (g.status && g.pmin <= g.pmax && (g.pg < g.pmin - 1e-6 || g.pg > g.pmax + 1e-6)) add('pg_outside', k, 'pg', `${name}: scheduled P ${n(g.pg)} MW is outside ${n(g.pmin)} … ${n(g.pmax)} MW.`,
      { label: `Set P to ${n(Math.min(Math.max(g.pg, g.pmin), g.pmax))} MW`, patches: [{ element: k, field: 'pg', value: Math.min(Math.max(g.pg, g.pmin), g.pmax) }] })
    const fixed = isFixedPQ(g)
    if (fixed && g.ireg !== 0) add('fixed_ireg', k, 'ireg', `${name} is a fixed P/Q unit but regulates bus ${g.ireg} (IREG). Fixed units should have IREG = 0.`,
      { label: 'Set IREG to 0', patches: [{ element: k, field: 'ireg', value: 0 }] })
    if (g.ireg !== 0 && !busIds.has(g.ireg)) add('ireg_missing', k, 'ireg', `${name} regulates bus ${g.ireg}, which is not in the case.`,
      { label: 'Regulate its own terminal (IREG 0)', patches: [{ element: k, field: 'ireg', value: 0 }] })
    const b = busById.get(g.ireg || g.bus)
    if (g.status && !fixed && b && b.vn <= b.vx && (g.vs > b.vx + 1e-9 || g.vs < b.vn - 1e-9)) {
      const to = g.vs > b.vx ? b.vx : b.vn
      add('vs_outside', k, 'vs', `${name}: voltage set point ${n(g.vs, 4)} pu is outside bus ${b.id}'s band ${n(b.vn, 3)} … ${n(b.vx, 3)} pu.`,
        { label: `Set VS to ${n(to, 3)} pu`, patches: [{ element: k, field: 'vs', value: to }] })
    }
  }

  // --- buses
  const slacks = c.buses.filter((b) => b.type === 3)
  if (slacks.length === 0) add('slack_count', 'case', undefined, 'No reference (slack) bus. Pick one with "Make reference bus" on a generator bus.')
  if (slacks.length > 1) for (const s of slacks.slice(1)) add('slack_count', key.bus(s), 'type', `${L(key.bus(s))} is a second reference bus (bus ${slacks[0].id} is the first).`,
    { label: 'Make it a generator bus (type 2)', patches: [{ element: key.bus(s), field: 'type', value: 2 }] })
  for (const s of slacks) if (!c.generators.some((g) => g.bus === s.id && g.status)) add('slack_gen', key.bus(s), 'type', `${L(key.bus(s))} is the reference bus but has no in-service generator.`)

  for (const b of c.buses) {
    const k = key.bus(b), name = L(k)
    if (b.type === 4) continue
    if (b.vn > b.vx) add('v_limits', k, 'vn', `${name}: minimum voltage (${n(b.vn)} pu) must be ≤ maximum voltage (${n(b.vx)} pu).`,
      { label: 'Swap VN and VX', patches: [{ element: k, field: 'vn', value: b.vx }, { element: k, field: 'vx', value: b.vn }] })
    else {
      if (b.vl > b.vn) add('v_emergency', k, 'vl', `${name}: emergency minimum VL (${n(b.vl)} pu) is above the normal minimum VN (${n(b.vn)} pu).`,
        { label: `Set VL to ${n(b.vn)} pu`, patches: [{ element: k, field: 'vl', value: b.vn }] })
      if (b.vh < b.vx) add('v_emergency', k, 'vh', `${name}: emergency maximum VH (${n(b.vh)} pu) is below the normal maximum VX (${n(b.vx)} pu).`,
        { label: `Set VH to ${n(b.vx)} pu`, patches: [{ element: k, field: 'vh', value: b.vx }] })
      if (b.vm > b.vx + 5e-4 || b.vm < b.vn - 5e-4) add('vm_outside', k, 'vm', `${name}: voltage ${n(b.vm, 4)} pu is ${b.vm > b.vx ? 'above' : 'below'} its band ${n(b.vn)} … ${n(b.vx)} pu.`)
    }
    const units = c.generators.filter((g) => g.bus === b.id && g.status)
    const regulating = units.filter((g) => !isFixedPQ(g))
    if (b.type === 2 && regulating.length === 0) add('pv_no_gen', k, 'type', `${name} is a generator bus (type 2) but has no in-service voltage-regulating unit${units.length ? ' (only fixed P/Q units)' : ''}.`,
      { label: 'Make it a load bus (type 1)', patches: [{ element: k, field: 'type', value: 1 }] })
    if (b.type === 1 && regulating.length > 0) add('gen_on_pq', k, 'type', `${name} is a load bus (type 1) but ${L(gk(regulating[0]))} is set to regulate voltage.`,
      { label: 'Make it a generator bus (type 2)', patches: [{ element: k, field: 'type', value: 2 }] })
  }

  // --- branches
  for (const br of c.branches) {
    const k = key.branch(br), name = L(k)
    if (br.status && Math.abs(br.r) <= 1e-4 && Math.abs(br.x) <= 1e-4) add('zero_impedance', k, 'x', `${name}: R ${n(br.r, 5)} and X ${n(br.x, 5)} pu are at the zero-impedance threshold (1e-4); buses ${br.from} and ${br.to} will be merged.`)
    const [a, b2, cc] = [br.rateA, br.rateB, br.rateC]
    if ((b2 > 0 && a > b2) || (cc > 0 && b2 > cc)) add('rating_order', k, 'rateA', `${name}: ratings A ${n(a, 1)} / B ${n(b2, 1)} / C ${n(cc, 1)} MVA are not in increasing order.`)
  }

  // --- islands: walk from the reference bus over in-service branches and transformers
  if (slacks.length >= 1) {
    const adj = new Map<number, number[]>()
    const link = (a: number, b: number) => { adj.set(a, [...(adj.get(a) ?? []), b]); adj.set(b, [...(adj.get(b) ?? []), a]) }
    for (const br of c.branches) if (br.status) link(br.from, br.to)
    for (const t of c.transformers) if (t.status) { link(t.from, t.to); if (t.k) { link(t.from, t.k); link(t.to, t.k) } }
    const seen = new Set([slacks[0].id]), stack = [slacks[0].id]
    while (stack.length) for (const nb of adj.get(stack.pop()!) ?? []) if (!seen.has(nb)) { seen.add(nb); stack.push(nb) }
    for (const b of c.buses) {
      if (b.type === 4 || seen.has(b.id)) continue
      add('islanded', key.bus(b), 'type', `${L(key.bus(b))} has no in-service path to the reference bus ${slacks[0].id}.`,
        { label: 'Take the bus out of service (type 4)', patches: [{ element: key.bus(b), field: 'type', value: 4 }] })
    }
  }
  return out
}

export const blocking = (issues: Issue[]) => issues.filter((i) => i.severity === 'error')
