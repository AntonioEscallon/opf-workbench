// Edits and one-click operations. Every change is a list of patches plus a note; the store either commits it as a
// new case version or keeps it as a scenario's overrides on a base version. A patch on field "__row" inserts,
// replaces (value = row) or deletes (value = null) a whole element, which is what structural operations need.
import { clone, findRow, FIXED_BAND, isFixedPQ, key, keyOf, labelOf, TABLE_OF } from './types'
import type { CaseData, Generator, Table } from './types'
import { n } from './validate'
import type { Patch } from './validate'

export type Change = { patches: Patch[]; note: string }

export function applyPatches(base: CaseData, patches: Patch[]): CaseData {
  const c = clone(base)
  for (const p of patches) {
    if (p.field === '__row') {
      const table = TABLE_OF[p.element.split(':')[0]] as Table
      const rows = c[table] as any[]
      const i = rows.findIndex((r) => keyOf(table, r) === p.element)
      if (p.value === null) { if (i >= 0) rows.splice(i, 1) }
      else if (i >= 0) rows[i] = clone(p.value)
      else rows.push(clone(p.value))
      continue
    }
    const hit = findRow(c, p.element)
    if (hit) hit.row[p.field] = p.value
  }
  return c
}

/** Field labels used in notes, tables and messages. */
export const FIELD_LABEL: Record<string, string> = {
  pg: 'P', qg: 'Q', pmin: 'P min', pmax: 'P max', qmin: 'Q min', qmax: 'Q max', vs: 'V set point', ireg: 'regulated bus',
  status: 'status', cost1: 'cost 1', cost2: 'cost 2', vn: 'VN', vx: 'VX', vl: 'VL', vh: 'VH', vm: 'VM', va: 'VA', type: 'type',
  name: 'name', pl: 'P', ql: 'Q', r: 'R', x: 'X', b: 'B', rateA: 'Rate A', rateB: 'Rate B', rateC: 'Rate C', g: 'G',
  baseKv: 'base kV', area: 'area', zone: 'zone', mbase: 'MVA base',
}
const UNIT: Record<string, string> = { pg: 'MW', qg: 'Mvar', pmin: 'MW', pmax: 'MW', qmin: 'Mvar', qmax: 'Mvar', pl: 'MW', ql: 'Mvar',
  vs: 'pu', vn: 'pu', vx: 'pu', vl: 'pu', vh: 'pu', vm: 'pu', rateA: 'MVA', rateB: 'MVA', rateC: 'MVA', g: 'MW', b: 'Mvar' }

const show = (v: unknown, f: string) => (typeof v === 'number' ? `${n(v, 4)}${UNIT[f] ? ` ${UNIT[f]}` : ''}` : String(v))

/** One field edit (or the same edit on many elements). */
export function editField(c: CaseData, elements: string[], field: string, value: unknown): Change {
  const patches = elements.map((element) => ({ element, field, value }))
  const first = findRow(c, elements[0])?.row
  const note = elements.length === 1
    ? `${labelOf(elements[0], c)}: ${FIELD_LABEL[field] ?? field} ${show(first?.[field], field)} → ${show(value, field)}`
    : `${elements.length} elements: ${FIELD_LABEL[field] ?? field} → ${show(value, field)}`
  return { patches, note }
}

/** Q for a given real power and power factor. Producing = injects Mvar (positive Q, generator convention). */
export const qAtPf = (p: number, pf: number, producing: boolean) =>
  +(Math.abs(p) * Math.tan(Math.acos(Math.min(1, Math.max(0.01, pf)))) * (producing ? 1 : -1)).toFixed(4)

/**
 * "Convert unit to fixed P/Q at power factor ___". Works on a generator, or on a load (the load is replaced by a unit
 * with the same P drawn from the grid, i.e. negative P). Sets Q = |P|·tan(acos pf) with the chosen sign, pins P and Q
 * to a hair-wide band (equal limits are rejected), clears IREG and makes the bus a load bus if nothing else regulates.
 */
export function convertToFixedPQ(c: CaseData, element: string, pf: number, producing: boolean): Change {
  const hit = findRow(c, element)
  if (!hit) throw new Error(`${element} not found`)
  const patches: Patch[] = []
  let g: Generator
  if (hit.table === 'loads') {
    const l = hit.row
    let id = l.id
    while (c.generators.some((x) => x.bus === l.bus && x.id === id)) id = String(Number(id) + 1 || 'A')
    g = { bus: l.bus, id, pg: -l.pl, qg: 0, qmax: 0, qmin: 0, vs: 1, ireg: 0, mbase: 100, zr: 0, zx: 1, rt: 0, xt: 0, gtap: 1,
      status: 1, rmpct: 100, pmax: 0, pmin: 0, o1: 1, f1: 1, cost1: 0, cost2: 0 }
    patches.push({ element, field: '__row', value: null })
  } else if (hit.table === 'generators') {
    g = clone(hit.row)
  } else throw new Error('Only generators and loads can be converted')
  const p = g.pg
  const qv = qAtPf(p, pf, producing)
  g.pmin = +(p - FIXED_BAND).toFixed(4); g.pmax = +(p + FIXED_BAND).toFixed(4)
  g.qg = qv; g.qmin = +(qv - FIXED_BAND).toFixed(4); g.qmax = +(qv + FIXED_BAND).toFixed(4)
  g.ireg = 0; g.status = 1
  patches.push({ element: key.gen(g), field: '__row', value: g })
  const bus = c.buses.find((b) => b.id === g.bus)
  const otherReg = c.generators.some((x) => x.bus === g.bus && x.status && key.gen(x) !== key.gen(g) && !isFixedPQ(x))
  if (bus && bus.type === 2 && !otherReg) patches.push({ element: key.bus(bus), field: 'type', value: 1 })
  const what = hit.table === 'loads' ? `${labelOf(element, c)} → fixed P/Q unit ${g.bus}-${g.id}` : `${labelOf(element, c)} → fixed P/Q`
  return { patches, note: `${what} at pf ${pf.toFixed(2)} ${producing ? 'producing' : 'absorbing'} (P ${n(p)} MW, Q ${n(qv)} Mvar)` }
}

/** Restore a fixed unit to voltage regulation with a set point and a Q range. */
export function restoreRegulating(c: CaseData, element: string, vs: number, qmin: number, qmax: number, pmin?: number, pmax?: number): Change {
  const g = findRow(c, element)?.row as Generator
  const patches: Patch[] = [
    { element, field: 'vs', value: vs }, { element, field: 'ireg', value: 0 },
    { element, field: 'qmin', value: qmin }, { element, field: 'qmax', value: qmax },
  ]
  if (pmin !== undefined) patches.push({ element, field: 'pmin', value: pmin })
  if (pmax !== undefined) patches.push({ element, field: 'pmax', value: pmax })
  const bus = c.buses.find((b) => b.id === g.bus)
  if (bus && bus.type === 1) patches.push({ element: key.bus(bus), field: 'type', value: 2 })
  return { patches, note: `${labelOf(element, c)} → voltage-regulating at ${n(vs, 3)} pu, Q ${n(qmin)} … ${n(qmax)} Mvar` }
}

/** Move the reference bus; optionally shrink the new reference unit's Q range to ±qAbs Mvar. */
export function makeReference(c: CaseData, busId: number, qAbs?: number): Change {
  const patches: Patch[] = []
  for (const b of c.buses) if (b.type === 3 && b.id !== busId) {
    const hasReg = c.generators.some((g) => g.bus === b.id && g.status && !isFixedPQ(g))
    patches.push({ element: key.bus(b), field: 'type', value: hasReg ? 2 : 1 })
  }
  patches.push({ element: key.bus({ id: busId }), field: 'type', value: 3 })
  const g = c.generators.find((x) => x.bus === busId && x.status)
  if (g && qAbs !== undefined) {
    patches.push({ element: key.gen(g), field: 'qmin', value: -Math.abs(qAbs) }, { element: key.gen(g), field: 'qmax', value: Math.abs(qAbs) })
  }
  const old = c.buses.find((b) => b.type === 3)
  return { patches, note: `Reference bus ${old ? `${old.id} → ` : ''}${busId}${qAbs !== undefined && g ? `, Q range ±${n(qAbs)} Mvar` : ''}` }
}

/** Enable / disable any element. Buses go to type 4 (isolated) and back. */
export function toggleInService(c: CaseData, element: string): Change {
  const hit = findRow(c, element)
  if (!hit) throw new Error(`${element} not found`)
  if (hit.table === 'buses') {
    const b = hit.row
    const back = c.generators.some((g) => g.bus === b.id && g.status && !isFixedPQ(g)) ? 2 : 1
    const to = b.type === 4 ? back : 4
    return { patches: [{ element, field: 'type', value: to }], note: `${labelOf(element, c)} ${to === 4 ? 'taken out of service' : 'back in service'}` }
  }
  const to = hit.row.status ? 0 : 1
  return { patches: [{ element, field: 'status', value: to }], note: `${labelOf(element, c)} ${to ? 'enabled' : 'disabled'}` }
}

/** Steps of a power-factor sweep, signed: + producing, − absorbing. */
export function sweepSteps(from: number, to: number, step: number, producing: boolean, absorbing: boolean): number[] {
  const out: number[] = []
  const s = Math.abs(step) || 0.05
  const vals: number[] = []
  for (let v = Math.max(from, to); v >= Math.min(from, to) - 1e-9; v -= s) vals.push(+v.toFixed(4))
  if (producing) out.push(...vals)
  if (absorbing) out.push(...vals.map((v) => -v))
  return out
}

export const keyOfGen = (g: Generator) => keyOf('generators', g)
