// Column definitions: one list per equipment table, shared by the spreadsheet tables and the detail panel, so a
// field has the same label, unit and edit rule everywhere. "old" is the name the field had in the old tool / RAW.
import { isFixedPQ } from '../model/types'
import type { CaseData, Table } from '../model/types'
import type { Units } from '../store'

export type Col = {
  key: string
  label: string
  unit?: string
  kind: 'num' | 'int' | 'text' | 'enum' | 'status'
  editable?: boolean
  power?: boolean            // MW / Mvar: shown in pu when the per-unit toggle is on
  digits?: number
  options?: [number | string, string][]
  get?: (row: any, data: CaseData) => unknown
  old?: string
  hint?: string
}

export const BUS_TYPES: [number, string][] = [[1, 'Load (PQ)'], [2, 'Generator (PV)'], [3, 'Reference'], [4, 'Out of service']]
const STATUS: [number, string][] = [[1, 'In service'], [0, 'Out']]

export const COLUMNS: Record<Table, Col[]> = {
  buses: [
    { key: 'id', label: 'Bus', kind: 'int' },
    { key: 'name', label: 'Name', kind: 'text', editable: true },
    { key: 'type', label: 'Type', kind: 'enum', options: BUS_TYPES, editable: true, old: 'IDE' },
    { key: 'baseKv', label: 'Base', unit: 'kV', kind: 'num', digits: 1 },
    { key: 'area', label: 'Area', kind: 'int', editable: true },
    { key: 'vn', label: 'V min', unit: 'pu', kind: 'num', digits: 3, editable: true, old: 'VN', hint: 'Normal minimum voltage' },
    { key: 'vx', label: 'V max', unit: 'pu', kind: 'num', digits: 3, editable: true, old: 'VX', hint: 'Normal maximum voltage' },
    { key: 'vl', label: 'V min emerg.', unit: 'pu', kind: 'num', digits: 3, editable: true, old: 'VL', hint: 'Assumed emergency minimum (to be confirmed)' },
    { key: 'vh', label: 'V max emerg.', unit: 'pu', kind: 'num', digits: 3, editable: true, old: 'VH', hint: 'Assumed emergency maximum (to be confirmed)' },
    { key: 'vm', label: 'VM', unit: 'pu', kind: 'num', digits: 4, hint: 'Starting / last solved magnitude in the case data' },
    { key: 'va', label: 'VA', unit: '°', kind: 'num', digits: 2 },
    { key: 'equipment', label: 'Equipment', kind: 'text', get: (b, c) => {
      const parts: string[] = []
      const g = c.generators.filter((x) => x.bus === b.id)
      const l = c.loads.filter((x) => x.bus === b.id)
      const s = c.shunts.filter((x) => x.bus === b.id)
      if (g.length) parts.push(g.map((x) => (isFixedPQ(x) ? 'fixed P/Q' : 'gen')).join(', '))
      if (l.length) parts.push(`${l.length} load`)
      if (s.length) parts.push('shunt')
      return parts.join(' · ')
    } },
  ],
  loads: [
    { key: 'bus', label: 'Bus', kind: 'int' },
    { key: 'id', label: 'ID', kind: 'text' },
    { key: 'status', label: 'Status', kind: 'status', options: STATUS, editable: true },
    { key: 'pl', label: 'P', unit: 'MW', kind: 'num', digits: 2, editable: true, power: true, old: 'PL' },
    { key: 'ql', label: 'Q', unit: 'Mvar', kind: 'num', digits: 2, editable: true, power: true, old: 'QL' },
    { key: 'pf', label: 'Power factor', kind: 'num', digits: 3, get: (l) => (l.pl === 0 && l.ql === 0 ? null : Math.abs(l.pl) / Math.hypot(l.pl, l.ql)) },
    { key: 'area', label: 'Area', kind: 'int' },
  ],
  generators: [
    { key: 'bus', label: 'Bus', kind: 'int' },
    { key: 'id', label: 'ID', kind: 'text' },
    { key: 'status', label: 'Status', kind: 'status', options: STATUS, editable: true },
    { key: 'mode', label: 'Control', kind: 'text', get: (g) => (isFixedPQ(g) ? 'Fixed P/Q' : 'Voltage') },
    { key: 'pg', label: 'P', unit: 'MW', kind: 'num', digits: 3, editable: true, power: true, old: 'PG' },
    { key: 'pmin', label: 'P min', unit: 'MW', kind: 'num', digits: 3, editable: true, power: true, old: 'PN / PB' },
    { key: 'pmax', label: 'P max', unit: 'MW', kind: 'num', digits: 3, editable: true, power: true, old: 'PX / PT' },
    { key: 'qg', label: 'Q', unit: 'Mvar', kind: 'num', digits: 3, editable: true, power: true, old: 'QG' },
    { key: 'qmin', label: 'Q min', unit: 'Mvar', kind: 'num', digits: 3, editable: true, power: true, old: 'QN / QB' },
    { key: 'qmax', label: 'Q max', unit: 'Mvar', kind: 'num', digits: 3, editable: true, power: true, old: 'QX / QT' },
    { key: 'vs', label: 'V set', unit: 'pu', kind: 'num', digits: 4, editable: true, old: 'VS' },
    { key: 'ireg', label: 'Reg. bus', kind: 'int', editable: true, old: 'IREG', hint: '0 = its own terminal' },
    { key: 'cost1', label: 'Cost 1', unit: '$/MWh', kind: 'num', digits: 3, editable: true },
    { key: 'cost2', label: 'Cost 2', unit: '$/MWh²', kind: 'num', digits: 4, editable: true },
    { key: 'mbase', label: 'MVA base', unit: 'MVA', kind: 'num', digits: 1, editable: true },
  ],
  branches: [
    { key: 'from', label: 'From', kind: 'int' },
    { key: 'to', label: 'To', kind: 'int' },
    { key: 'ckt', label: 'Ckt', kind: 'text' },
    { key: 'status', label: 'Status', kind: 'status', options: STATUS, editable: true },
    { key: 'r', label: 'R', unit: 'pu', kind: 'num', digits: 5, editable: true },
    { key: 'x', label: 'X', unit: 'pu', kind: 'num', digits: 5, editable: true },
    { key: 'b', label: 'B', unit: 'pu', kind: 'num', digits: 4, editable: true },
    { key: 'rateA', label: 'Rate A', unit: 'MVA', kind: 'num', digits: 1, editable: true, hint: 'Normal' },
    { key: 'rateB', label: 'Rate B', unit: 'MVA', kind: 'num', digits: 1, editable: true, hint: 'Emergency' },
    { key: 'rateC', label: 'Rate C', unit: 'MVA', kind: 'num', digits: 1, editable: true, hint: 'Short-term' },
  ],
  transformers: [
    { key: 'from', label: 'Wdg 1', kind: 'int' },
    { key: 'to', label: 'Wdg 2', kind: 'int' },
    { key: 'k', label: 'Wdg 3', kind: 'int' },
    { key: 'ckt', label: 'Ckt', kind: 'text' },
    { key: 'name', label: 'Name', kind: 'text', editable: true },
    { key: 'status', label: 'Status', kind: 'status', options: STATUS, editable: true },
    { key: 'r12', label: 'R 1–2', unit: 'pu', kind: 'num', digits: 5, editable: true },
    { key: 'x12', label: 'X 1–2', unit: 'pu', kind: 'num', digits: 5, editable: true },
    { key: 'x23', label: 'X 2–3', unit: 'pu', kind: 'num', digits: 5, editable: true },
    { key: 'x31', label: 'X 3–1', unit: 'pu', kind: 'num', digits: 5, editable: true },
    { key: 'tap', label: 'Tap 1', unit: 'pu', kind: 'num', digits: 4, get: (t) => t.windings[0].windv },
    { key: 'rate', label: 'Rate A (wdg 1)', unit: 'MVA', kind: 'num', digits: 1, get: (t) => t.windings[0].rateA },
  ],
  shunts: [
    { key: 'bus', label: 'Bus', kind: 'int' },
    { key: 'id', label: 'ID', kind: 'text' },
    { key: 'status', label: 'Status', kind: 'status', options: STATUS, editable: true },
    { key: 'g', label: 'G', unit: 'MW', kind: 'num', digits: 3, editable: true, power: true, hint: 'At 1 pu voltage' },
    { key: 'b', label: 'B', unit: 'Mvar', kind: 'num', digits: 3, editable: true, power: true, hint: 'At 1 pu voltage; positive = capacitive' },
  ],
}

export const TABLE_LABEL: Record<Table, string> = {
  buses: 'Buses', loads: 'Loads', generators: 'Generators', branches: 'AC lines', transformers: 'Transformers', shunts: 'Shunts',
}

/** Raw value of a column (from the row, or computed). */
export const valueOf = (col: Col, row: any, data: CaseData) => (col.get ? col.get(row, data) : row[col.key])

/** Display unit for a column under the current unit setting. */
export const unitOf = (col: Col, units: Units) => (col.power && units === 'pu' ? 'pu' : col.unit)

/** To display: physical -> pu when asked. */
export const toDisplay = (col: Col, v: unknown, units: Units, sbase: number) =>
  typeof v === 'number' && col.power && units === 'pu' ? v / sbase : v

/** From an edited display value back to the stored physical value. */
export const fromDisplay = (col: Col, v: number, units: Units, sbase: number) => (col.power && units === 'pu' ? v * sbase : v)

export function fmtCell(col: Col, v: unknown, units: Units): string {
  if (v === null || v === undefined || v === '') return ''
  if (col.options) return col.options.find(([k]) => k === v)?.[1] ?? String(v)
  if (typeof v === 'number') {
    const d = col.power && units === 'pu' ? Math.max(4, col.digits ?? 3) : col.digits ?? 0
    const s = col.kind === 'int' ? String(v) : v.toFixed(d)
    return v < 0 ? s.replace('-', '−') : s
  }
  return String(v)
}
