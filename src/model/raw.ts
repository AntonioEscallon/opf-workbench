// PSS/E RAW (v30 layout) reader and writer, plus the two side files (voltage limits, generator costs).
// RAW is an exchange format here, not the working format: import -> database -> export must give the same case
// back (tests/raw.test.ts). Sections the model does not edit are kept verbatim in `rawExtras`.
import { bareWinding } from './types'
import type { Area, Branch, Bus, CaseData, Generator, Load, Shunt, Transformer, Winding, Zone } from './types'

// ---------------------------------------------------------------------------------------------- writing

/** Fixed decimals when that is exact, otherwise the shortest exact form: readable and lossless. */
function num(n: number, d: number): string {
  const s = n.toFixed(d)
  return Number(s) === n ? s : String(n)
}
const q = (s: string, width = 0) => `'${s.padEnd(width)}'`
const join = (xs: (string | number)[]) => xs.join(',')

const SECTIONS_AFTER_AREA = ['TWO-TERMINAL DC', 'VSC DC LINE', 'SWITCHED SHUNT', 'TRANSFORMER IMPEDANCE CORRECTION',
  'MULTI-TERMINAL DC', 'MULTI-SECTION LINE']
const SECTIONS_AFTER_ZONE = ['INTER-AREA TRANSFER', 'OWNER', 'FACTS DEVICE']

function windingLine(w: Winding): string {
  return join([num(w.windv, 5), num(w.nomv, 3), num(w.ang, 3), num(w.rateA, 2), num(w.rateB, 2), num(w.rateC, 2),
    w.cod, w.cont, num(w.rma, 5), num(w.rmi, 5), num(w.vma, 5), num(w.vmi, 5), w.ntp, w.tab, num(w.cr, 5), num(w.cx, 5)])
}

export function writeRaw(c: CaseData): string {
  const out: string[] = []
  const end = (name: string, next: string) => out.push(`0 / END OF ${name} DATA, BEGIN ${next} DATA`)
  const extras = (name: string) => out.push(...(c.rawExtras?.[name] ?? []))

  out.push(`0, ${num(c.sbase, 2)}, 30, 0, 1, ${num(c.frequency, 2)}     / PSS/E-30 RAW, written by OPF Workbench`)
  out.push(c.title[0], c.title[1])

  // fixed shunts live in their own table; v30 carries them as GL / BL on the bus record
  const shuntAt = (id: number) => c.shunts.filter((s) => s.bus === id && s.status === 1)
  for (const b of c.buses) {
    const sh = shuntAt(b.id)
    const gl = sh.reduce((a, s) => a + s.g, 0), bl = sh.reduce((a, s) => a + s.b, 0)
    out.push(join([b.id, q(b.name, 12), num(b.baseKv, 4), b.type, num(gl, 3), num(bl, 3), b.area, b.zone,
      num(b.vm, 5), num(b.va, 4), b.owner]))
  }
  end('BUS', 'LOAD')
  for (const l of c.loads) {
    out.push(join([l.bus, q(l.id, 2), l.status, l.area, l.zone, num(l.pl, 3), num(l.ql, 3), num(l.ip, 3), num(l.iq, 3),
      num(l.yp, 3), num(l.yq, 3), l.owner]))
  }
  end('LOAD', 'GENERATOR')
  for (const g of c.generators) {
    out.push(join([g.bus, q(g.id, 2), num(g.pg, 3), num(g.qg, 3), num(g.qmax, 3), num(g.qmin, 3), num(g.vs, 5), g.ireg,
      num(g.mbase, 3), num(g.zr, 5), num(g.zx, 5), num(g.rt, 5), num(g.xt, 5), num(g.gtap, 5), g.status, num(g.rmpct, 1),
      num(g.pmax, 3), num(g.pmin, 3), g.o1, num(g.f1, 4)]))
  }
  end('GENERATOR', 'BRANCH')
  for (const b of c.branches) {
    out.push(join([b.from, b.to, q(b.ckt, 2), num(b.r, 6), num(b.x, 6), num(b.b, 6), num(b.rateA, 2), num(b.rateB, 2),
      num(b.rateC, 2), num(b.gi, 5), num(b.bi, 5), num(b.gj, 5), num(b.bj, 5), b.status, num(b.len, 2), b.o1, num(b.f1, 4)]))
  }
  end('BRANCH', 'TRANSFORMER')
  for (const t of c.transformers) {
    out.push(join([t.from, t.to, t.k, q(t.ckt, 2), t.cw, t.cz, t.cm, num(t.mag1, 5), num(t.mag2, 5), t.nmetr,
      q(t.name, 12), t.status, t.o1, num(t.f1, 4)]))
    if (t.k === 0) {
      out.push(join([num(t.r12, 6), num(t.x12, 6), num(t.sbase12, 2)]))
      out.push(windingLine(t.windings[0]))
      out.push(join([num(t.windings[1].windv, 5), num(t.windings[1].nomv, 3)]))
    } else {
      out.push(join([num(t.r12, 6), num(t.x12, 6), num(t.sbase12, 2), num(t.r23, 6), num(t.x23, 6), num(t.sbase23, 2),
        num(t.r31, 6), num(t.x31, 6), num(t.sbase31, 2), num(t.vmstar, 5), num(t.anstar, 3)]))
      for (const w of t.windings) out.push(windingLine(w))
    }
  }
  end('TRANSFORMER', 'AREA')
  for (const a of c.areas) out.push(join([a.id, a.isw, num(a.pdes, 3), num(a.ptol, 3), q(a.name, 12)]))
  let prev = 'AREA'
  for (const s of SECTIONS_AFTER_AREA) { end(prev, s); extras(s); prev = s }
  end(prev, 'ZONE')
  for (const z of c.zones) out.push(join([z.id, q(z.name, 12)]))
  prev = 'ZONE'
  for (const s of SECTIONS_AFTER_ZONE) { end(prev, s); extras(s); prev = s }
  out.push(`0 / END OF ${prev} DATA`)
  out.push('Q')
  return out.join('\n') + '\n'
}

// ---------------------------------------------------------------------------------------------- reading

/** Split a record into fields: commas (or blanks) separate, single quotes protect, "/" starts a comment.
 *  An empty field between two commas stays as '' so later fields keep their position (PSS/E default). */
export function tokens(line: string): string[] {
  const parts: string[] = []
  let cur = '', inQ = false
  for (const ch of line) {
    if (ch === "'") inQ = !inQ
    if (!inQ && ch === '/') break
    if (!inQ && ch === ',') { parts.push(cur); cur = ''; continue }
    cur += ch
  }
  parts.push(cur)
  const out: string[] = []
  for (const raw of parts) {
    const p = raw.trim()
    if (p.startsWith("'")) { out.push(p.slice(1, p.lastIndexOf("'") > 0 ? p.lastIndexOf("'") : undefined).trim()); continue }
    if (/\s/.test(p)) out.push(...p.split(/\s+/)); else out.push(p)
  }
  while (out.length && out[out.length - 1] === '') out.pop()
  return out
}

export class RawError extends Error {
  line: number
  constructor(line: number, message: string) { super(`Line ${line}: ${message}`); this.line = line }
}

const ORDER = ['BUS', 'LOAD', 'GENERATOR', 'BRANCH', 'TRANSFORMER', 'AREA', ...SECTIONS_AFTER_AREA, 'ZONE', ...SECTIONS_AFTER_ZONE]

export function readRaw(text: string): CaseData {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const head = tokens(lines[0] ?? '')
  if (head.length < 2) throw new RawError(1, 'expected the case identification record "IC, SBASE, REV, ..."')
  const rev = Number(head[2] ?? 30)
  if (rev && rev !== 30 && rev !== 26) throw new RawError(1, `RAW revision ${rev}; this reader handles 26/30 layouts`)
  const c: CaseData = {
    title: [lines[1]?.trimEnd() ?? '', lines[2]?.trimEnd() ?? ''], sbase: Number(head[1]), frequency: Number(head[5] ?? 60),
    buses: [], loads: [], generators: [], branches: [], transformers: [], shunts: [], areas: [], zones: [], rawExtras: {},
  }
  // group record lines by section
  const sections: Record<string, { n: number; text: string }[]> = {}
  let si = 0
  for (let i = 3; i < lines.length; i++) {
    const line = lines[i]
    if (/^\s*Q\s*$/.test(line)) break
    if (line.trim() === '') continue
    if (/^\s*0\s*(\/.*)?$/.test(line) || /^\s*0\s*,?\s*$/.test(line)) { si++; continue }
    const name = ORDER[si]
    if (!name) throw new RawError(i + 1, 'data after the last known section')
    ;(sections[name] ??= []).push({ n: i + 1, text: line })
  }
  const N = (t: string[], i: number, d = 0) => (t[i] === undefined || t[i] === '' ? d : Number(t[i]))
  const S = (t: string[], i: number, d = '1') => (t[i] === undefined ? d : t[i].trim())
  const check = (t: string[], need: number, n: number, what: string) => {
    if (t.length < need) throw new RawError(n, `${what} record has ${t.length} fields, expected at least ${need}`)
  }
  /** After building a record: any numeric field that did not parse names the line and the field. */
  const numeric = <T extends object>(row: T, n: number, what: string): T => {
    for (const [k, v] of Object.entries(row)) if (typeof v === 'number' && Number.isNaN(v)) throw new RawError(n, `${what} field ${k.toUpperCase()} is not a number`)
    return row
  }

  for (const { n, text } of sections.BUS ?? []) {
    const t = tokens(text); check(t, 3, n, 'bus')
    const b: Bus = numeric({ id: N(t, 0), name: S(t, 1, ''), baseKv: N(t, 2), type: N(t, 3, 1) as Bus['type'], area: N(t, 6, 1),
      zone: N(t, 7, 1), vm: N(t, 8, 1), va: N(t, 9), owner: N(t, 10, 1), vn: 0.95, vx: 1.05, vl: 0.9, vh: 1.1 } as Bus, n, 'bus')
    c.buses.push(b)
    const gl = N(t, 4), bl = N(t, 5)
    if (gl !== 0 || bl !== 0) c.shunts.push({ bus: b.id, id: '1', g: gl, b: bl, status: 1 } as Shunt)
  }
  for (const { n, text } of sections.LOAD ?? []) {
    const t = tokens(text); check(t, 7, n, 'load')
    c.loads.push(numeric({ bus: N(t, 0), id: S(t, 1), status: N(t, 2, 1) as 0 | 1, area: N(t, 3, 1), zone: N(t, 4, 1), pl: N(t, 5), ql: N(t, 6),
      ip: N(t, 7), iq: N(t, 8), yp: N(t, 9), yq: N(t, 10), owner: N(t, 11, 1) } as Load, n, 'load'))
  }
  for (const { n, text } of sections.GENERATOR ?? []) {
    const t = tokens(text); check(t, 7, n, 'generator')
    c.generators.push(numeric({ bus: N(t, 0), id: S(t, 1), pg: N(t, 2), qg: N(t, 3), qmax: N(t, 4, 9999), qmin: N(t, 5, -9999), vs: N(t, 6, 1),
      ireg: N(t, 7), mbase: N(t, 8, c.sbase), zr: N(t, 9), zx: N(t, 10, 1), rt: N(t, 11), xt: N(t, 12), gtap: N(t, 13, 1),
      status: N(t, 14, 1) as 0 | 1, rmpct: N(t, 15, 100), pmax: N(t, 16, 9999), pmin: N(t, 17, -9999), o1: N(t, 18, 1), f1: N(t, 19, 1),
      cost1: 0, cost2: 0 } as Generator, n, 'generator'))
  }
  for (const { n, text } of sections.BRANCH ?? []) {
    const t = tokens(text); check(t, 5, n, 'branch')
    c.branches.push(numeric({ from: N(t, 0), to: Math.abs(N(t, 1)), ckt: S(t, 2), r: N(t, 3), x: N(t, 4), b: N(t, 5), rateA: N(t, 6),
      rateB: N(t, 7), rateC: N(t, 8), gi: N(t, 9), bi: N(t, 10), gj: N(t, 11), bj: N(t, 12), status: N(t, 13, 1) as 0 | 1,
      len: N(t, 14), o1: N(t, 15, 1), f1: N(t, 16, 1) } as Branch, n, 'branch'))
  }
  const tx = sections.TRANSFORMER ?? []
  const winding = (t: string[]): Winding => ({ windv: N(t, 0, 1), nomv: N(t, 1), ang: N(t, 2), rateA: N(t, 3), rateB: N(t, 4),
    rateC: N(t, 5), cod: N(t, 6), cont: N(t, 7), rma: N(t, 8, 1.1), rmi: N(t, 9, 0.9), vma: N(t, 10, 1.1), vmi: N(t, 11, 0.9),
    ntp: N(t, 12, 33), tab: N(t, 13), cr: N(t, 14), cx: N(t, 15) })
  for (let i = 0; i < tx.length;) {
    const t1 = tokens(tx[i].text)
    const k = N(t1, 2)
    const nLines = k === 0 ? 4 : 5
    if (i + nLines > tx.length) throw new RawError(tx[i].n, `transformer record needs ${nLines} lines`)
    const t2 = tokens(tx[i + 1].text)
    const tr: Transformer = { from: N(t1, 0), to: N(t1, 1), k, ckt: S(t1, 3), cw: N(t1, 4, 1), cz: N(t1, 5, 1), cm: N(t1, 6, 1),
      mag1: N(t1, 7), mag2: N(t1, 8), nmetr: N(t1, 9, 2), name: S(t1, 10, ''), status: N(t1, 11, 1) as 0 | 1, o1: N(t1, 12, 1),
      f1: N(t1, 13, 1), r12: N(t2, 0), x12: N(t2, 1), sbase12: N(t2, 2, c.sbase), r23: N(t2, 3), x23: N(t2, 4),
      sbase23: N(t2, 5, c.sbase), r31: N(t2, 6), x31: N(t2, 7), sbase31: N(t2, 8, c.sbase), vmstar: N(t2, 9, 1), anstar: N(t2, 10),
      windings: [] }
    if (k === 0) {
      const t4 = tokens(tx[i + 3].text)
      tr.windings = [winding(tokens(tx[i + 2].text)), bareWinding(N(t4, 0, 1), N(t4, 1))]
    } else {
      tr.windings = [2, 3, 4].map((j) => winding(tokens(tx[i + j].text)))
    }
    c.transformers.push(numeric(tr, tx[i].n, 'transformer'))
    i += nLines
  }
  for (const { text } of sections.AREA ?? []) {
    const t = tokens(text)
    c.areas.push({ id: N(t, 0), isw: N(t, 1), pdes: N(t, 2), ptol: N(t, 3, 10), name: S(t, 4, '') } as Area)
  }
  for (const { text } of sections.ZONE ?? []) { const t = tokens(text); c.zones.push({ id: N(t, 0), name: S(t, 1, '') } as Zone) }
  for (const s of [...SECTIONS_AFTER_AREA, ...SECTIONS_AFTER_ZONE]) {
    if (sections[s]?.length) c.rawExtras![s] = sections[s].map((l) => l.text)
  }
  if (Object.keys(c.rawExtras!).length === 0) delete c.rawExtras
  return c
}

// ---------------------------------------------------------------------------------------------- side files
// Assumed layouts (the real side files have not been seen yet): one comma-separated record per line, '#' comments.
//   *_Volts.txt   bus, VN, VX, VL, VH            (pu)
//   *_Costs.txt   bus, id, cost1, cost2          ($/MWh, $/MWh²)

export function writeVolts(c: CaseData): string {
  return ['# bus, VN (pu), VX (pu), VL (pu), VH (pu)',
    ...c.buses.map((b) => join([b.id, num(b.vn, 4), num(b.vx, 4), num(b.vl, 4), num(b.vh, 4)]))].join('\n') + '\n'
}
export function writeCosts(c: CaseData): string {
  return ['# bus, id, cost1 ($/MWh), cost2 ($/MWh^2)',
    ...c.generators.map((g) => join([g.bus, q(g.id), num(g.cost1, 4), num(g.cost2, 5)]))].join('\n') + '\n'
}

export type SideFileResult = { data: CaseData; applied: number; unknown: string[] }

function sideLines(text: string) {
  return text.replace(/\r\n?/g, '\n').split('\n').map((l, i) => ({ n: i + 1, t: l.replace(/#.*/, '').trim() })).filter((l) => l.t)
}

export function applyVolts(c: CaseData, text: string): SideFileResult {
  const data: CaseData = JSON.parse(JSON.stringify(c))
  let applied = 0
  const unknown: string[] = []
  for (const { n, t } of sideLines(text)) {
    const v = tokens(t).map(Number)
    if (v.length < 3 || v.some(Number.isNaN)) throw new RawError(n, 'expected "bus, VN, VX[, VL, VH]"')
    const b = data.buses.find((x) => x.id === v[0])
    if (!b) { unknown.push(`bus ${v[0]}`); continue }
    b.vn = v[1]; b.vx = v[2]; if (v.length >= 5) { b.vl = v[3]; b.vh = v[4] }
    applied++
  }
  return { data, applied, unknown }
}

export function applyCosts(c: CaseData, text: string): SideFileResult {
  const data: CaseData = JSON.parse(JSON.stringify(c))
  let applied = 0
  const unknown: string[] = []
  for (const { n, t } of sideLines(text)) {
    const v = tokens(t)
    if (v.length < 3) throw new RawError(n, 'expected "bus, id, cost1[, cost2]"')
    const g = data.generators.find((x) => x.bus === Number(v[0]) && x.id === v[1].trim())
    if (!g) { unknown.push(`generator ${v[0]}-${v[1].trim()}`); continue }
    g.cost1 = Number(v[2]); g.cost2 = Number(v[3] ?? 0)
    applied++
  }
  return { data, applied, unknown }
}
