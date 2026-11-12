// The case data model. One row type per database table (db/schema.sql). Values are stored in physical units
// (MW, Mvar, kV, % on the system MVA base where PSS/E uses it); the UI converts to per-unit on request.
// Field names are spelled out; the PSS/E name is noted where it differs, because that is what users know.

export type BusType = 1 | 2 | 3 | 4 // PSS/E IDE: 1 load (PQ), 2 generator (PV), 3 reference (slack), 4 isolated

export interface Bus {
  id: number
  name: string
  baseKv: number
  type: BusType
  area: number
  zone: number
  vm: number          // voltage magnitude, pu (starting point / last solved)
  va: number          // voltage angle, degrees
  owner: number
  vn: number          // normal minimum voltage, pu      (side file *_Volts.txt)
  vx: number          // normal maximum voltage, pu
  vl: number          // emergency minimum voltage, pu  (assumed meaning of VL; see open questions)
  vh: number          // emergency maximum voltage, pu
}

export interface Load {
  bus: number
  id: string
  status: 0 | 1
  area: number
  zone: number
  pl: number          // MW
  ql: number          // Mvar
  ip: number; iq: number; yp: number; yq: number // constant-current / admittance parts (kept for round-trip)
  owner: number
}

export interface Generator {
  bus: number
  id: string
  pg: number          // MW (scheduled / solved)
  qg: number          // Mvar
  qmax: number        // QT, Mvar
  qmin: number        // QB, Mvar
  vs: number          // voltage set point, pu
  ireg: number        // regulated bus, 0 = own terminal
  mbase: number       // MVA
  zr: number; zx: number; rt: number; xt: number; gtap: number
  status: 0 | 1
  rmpct: number
  pmax: number        // PT, MW
  pmin: number        // PB, MW
  o1: number; f1: number
  cost1: number       // $/MWh (side file *_Costs.txt). Assumed linear coefficient.
  cost2: number       // $/MWh² (assumed quadratic coefficient)
}

export interface Branch {
  from: number
  to: number
  ckt: string
  r: number; x: number; b: number   // pu on system base
  rateA: number; rateB: number; rateC: number // MVA: normal, emergency (B), short-term (C)
  gi: number; bi: number; gj: number; bj: number
  status: 0 | 1
  len: number
  o1: number; f1: number
}

export interface Winding {
  windv: number; nomv: number; ang: number
  rateA: number; rateB: number; rateC: number
  cod: number; cont: number; rma: number; rmi: number; vma: number; vmi: number; ntp: number; tab: number; cr: number; cx: number
}

/** Winding 2 of a two-winding transformer only carries WINDV2 and NOMV2 in the RAW file. */
export const bareWinding = (windv: number, nomv: number): Winding => ({
  windv, nomv, ang: 0, rateA: 0, rateB: 0, rateC: 0, cod: 0, cont: 0, rma: 0, rmi: 0, vma: 0, vmi: 0, ntp: 0, tab: 0, cr: 0, cx: 0,
})

export interface Transformer {
  from: number        // winding 1 bus
  to: number          // winding 2 bus
  k: number           // winding 3 bus, 0 = two-winding
  ckt: string
  cw: number; cz: number; cm: number; mag1: number; mag2: number; nmetr: number
  name: string
  status: 0 | 1
  o1: number; f1: number
  r12: number; x12: number; sbase12: number
  r23: number; x23: number; sbase23: number
  r31: number; x31: number; sbase31: number
  vmstar: number; anstar: number
  windings: Winding[] // 2 (two-winding: only windv/nomv of winding 2 are used) or 3
}

// Fixed shunts. PSS/E v30 keeps them as GL/BL on the bus record; the RAW writer sums them per bus.
export interface Shunt { bus: number; id: string; g: number; b: number; status: 0 | 1 } // MW / Mvar at 1 pu
export interface Area { id: number; isw: number; pdes: number; ptol: number; name: string }
export interface Zone { id: number; name: string }

export interface CaseData {
  title: [string, string]
  sbase: number       // system MVA base
  frequency: number
  buses: Bus[]
  loads: Load[]
  generators: Generator[]
  branches: Branch[]
  transformers: Transformer[]
  shunts: Shunt[]
  areas: Area[]
  zones: Zone[]
  /** RAW sections this model does not edit (DC lines, FACTS, ...), kept verbatim so import -> export is lossless. */
  rawExtras?: Record<string, string[]>
}

export type Table = 'buses' | 'loads' | 'generators' | 'branches' | 'transformers' | 'shunts'

/** Stable element keys, used for selection, validation and overrides. */
export const key = {
  bus: (b: { id: number }) => `bus:${b.id}`,
  load: (l: { bus: number; id: string }) => `load:${l.bus}-${l.id}`,
  gen: (g: { bus: number; id: string }) => `generator:${g.bus}-${g.id}`,
  branch: (b: { from: number; to: number; ckt: string }) => `branch:${b.from}-${b.to}-${b.ckt}`,
  tx: (t: { from: number; to: number; k: number; ckt: string }) => `transformer:${t.from}-${t.to}${t.k ? `-${t.k}` : ''}-${t.ckt}`,
  shunt: (s: { bus: number; id: string }) => `shunt:${s.bus}-${s.id}`,
}

export const TABLE_OF: Record<string, Table> = {
  bus: 'buses', load: 'loads', generator: 'generators', branch: 'branches', transformer: 'transformers', shunt: 'shunts',
}

export function keyOf(table: Table, row: any): string {
  switch (table) {
    case 'buses': return key.bus(row)
    case 'loads': return key.load(row)
    case 'generators': return key.gen(row)
    case 'branches': return key.branch(row)
    case 'transformers': return key.tx(row)
    case 'shunts': return key.shunt(row)
  }
}

/** "Generator 12-1", "Bus 9 (Bus 9)", "Line 1-2 (1)". */
export function labelOf(k: string, data?: CaseData): string {
  const [kind, rest] = k.split(':')
  if (kind === 'bus') {
    const b = data?.buses.find((x) => `${x.id}` === rest)
    return b && b.name !== `Bus ${b.id}` ? `Bus ${rest} (${b.name})` : `Bus ${rest}`
  }
  if (kind === 'branch') { const [f, t, c] = rest.split('-'); return `Line ${f}–${t} (${c})` }
  if (kind === 'transformer') { const p = rest.split('-'); return `Transformer ${p.slice(0, -1).join('–')} (${p[p.length - 1]})` }
  const name = { load: 'Load', generator: 'Generator', shunt: 'Shunt' }[kind] ?? kind
  return `${name} ${rest}`
}

export function findRow(data: CaseData, k: string): { table: Table; row: any } | null {
  const table = TABLE_OF[k.split(':')[0]]
  if (!table) return null
  const row = (data[table] as any[]).find((r) => keyOf(table, r) === k)
  return row ? { table, row } : null
}

export const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x))

/** Band kept between min and max when a unit is pinned to fixed output: the solver rejects equal limits. */
export const FIXED_BAND = 0.01

/** A generator is "fixed P/Q" (grid-following, non-regulating) when its Q range is pinned to a hair-wide band. */
export const isFixedPQ = (g: Generator) => g.qmax - g.qmin <= 2 * FIXED_BAND + 1e-9
