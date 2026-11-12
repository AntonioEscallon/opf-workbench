// Stub solver: a stand-in for the AC OPF engine so the workbench can be built and tested end to end.
// It is NOT an optimal power flow. It does: input checks with the engine-style codes -> an equal-incremental-cost
// dispatch of the regulating units -> a Newton-Raphson AC power flow (polar, dense) with Q-limit switching -> loss
// re-dispatch through the reference unit -> marginal prices from finite-difference loss sensitivities.
// Shadow prices (OS V/P/Q) are approximations with an assumed meaning (see the open questions in the README).
import { isFixedPQ, key } from '../model/types'
import type { Bus, CaseData, Generator } from '../model/types'
import type { BranchResult, BusResult, GenResult, Solver, SolverInput, SolverOutput, Summary } from './interface'

type Two = { i: number; j: number; yii: [number, number]; yij: [number, number]; yji: [number, number]; yjj: [number, number]; element: string; rating: number; kind: 'line' | 'tx' }

const cdiv = (a: number, b: number): [number, number] => { const d = a * a + b * b; return [a / d, -b / d] } // 1/(a+jb)

interface Net {
  n: number
  ids: (number | string)[]          // bus id or star label per index
  idx: Map<number, number>
  G: Float64Array; B: Float64Array
  twos: Two[]
  shunt: { i: number; g: number; b: number }[]
}

function buildNet(c: CaseData, zthr: number, rate: 'A' | 'B' | 'C'): Net {
  const live = c.buses.filter((b) => b.type !== 4)
  const ids: (number | string)[] = live.map((b) => b.id)
  const stars = c.transformers.filter((t) => t.status && t.k)
  for (const t of stars) ids.push(`star:${key.tx(t)}`)
  const n = ids.length
  const idx = new Map<number, number>(live.map((b, i) => [b.id, i]))
  const G = new Float64Array(n * n), B = new Float64Array(n * n)
  const twos: Two[] = []
  const rateOf = (o: { rateA: number; rateB: number; rateC: number }) => (rate === 'A' ? o.rateA : rate === 'B' ? o.rateB : o.rateC)
  const add2 = (i: number, j: number, r: number, x: number, bsh: number, tap: number, element: string, rating: number, kind: Two['kind']) => {
    if (Math.abs(r) <= zthr && Math.abs(x) <= zthr) x = zthr // tie: keep it solvable, the warning says it is a tie
    const [g, b] = cdiv(r, x)
    const two: Two = { i, j, element, rating, kind,
      yii: [g / (tap * tap), b / (tap * tap) + bsh / 2], yjj: [g, b + bsh / 2], yij: [-g / tap, -b / tap], yji: [-g / tap, -b / tap] }
    twos.push(two)
    G[i * n + i] += two.yii[0]; B[i * n + i] += two.yii[1]
    G[j * n + j] += two.yjj[0]; B[j * n + j] += two.yjj[1]
    G[i * n + j] += two.yij[0]; B[i * n + j] += two.yij[1]
    G[j * n + i] += two.yji[0]; B[j * n + i] += two.yji[1]
  }
  for (const br of c.branches) {
    if (!br.status || !idx.has(br.from) || !idx.has(br.to)) continue
    add2(idx.get(br.from)!, idx.get(br.to)!, br.r, br.x, br.b, 1, key.branch(br), rateOf(br), 'line')
  }
  for (const t of c.transformers) {
    if (!t.status || !idx.has(t.from) || !idx.has(t.to) || (t.k && !idx.has(t.k))) continue
    const toSys = (z: number, sb: number) => (t.cz === 2 ? z * c.sbase / (sb || c.sbase) : z)
    if (!t.k) {
      const tap = t.windings[0].windv / (t.windings[1].windv || 1)
      add2(idx.get(t.from)!, idx.get(t.to)!, toSys(t.r12, t.sbase12), toSys(t.x12, t.sbase12), 0, tap, key.tx(t), rateOf(t.windings[0]), 'tx')
    } else {
      const s = idx.get(t.k) === undefined ? -1 : ids.indexOf(`star:${key.tx(t)}`)
      const z12 = [toSys(t.r12, t.sbase12), toSys(t.x12, t.sbase12)], z23 = [toSys(t.r23, t.sbase23), toSys(t.x23, t.sbase23)], z31 = [toSys(t.r31, t.sbase31), toSys(t.x31, t.sbase31)]
      const leg = (a: number[], b: number[], cc: number[]) => [(a[0] + b[0] - cc[0]) / 2, (a[1] + b[1] - cc[1]) / 2]
      const legs = [leg(z12, z31, z23), leg(z12, z23, z31), leg(z23, z31, z12)]
      ;[t.from, t.to, t.k].forEach((bus, w) => add2(idx.get(bus)!, s, legs[w][0], legs[w][1], 0, t.windings[w].windv || 1, `${key.tx(t)}#w${w + 1}`, rateOf(t.windings[w]), 'tx'))
    }
  }
  const shunt: Net['shunt'] = []
  for (const sh of c.shunts) {
    const i = idx.get(sh.bus)
    if (!sh.status || i === undefined) continue
    G[i * n + i] += sh.g / c.sbase; B[i * n + i] += sh.b / c.sbase
    shunt.push({ i, g: sh.g / c.sbase, b: sh.b / c.sbase })
  }
  return { n, ids, idx, G, B, twos, shunt }
}

function injections(net: Net, V: Float64Array, T: Float64Array) {
  const { n, G, B } = net
  const P = new Float64Array(n), Q = new Float64Array(n)
  for (let i = 0; i < n; i++) for (let k = 0; k < n; k++) {
    const g = G[i * n + k], b = B[i * n + k]
    if (g === 0 && b === 0) continue
    const d = T[i] - T[k], c = Math.cos(d), s = Math.sin(d)
    P[i] += V[i] * V[k] * (g * c + b * s)
    Q[i] += V[i] * V[k] * (g * s - b * c)
  }
  return { P, Q }
}

/** Dense Gaussian elimination with partial pivoting; null if singular. */
function solveLinear(A: Float64Array, b: Float64Array, m: number): Float64Array | null {
  for (let c = 0; c < m; c++) {
    let p = c
    for (let r = c + 1; r < m; r++) if (Math.abs(A[r * m + c]) > Math.abs(A[p * m + c])) p = r
    if (Math.abs(A[p * m + c]) < 1e-12) return null
    if (p !== c) { for (let k = 0; k < m; k++) { const t = A[c * m + k]; A[c * m + k] = A[p * m + k]; A[p * m + k] = t } const t = b[c]; b[c] = b[p]; b[p] = t }
    for (let r = c + 1; r < m; r++) {
      const f = A[r * m + c] / A[c * m + c]
      if (f === 0) continue
      for (let k = c; k < m; k++) A[r * m + k] -= f * A[c * m + k]
      b[r] -= f * b[c]
    }
  }
  const x = new Float64Array(m)
  for (let r = m - 1; r >= 0; r--) { let s = b[r]; for (let k = r + 1; k < m; k++) s -= A[r * m + k] * x[k]; x[r] = s / A[r * m + r] }
  return x
}

type PF = { ok: boolean; V: Float64Array; T: Float64Array; P: Float64Array; Q: Float64Array; it: number; mismatch: number; worstIdx: number; history: number[]; singular?: boolean }

/** Newton-Raphson. kind: 3 slack, 2 PV, 1 PQ. Pspec/Qspec in pu (net injection). */
function newton(net: Net, kind: Int8Array, Pspec: Float64Array, Qspec: Float64Array, V0: Float64Array, T0: Float64Array, tol: number, maxIt: number): PF {
  const { n, G, B } = net
  const V = Float64Array.from(V0), T = Float64Array.from(T0)
  const pv = [...Array(n).keys()].filter((i) => kind[i] !== 3)
  const pq = [...Array(n).keys()].filter((i) => kind[i] === 1)
  const m = pv.length + pq.length
  const history: number[] = []
  let it = 0, P = new Float64Array(n), Q = new Float64Array(n), mismatch = Infinity, worstIdx = 0
  for (; it <= maxIt; it++) {
    ;({ P, Q } = injections(net, V, T))
    const F = new Float64Array(m)
    let worst = 0
    pv.forEach((i, r) => { F[r] = Pspec[i] - P[i]; if (Math.abs(F[r]) > worst) { worst = Math.abs(F[r]); worstIdx = i } })
    pq.forEach((i, r) => { F[pv.length + r] = Qspec[i] - Q[i]; if (Math.abs(F[pv.length + r]) > worst) { worst = Math.abs(F[pv.length + r]); worstIdx = i } })
    mismatch = Math.sqrt(F.reduce((a, x) => a + x * x, 0))
    history.push(worst)
    if (worst < tol) return { ok: true, V, T, P, Q, it, mismatch, worstIdx, history }
    if (it === maxIt || !Number.isFinite(worst) || worst > 1e3) break
    const J = new Float64Array(m * m)
    const colT = new Map(pv.map((i, c) => [i, c])), colV = new Map(pq.map((i, c) => [i, pv.length + c]))
    const rows: [number, 'P' | 'Q', number][] = [...pv.map((i, r) => [i, 'P', r] as [number, 'P', number]), ...pq.map((i, r) => [i, 'Q', pv.length + r] as [number, 'Q', number])]
    for (const [i, what, r] of rows) {
      for (let k = 0; k < n; k++) {
        const g = G[i * n + k], b = B[i * n + k]
        if (i !== k && g === 0 && b === 0) continue
        const ct = colT.get(k), cv = colV.get(k)
        if (i === k) {
          if (what === 'P') {
            if (ct !== undefined) J[r * m + ct] = -Q[i] - b * V[i] * V[i]
            if (cv !== undefined) J[r * m + cv] = P[i] / V[i] + g * V[i]
          } else {
            if (ct !== undefined) J[r * m + ct] = P[i] - g * V[i] * V[i]
            if (cv !== undefined) J[r * m + cv] = Q[i] / V[i] - b * V[i]
          }
        } else {
          const d = T[i] - T[k], c = Math.cos(d), s = Math.sin(d)
          if (what === 'P') {
            if (ct !== undefined) J[r * m + ct] = V[i] * V[k] * (g * s - b * c)
            if (cv !== undefined) J[r * m + cv] = V[i] * (g * c + b * s)
          } else {
            if (ct !== undefined) J[r * m + ct] = -V[i] * V[k] * (g * c + b * s)
            if (cv !== undefined) J[r * m + cv] = V[i] * (g * s - b * c)
          }
        }
      }
    }
    const dx = solveLinear(J, F, m)
    if (!dx) return { ok: false, V, T, P, Q, it, mismatch, worstIdx, history, singular: true }
    pv.forEach((i, c) => { T[i] += dx[c] })
    pq.forEach((i, c) => { V[i] += dx[pv.length + c] })
  }
  return { ok: false, V, T, P, Q, it, mismatch, worstIdx, history }
}

const fail = (code: number, log: string[], detail?: SolverOutput['detail']): SolverOutput =>
  ({ status: 'failed', code, detail, log: [...log, `ERROR ${code}${detail?.element ? ` ON ${detail.element}${detail.field ? `.${detail.field.toUpperCase()}` : ''}` : ''}`, 'OPTIMIZATION TERMINATED'], buses: [], generators: [], branches: [], summary: null })

const e = (x: number) => x.toExponential(6)

function solveCase(input: SolverInput): SolverOutput {
  const { case: c, settings: st, objective } = input
  const log: string[] = [`STUB SOLVER 0.3  objective=${objective}  tol=${st.tolerance}  maxit=${st.maxIterations}  qlim=${st.enforceQLimits ? 'on' : 'off'}`]
  const sb = c.sbase
  let step = 0

  // ---- input checks (the codes a real engine would return)
  const slackOrNone = c.buses.find((b) => b.type === 3)
  if (!slackOrNone) return fail(402, log)
  const slack: Bus = slackOrNone
  for (const b of c.buses) if (b.type !== 4 && b.vn > b.vx) return fail(405, log, { element: key.bus(b), field: 'vn', value: b.vn })
  const gens = c.generators.filter((g) => g.status && c.buses.some((b) => b.id === g.bus && b.type !== 4))
  for (const g of gens) {
    if (g.pmin > g.pmax) return fail(403, log, { element: key.gen(g), field: 'pmin', value: g.pmin })
    if (g.qmin > g.qmax) return fail(403, log, { element: key.gen(g), field: 'qmin', value: g.qmin })
    if (g.qmin === g.qmax) return fail(403, log, { element: key.gen(g), field: 'qmax', value: g.qmax })
  }
  const net = buildNet(c, st.zeroImpedance, st.rate)
  {
    const adj = new Map<number, number[]>()
    for (const t of net.twos) { adj.set(t.i, [...(adj.get(t.i) ?? []), t.j]); adj.set(t.j, [...(adj.get(t.j) ?? []), t.i]) }
    const s0 = net.idx.get(slack.id)!, seen = new Set([s0]), stack = [s0]
    while (stack.length) for (const k of adj.get(stack.pop()!) ?? []) if (!seen.has(k)) { seen.add(k); stack.push(k) }
    const lost = net.ids.findIndex((_, i) => !seen.has(i))
    if (lost >= 0 && typeof net.ids[lost] === 'number') return fail(404, log, { element: key.bus({ id: net.ids[lost] as number }) })
  }

  const live = c.buses.filter((b) => b.type !== 4)
  const busOf = (id: number) => live.find((b) => b.id === id)!
  const reg = gens.filter((g) => !isFixedPQ(g))
  const fixed = gens.filter((g) => isFixedPQ(g))
  const slackUnits = reg.filter((g) => g.bus === slack.id)
  if (slackUnits.length === 0) return fail(402, log, { element: key.bus(slack) })

  // ---- objective shaping
  let loadScale = 1
  const scaleArea = objective === 'transfer_limit' ? 2 : null
  const costOf = (g: Generator) => (objective === 'min_generation' ? [10, 0.01] : [g.cost1, g.cost2 > 0 ? g.cost2 : 1e-4])
  const vsOf = (g: Generator) => {
    const b = busOf(g.bus)
    return objective === 'manage_voltage' ? Math.min(Math.max(g.vs, b.vn + 0.25 * (b.vx - b.vn)), b.vx - 0.25 * (b.vx - b.vn)) : g.vs
  }

  const loadP = (b: Bus) => c.loads.filter((l) => l.bus === b.id && l.status).reduce((a, l) => a + l.pl * (scaleArea === null || b.area === scaleArea ? loadScale : 1), 0)
  const loadQ = (b: Bus) => c.loads.filter((l) => l.bus === b.id && l.status).reduce((a, l) => a + l.ql * (scaleArea === null || b.area === scaleArea ? loadScale : 1), 0)

  /** Equal incremental cost dispatch of the regulating units for a demand (MW). */
  function dispatch(demand: number): { pg: Map<Generator, number>; lambda: number } | null {
    const lo = reg.reduce((a, g) => a + g.pmin, 0), hi = reg.reduce((a, g) => a + g.pmax, 0)
    if (demand < lo - 1e-6 || demand > hi + 1e-6) return null
    const at = (lam: number) => new Map(reg.map((g) => { const [c1, c2] = costOf(g); return [g, Math.min(g.pmax, Math.max(g.pmin, (lam - c1) / (2 * c2)))] }))
    let a = -1e4, b = 1e5
    for (let k = 0; k < 200; k++) { const m = (a + b) / 2; const s = [...at(m).values()].reduce((x, y) => x + y, 0); if (s < demand) a = m; else b = m }
    return { pg: at(b), lambda: b }
  }

  /** One full solve at the current load scale: dispatch, PF with Q limits, loss redispatch. */
  function solveOnce(record: boolean) {
    const n = net.n
    const totalLoad = live.reduce((a, b) => a + loadP(b), 0) - fixed.reduce((a, g) => a + g.pg, 0)
    let losses = 0.02 * totalLoad
    let pf: PF | null = null
    let disp: ReturnType<typeof dispatch> = null
    let kind = new Int8Array(n)
    let Qspec = new Float64Array(n)
    const Pspec = new Float64Array(n)
    let iterTotal = 0
    for (let outer = 0; outer < 4; outer++) {
      disp = dispatch(totalLoad + losses)
      if (!disp) return { err: 420 as const }
      Pspec.fill(0); Qspec = new Float64Array(n); kind = new Int8Array(n).fill(1)
      const V0 = new Float64Array(n).fill(1), T0 = new Float64Array(n)
      for (const b of live) {
        const i = net.idx.get(b.id)!
        Pspec[i] -= loadP(b) / sb; Qspec[i] -= loadQ(b) / sb
      }
      for (const g of fixed) { const i = net.idx.get(g.bus)!; Pspec[i] += g.pg / sb; Qspec[i] += g.qg / sb }
      for (const g of reg) { const i = net.idx.get(g.bus)!; Pspec[i] += disp.pg.get(g)! / sb; kind[i] = 2; V0[i] = vsOf(g) }
      for (const b of live) { const i = net.idx.get(b.id)!; if (b.type === 1 && kind[i] === 2) kind[i] = 1; if (b.type === 1) V0[i] = 1 }
      // a regulating unit on a PQ-typed bus does not regulate: its Q is fixed at its scheduled value
      for (const g of reg) { const i = net.idx.get(g.bus)!; if (kind[i] === 1) Qspec[i] += g.qg / sb }
      kind[net.idx.get(slack.id)!] = 3
      // Q-limit loop
      let switched = true, guard = 0
      while (switched && guard++ < 6) {
        pf = newton(net, kind, Pspec, Qspec, pf && pf.ok ? pf.V : V0, pf && pf.ok ? pf.T : T0, st.tolerance, st.maxIterations)
        iterTotal += pf.it
        if (record) log.push(...pf.history.map((h, k) => `${String(++step).padStart(4)}  pf    outer=${outer} it=${k}  max|dS|=${e(h)}`))
        if (!pf.ok) return { err: (pf.singular ? 411 : 410) as 410 | 411, worstIdx: pf.worstIdx }
        switched = false
        if (!st.enforceQLimits) break
        for (const b of live) {
          const i = net.idx.get(b.id)!
          if (kind[i] !== 2) continue
          const units = reg.filter((g) => g.bus === b.id)
          const qNeed = pf.Q[i] * sb + loadQ(b) - fixed.filter((g) => g.bus === b.id).reduce((a, g) => a + g.qg, 0)
          const qmax = units.reduce((a, g) => a + g.qmax, 0), qmin = units.reduce((a, g) => a + g.qmin, 0)
          if (qNeed > qmax + 1e-6 || qNeed < qmin - 1e-6) {
            kind[i] = 1
            Qspec[i] = ((qNeed > qmax ? qmax : qmin) - loadQ(b) + fixed.filter((g) => g.bus === b.id).reduce((a, g) => a + g.qg, 0)) / sb
            if (record) log.push(`      qlim  bus ${b.id} at ${qNeed > qmax ? 'Q max' : 'Q min'} (${(qNeed > qmax ? qmax : qmin).toFixed(2)} Mvar): PV -> PQ`)
            switched = true
          }
        }
      }
      const s = net.idx.get(slack.id)!
      const slackActual = pf!.P[s] * sb + loadP(slack) - fixed.filter((g) => g.bus === slack.id).reduce((a, g) => a + g.pg, 0)
      const slackSched = slackUnits.reduce((a, g) => a + disp!.pg.get(g)!, 0)
      const newLosses = losses + (slackActual - slackSched)
      if (record) {
        const cost = reg.reduce((a, g) => { const [c1, c2] = costOf(g); const p = g.bus === slack.id ? disp!.pg.get(g)! + (slackActual - slackSched) / slackUnits.length : disp!.pg.get(g)!; return a + c1 * p + c2 * p * p }, 0)
        log.push(`${String(outer + 1).padStart(4)},0,OPT,0,  ${cost.toFixed(8)},  ${(-(Math.abs(slackActual - slackSched)) / sb).toFixed(9)}`)
      }
      if (Math.abs(newLosses - losses) < 1e-4) { losses = newLosses; break }
      losses = newLosses
    }
    return { pf: pf!, disp: disp!, kind, Pspec, Qspec, iterTotal }
  }

  // ---- loadability scan, or a single solve
  let solved = solveOnce(true)
  let loadability: number | undefined
  const violationsAt = (r: Exclude<typeof solved, { err: number }>) => {
    let v = 0
    for (const b of live) { const vm = r.pf.V[net.idx.get(b.id)!]; if (vm > b.vx + 1e-4 || vm < b.vn - 1e-4) v++ }
    for (const t of net.twos) if (t.rating > 0 && flowMva(t, r.pf, sb) > t.rating * 1.0001) v++
    return v
  }
  if ((objective === 'max_loadability' || objective === 'transfer_limit') && !('err' in solved)) {
    let last = solved
    log.push(`      scan  scaling ${objective === 'transfer_limit' ? 'area-2' : 'all'} load until a limit binds`)
    for (let s = 1.05; s <= 3.0001; s += 0.05) {
      loadScale = +s.toFixed(2)
      const r = solveOnce(false)
      if ('err' in r || violationsAt(r) > violationsAt(solved)) { log.push(`      scan  x${loadScale.toFixed(2)}: ${'err' in r ? `fails (code ${r.err})` : 'limit binds'}`); break }
      log.push(`      scan  x${loadScale.toFixed(2)}: ok`)
      last = r
      loadability = loadScale
    }
    loadability ??= 1
    loadScale = loadability
    solved = last
  }
  if ('err' in solved) {
    const wi = (solved as { worstIdx?: number }).worstIdx
    const id = wi !== undefined ? net.ids[wi] : undefined
    return fail(solved.err as number, log, typeof id === 'number' ? { element: key.bus({ id }) } : undefined)
  }

  const { pf, disp } = solved
  const s = net.idx.get(slack.id)!
  const slackActual = pf.P[s] * sb + loadP(slack) - fixed.filter((g) => g.bus === slack.id).reduce((a, g) => a + g.pg, 0)
  const slackSched = slackUnits.reduce((a, g) => a + disp.pg.get(g)!, 0)

  // ---- generator P/Q
  const genP = new Map<Generator, number>(), genQ = new Map<Generator, number>()
  for (const g of fixed) { genP.set(g, g.pg); genQ.set(g, g.qg) }
  for (const g of reg) genP.set(g, disp.pg.get(g)! + (g.bus === slack.id ? (slackActual - slackSched) / slackUnits.length : 0))
  for (const b of live) {
    const units = reg.filter((g) => g.bus === b.id)
    if (!units.length) continue
    const i = net.idx.get(b.id)!
    const qBus = pf.Q[i] * sb + loadQ(b) - fixed.filter((g) => g.bus === b.id).reduce((a, g) => a + g.qg, 0)
    const range = units.reduce((a, g) => a + (g.qmax - g.qmin), 0)
    const qminSum = units.reduce((a, g) => a + g.qmin, 0)
    const frac = range > 0 ? (qBus - qminSum) / range : 1 / units.length
    for (const g of units) genQ.set(g, range > 0 ? g.qmin + frac * (g.qmax - g.qmin) : qBus / units.length)
  }

  // ---- prices: lambda x d(slack P)/d(load at bus), by finite difference (no redispatch)
  const lambda = disp.lambda
  const sens = (i: number, dP: number, dQ: number) => {
    const Ps = Float64Array.from(solved.Pspec), Qs = Float64Array.from(solved.Qspec)
    Ps[i] -= dP; Qs[i] -= dQ
    const r = newton(net, solved.kind, Ps, Qs, pf.V, pf.T, 1e-9, 15)
    if (!r.ok) return 1
    return (r.P[s] - pf.P[s]) / ((dP || dQ))
  }
  const busRes: BusResult[] = live.map((b) => {
    const i = net.idx.get(b.id)!
    const vm = pf.V[i]
    const dp = i === s ? 1 : sens(i, 0.01, 0)
    const dq = i === s ? 0 : sens(i, 0, 0.01)
    const over = Math.max(0, vm - b.vx, b.vn - vm)
    return { id: b.id, vm, va: (pf.T[i] - pf.T[s]) * 180 / Math.PI + 0, osV: over > 0 ? lambda * over * 50 * Math.sign(vm - b.vx || -1) : 0,
      osP: lambda * dp, osQ: lambda * dq, price: lambda * dp }
  })
  const priceAt = (bus: number) => busRes.find((r) => r.id === bus)?.price ?? lambda

  const genRes: GenResult[] = gens.map((g) => {
    const p = genP.get(g)!, q = genQ.get(g)!
    const [c1, c2] = isFixedPQ(g) ? [0, 0] : [g.cost1, g.cost2]
    const cost = c1 * p + c2 * p * p
    const price = priceAt(g.bus)
    return { bus: g.bus, id: g.id, pg: p, qg: q, osP: price, osQ: busRes.find((r) => r.id === g.bus)!.osQ, cost, revenue: price * p, profit: price * p - cost }
  })

  // ---- branch flows
  const brRes: BranchResult[] = net.twos.map((t) => {
    const { sf, st: stt } = flows(t, pf)
    const mva = Math.max(Math.hypot(sf[0], sf[1]), Math.hypot(stt[0], stt[1])) * sb
    return { element: t.element, pFrom: sf[0] * sb, qFrom: sf[1] * sb, pTo: stt[0] * sb, qTo: stt[1] * sb, loss: (sf[0] + stt[0]) * sb,
      loadingPct: t.rating > 0 ? (mva / t.rating) * 100 : 0, rating: t.rating }
  })

  // ---- summary
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
  const lines = net.twos.map((t, k) => ({ t, r: brRes[k] }))
  const shuntQ = sum(net.shunt.map((x) => -x.b * pf.V[x.i] ** 2 * sb))
  const loadPT = sum(live.map(loadP)), loadQT = sum(live.map(loadQ))
  const loadCharge = sum(live.map((b) => loadP(b) * priceAt(b.id)))
  const genRevenue = sum(genRes.map((g) => g.revenue))
  const vms = busRes.map((b) => b.vm)
  const minI = vms.indexOf(Math.min(...vms)), maxI = vms.indexOf(Math.max(...vms))

  // worst constraint = smallest margin, each normalized to its own scale
  const cands: { element: string; text: string; margin: number }[] = []
  for (const b of live) {
    const vm = busRes.find((r) => r.id === b.id)!.vm
    cands.push({ element: key.bus(b), text: `Bus ${b.id} VM ${vm.toFixed(4)} pu vs VX ${b.vx}`, margin: (b.vx - vm) / 0.05 })
    cands.push({ element: key.bus(b), text: `Bus ${b.id} VM ${vm.toFixed(4)} pu vs VN ${b.vn}`, margin: (vm - b.vn) / 0.05 })
  }
  for (const g of genRes) {
    const u = gens.find((x) => x.bus === g.bus && x.id === g.id)!
    if (isFixedPQ(u)) continue
    cands.push({ element: key.gen(u), text: `Generator ${u.bus}-${u.id} Q ${g.qg.toFixed(2)} vs Q max ${u.qmax} Mvar`, margin: (u.qmax - g.qg) / Math.max(10, u.qmax - u.qmin) })
    cands.push({ element: key.gen(u), text: `Generator ${u.bus}-${u.id} Q ${g.qg.toFixed(2)} vs Q min ${u.qmin} Mvar`, margin: (g.qg - u.qmin) / Math.max(10, u.qmax - u.qmin) })
    cands.push({ element: key.gen(u), text: `Generator ${u.bus}-${u.id} P ${g.pg.toFixed(2)} vs P max ${u.pmax} MW`, margin: (u.pmax - g.pg) / Math.max(10, u.pmax - u.pmin) })
  }
  for (const r of brRes) if (r.rating > 0) cands.push({ element: r.element.split('#')[0], text: `${r.element.replace('#', ' ')} at ${r.loadingPct.toFixed(1)}% of Rate ${st.rate}`, margin: (100 - r.loadingPct) / 100 })
  cands.sort((a, b) => a.margin - b.margin)
  const violations = cands.filter((x) => x.margin < -2e-3).length

  const genPT = sum([...genP.values()]), genQT = sum([...genQ.values()])
  const genCost = sum(genRes.map((g) => g.cost))
  let objectiveValue = genCost, objectiveUnit = '$/h'
  if (objective === 'min_generation') { objectiveValue = genPT; objectiveUnit = 'MW' }
  if (objective === 'max_q_reserve') { objectiveValue = sum(reg.map((g) => g.qmax - genQ.get(g)!)); objectiveUnit = 'Mvar reserve' }
  if (objective === 'manage_voltage') { objectiveValue = sum(live.map((b) => (busRes.find((r) => r.id === b.id)!.vm - (b.vn + b.vx) / 2) ** 2)); objectiveUnit = 'Σ ΔV² (pu²)' }
  if (loadability !== undefined) { objectiveValue = loadability; objectiveUnit = '× load' }

  const summary: Summary = {
    objectiveValue, objectiveUnit, mismatch: pf.mismatch, iterations: solved.iterTotal,
    genP: genPT, genQ: genQT, loadP: loadPT, loadQ: loadQT,
    lineLossP: sum(lines.filter((x) => x.t.kind === 'line').map((x) => x.r.loss)),
    lineLossQ: sum(lines.filter((x) => x.t.kind === 'line').map((x) => x.r.qFrom + x.r.qTo)),
    txLossP: sum(lines.filter((x) => x.t.kind === 'tx').map((x) => x.r.loss)),
    txLossQ: sum(lines.filter((x) => x.t.kind === 'tx').map((x) => x.r.qFrom + x.r.qTo)),
    shuntQ, genCost, genRevenue, loadCharge, surplus: loadCharge - genRevenue,
    minVm: vms[minI], minVmBus: busRes[minI].id, maxVm: vms[maxI], maxVmBus: busRes[maxI].id,
    worst: cands[0] ?? null, violations, loadability, lambda,
  }
  log.push(`      done  mismatch=${e(pf.mismatch)} pu  objective=${e(objectiveValue)} ${objectiveUnit}  violations=${violations}`)
  log.push(violations ? 'OPTIMIZATION COMPLETED WITH LIMIT VIOLATIONS' : 'OPTIMIZATION COMPLETED')
  return { status: violations ? 'limits_violated' : 'optimal', code: violations ? 1 : 0, log, buses: busRes, generators: genRes, branches: brRes, summary }
}

function flows(t: Two, pf: PF) {
  const vi: [number, number] = [pf.V[t.i] * Math.cos(pf.T[t.i]), pf.V[t.i] * Math.sin(pf.T[t.i])]
  const vj: [number, number] = [pf.V[t.j] * Math.cos(pf.T[t.j]), pf.V[t.j] * Math.sin(pf.T[t.j])]
  const mul = (a: [number, number], b: [number, number]): [number, number] => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]]
  const add = (a: [number, number], b: [number, number]): [number, number] => [a[0] + b[0], a[1] + b[1]]
  const Ii = add(mul(t.yii, vi), mul(t.yij, vj)), Ij = add(mul(t.yji, vi), mul(t.yjj, vj))
  const sf = mul(vi, [Ii[0], -Ii[1]]), st = mul(vj, [Ij[0], -Ij[1]])
  return { sf, st }
}
function flowMva(t: Two, pf: PF, sb: number) { const { sf, st } = flows(t, pf); return Math.max(Math.hypot(...sf), Math.hypot(...st)) * sb }

export const stubSolver: Solver = { name: 'Stub solver (dispatch + Newton power flow)', version: '0.3', solve: solveCase }
