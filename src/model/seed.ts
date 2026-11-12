// The demo case: a mock 17-bus system built on the public IEEE 14-bus test case, plus bus 15 (a 34.5 kV load bus
// between 7 and 9), bus 16 (a 34.5 kV substation fed from 41), bus 41 (bus 4 split by a near-zero-impedance tie),
// and a three-winding transformer 4–7–9 whose star point shows on the diagram. Every number is illustrative.
import { bareWinding } from './types'
import type { Branch, Bus, CaseData, Generator, Load, Transformer, Winding } from './types'

const bus = (id: number, kv: number, type: Bus['type'], area: number, vm: number, va: number): Bus => ({
  id, name: `Bus ${id}`, baseKv: kv, type, area, zone: 1, vm, va, owner: 0,
  vn: 0.95, vx: kv >= 100 ? 1.06 : 1.05, vl: 0.9, vh: 1.1,
})

const load = (b: number, pl: number, ql: number, area: number): Load => ({
  bus: b, id: '1', status: 1, area, zone: 1, pl, ql, ip: 0, iq: 0, yp: 0, yq: 0, owner: 0,
})

const gen = (b: number, pg: number, qg: number, qmax: number, qmin: number, vs: number, pmax: number, pmin: number, cost1: number, cost2: number): Generator => ({
  bus: b, id: '1', pg, qg, qmax, qmin, vs, ireg: 0, mbase: 100, zr: 0, zx: 1, rt: 0, xt: 0, gtap: 1, status: 1, rmpct: 100,
  pmax, pmin, o1: 1, f1: 1, cost1, cost2,
})

const line = (from: number, to: number, r: number, x: number, b: number, a: number, bb: number, c: number): Branch => ({
  from, to, ckt: '1', r, x, b, rateA: a, rateB: bb, rateC: c, gi: 0, bi: 0, gj: 0, bj: 0, status: 1, len: 0, o1: 1, f1: 1,
})

const w = (windv: number, nomv: number, a: number, b: number, c: number): Winding => ({
  windv, nomv, ang: 0, rateA: a, rateB: b, rateC: c, cod: 0, cont: 0, rma: 1.1, rmi: 0.9, vma: 1.1, vmi: 0.9, ntp: 33, tab: 0, cr: 0, cx: 0,
})

const tx2 = (from: number, to: number, x: number, tap: number, nomv1: number, nomv2: number, rate: number): Transformer => ({
  from, to, k: 0, ckt: '1', cw: 1, cz: 1, cm: 1, mag1: 0, mag2: 0, nmetr: 2, name: `T ${from}-${to}`, status: 1, o1: 1, f1: 1,
  r12: 0, x12: x, sbase12: 100, r23: 0, x23: 0, sbase23: 100, r31: 0, x31: 0, sbase31: 100, vmstar: 1, anstar: 0,
  windings: [w(tap, nomv1, rate, rate * 1.15, rate * 1.3), bareWinding(1, nomv2)],
})

export function seedCase(): CaseData {
  const buses: Bus[] = [
    bus(1, 115, 3, 1, 1.06005, 0),
    bus(2, 115, 2, 1, 1.04499, -2.81),
    bus(3, 115, 2, 1, 1.00999, -9.29),
    bus(4, 115, 1, 1, 1.01690, -7.90),
    bus(5, 115, 1, 1, 1.02160, -6.74),
    bus(6, 34.5, 2, 2, 1.03997, -12.40),
    bus(7, 34.5, 1, 2, 1.04997, -11.60),
    bus(8, 34.5, 2, 2, 1.06625, -9.80),
    bus(9, 34.5, 1, 2, 1.04153, -13.81),
    bus(10, 34.5, 1, 2, 1.03801, -13.28),
    bus(11, 34.5, 1, 2, 1.03557, -12.99),
    bus(12, 34.5, 1, 2, 1.02602, -13.34),
    bus(13, 34.5, 1, 2, 1.02205, -13.49),
    bus(14, 34.5, 1, 2, 1.01465, -14.72),
    bus(15, 34.5, 1, 2, 1.04631, -13.07),
    bus(16, 34.5, 1, 2, 1.04322, -12.58),
    bus(41, 115, 1, 1, 1.01690, -7.90),
  ]
  const loads: Load[] = [
    load(2, 21.7, 12.7, 1), load(3, 94.2, 19.0, 1), load(4, 47.8, -3.9, 1), load(5, 7.6, 1.6, 1),
    load(6, 11.2, 7.5, 2), load(9, 29.5, 16.6, 2), load(10, 9.0, 5.8, 2), load(11, 3.5, 1.8, 2),
    load(12, 6.1, 1.6, 2), load(13, 13.5, 5.8, 2), load(14, 14.9, 5.0, 2), load(15, 12.9, 4.0, 2),
  ]
  const generators: Generator[] = [
    gen(1, 150.343, 0.91, 30, -20, 1.06, 242.4, 0, 20, 0.02),
    gen(2, 90.007, 18.841, 50, -40, 1.045, 100, 0, 35, 0.05),
    gen(3, 20.001, 17.533, 40, 0, 1.01, 120, 0, 40, 0.06),
    gen(8, 19.995, 10.166, 24, -6, 1.05, 50, 0, 45, 0.1),
  ]
  const branches: Branch[] = [
    line(1, 2, 0.01938, 0.05917, 0.0528, 211, 242.4, 279),
    line(1, 5, 0.05403, 0.22304, 0.0492, 211, 242.4, 279),
    line(2, 3, 0.04699, 0.19797, 0.0438, 80, 88, 96),
    line(2, 4, 0.05811, 0.17632, 0.034, 67, 79, 90),
    line(2, 5, 0.05695, 0.17388, 0.0346, 65, 75, 86),
    line(3, 41, 0.06701, 0.17103, 0.0128, 67, 79, 90),
    line(4, 41, 0, 0.0001, 0, 65, 75, 86),
    line(41, 5, 0.01335, 0.04211, 0, 82.6, 95, 109),
    line(6, 11, 0.09498, 0.1989, 0, 23.5, 27, 31),
    line(6, 12, 0.12291, 0.25581, 0, 23.5, 27, 31),
    line(6, 13, 0.06615, 0.13027, 0, 23.5, 27, 31),
    line(7, 8, 0, 0.17615, 0, 50, 57, 64),
    line(7, 15, 0, 0.11001, 0, 36.9, 42.5, 49),
    line(15, 9, 0.0158, 0.042, 0, 36.9, 42.5, 49),
    line(9, 10, 0.03181, 0.0845, 0, 23.5, 27, 31),
    line(9, 14, 0.12711, 0.27038, 0, 23.5, 27, 31),
    line(10, 11, 0.08205, 0.19207, 0, 23.5, 27, 31),
    line(12, 13, 0.22092, 0.19988, 0, 23.5, 27, 31),
    line(13, 14, 0.17093, 0.34802, 0, 23.5, 27, 31),
    line(16, 10, 0.0412, 0.1452, 0, 45, 52, 60),
  ]
  const star: Transformer = {
    from: 4, to: 7, k: 9, ckt: '1', cw: 1, cz: 1, cm: 1, mag1: 0, mag2: 0, nmetr: 2, name: 'T 4-7-9', status: 1, o1: 1, f1: 1,
    r12: 0, x12: 0.20912, sbase12: 100, r23: 0, x23: 0.11001, sbase23: 100, r31: 0, x31: 0.55618, sbase31: 100,
    vmstar: 1.0, anstar: -10,
    windings: [w(0.978, 115, 65, 75, 86), w(1, 34.5, 50, 57, 64), w(0.969, 34.5, 50, 57, 64)],
  }
  const transformers: Transformer[] = [
    tx2(5, 6, 0.25202, 0.932, 115, 34.5, 65),
    tx2(41, 16, 0.1820, 0.985, 115, 34.5, 40),
    star,
  ]
  return {
    title: ['MOCK 17-BUS TEST SYSTEM (IEEE 14-BUS BASED)', 'OPF WORKBENCH DEMO DATA, NOT A REAL NETWORK'],
    sbase: 100,
    frequency: 60,
    buses, loads, generators, branches, transformers,
    shunts: [{ bus: 9, id: '1', g: 0, b: 19.0, status: 1 }],
    areas: [{ id: 1, isw: 1, pdes: 0, ptol: 10, name: 'HV 115 kV' }, { id: 2, isw: 8, pdes: 0, ptol: 10, name: 'MV 34.5 kV' }],
    zones: [{ id: 1, name: 'Zone 1' }],
  }
}
