// The in-browser stand-in for the database (db/schema.sql): immutable case versions, scenarios as overrides on a
// version, sweeps that generate scenarios, and runs that point at the exact version + overrides they used.
// State is kept in localStorage so a demo survives a reload; "Reset demo data" rebuilds it from the seed.
import { useSyncExternalStore } from 'react'
import { applyCosts, applyVolts, readRaw, writeCosts, writeRaw, writeVolts } from './model/raw'
import { seedCase } from './model/seed'
import { applyPatches, convertToFixedPQ, sweepSteps } from './model/ops'
import type { Change } from './model/ops'
import { validate } from './model/validate'
import type { Issue, Patch } from './model/validate'
import type { CaseData } from './model/types'
import { DEFAULT_SETTINGS } from './solver/interface'
import type { Objective, SolverInput, SolverOutput, SolverSettings } from './solver/interface'
import { stubSolver } from './solver/stub'

export type Source = 'import' | 'edit' | 'bulk_edit' | 'operation' | 'side_file' | 'fix'
export interface Version { num: number; parent: number | null; note: string; source: Source; created: string; data: CaseData }
export interface Scenario { num: number; name: string; base: number; patches: Patch[]; notes: string[]; sweep?: number; sweepValue?: number; created: string }
export interface Sweep {
  num: number; name: string; element: string; parameter: 'power_factor'; from: number; to: number; step: number
  producing: boolean; absorbing: boolean; base: number; objective: Objective; scenarios: number[]; created: string
}
export type RunStatus = 'queued' | 'running' | 'optimal' | 'limits_violated' | 'failed'
export interface Run {
  num: number; version: number; scenario?: number; sweep?: number; sweepValue?: number
  objective: Objective; settings: SolverSettings; patches: Patch[]; hash: string; solver: string
  status: RunStatus; queued: string; started?: string; finished?: string
  shown: number            // log lines revealed so far (progress view)
  output?: SolverOutput
  note?: string
}
export interface State { caseName: string; versions: Version[]; scenarios: Scenario[]; sweeps: Sweep[]; runs: Run[]; layout: Record<string, { x: number; y: number }> }

const KEY = 'opf-workbench/state@1'
const now = () => new Date().toISOString()

// ------------------------------------------------------------------------------------------------ hashing

export function hash(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) }
  return (h >>> 0).toString(16).padStart(8, '0')
}

// ------------------------------------------------------------------------------------------------ state

let state: State = load() ?? seedState()
const listeners = new Set<() => void>()
let saveTimer: ReturnType<typeof setTimeout> | undefined

function load(): State | null {
  try { const raw = localStorage.getItem(KEY); return raw ? JSON.parse(raw) : null } catch { return null }
}
function persist() {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => { try { localStorage.setItem(KEY, JSON.stringify(state)) } catch { /* storage full or blocked: demo keeps working */ } }, 300)
}
function set(next: State) { state = next; listeners.forEach((l) => l()); persist() }
const subscribe = (l: () => void) => { listeners.add(l); return () => listeners.delete(l) }

export function useStore(): State { return useSyncExternalStore(subscribe, () => state) }
export const getState = () => state

// ------------------------------------------------------------------------------------------------ queries

export const head = (s = state) => s.versions[s.versions.length - 1]
export const version = (num: number, s = state) => s.versions.find((v) => v.num === num)
export const scenario = (num: number, s = state) => s.scenarios.find((x) => x.num === num)
export const run = (num: number, s = state) => s.runs.find((r) => r.num === num)
export const sweep = (num: number, s = state) => s.sweeps.find((x) => x.num === num)

const resolved = new Map<string, CaseData>()
/** The case data of a version, or of a scenario applied on its base version (memoized per scenario contents). */
export function resolve(target: Target, s = state): CaseData | null {
  if (target.kind === 'version') return version(target.num, s)?.data ?? null
  const sc = scenario(target.num, s)
  if (!sc) return null
  const base = version(sc.base, s)
  if (!base) return null
  const k = `${sc.base}|${JSON.stringify(sc.patches)}`
  if (!resolved.has(k)) resolved.set(k, applyPatches(base.data, sc.patches))
  return resolved.get(k)!
}
const issueCache = new WeakMap<CaseData, Issue[]>()
export function issuesOf(data: CaseData): Issue[] {
  if (!issueCache.has(data)) issueCache.set(data, validate(data))
  return issueCache.get(data)!
}
export function runInput(r: Run, s = state): SolverInput {
  const base = version(r.version, s)!.data
  return { format: 'opf-workbench/solver-input@1', case: applyPatches(base, r.patches), objective: r.objective, settings: r.settings,
    meta: { run: r.num, version: r.version, scenario: r.scenario, hash: r.hash } }
}
export const runData = (r: Run) => applyPatches(version(r.version)!.data, r.patches)

// ------------------------------------------------------------------------------------------------ edits

export type Target = { kind: 'version'; num: number } | { kind: 'scenario'; num: number }

/** Commit a change: on the latest version it becomes a new version; on a scenario it adds overrides. */
export function commit(target: Target, change: Change, source: Source = 'edit'): Target {
  if (target.kind === 'scenario') {
    set({ ...state, scenarios: state.scenarios.map((x) => x.num === target.num
      ? { ...x, patches: [...x.patches, ...change.patches], notes: [...x.notes, change.note] } : x) })
    return target
  }
  const h = head()
  const v: Version = { num: h.num + 1, parent: h.num, note: change.note, source, created: now(), data: applyPatches(h.data, change.patches) }
  set({ ...state, versions: [...state.versions, v] })
  return { kind: 'version', num: v.num }
}

export function addVersion(data: CaseData, note: string, source: Source): number {
  const h = head()
  const v: Version = { num: h.num + 1, parent: h.num, note, source, created: now(), data }
  set({ ...state, versions: [...state.versions, v] })
  return v.num
}

export function restoreVersion(num: number): number {
  const v = version(num)!
  return addVersion(v.data, `Restored v${num}`, 'edit')
}

export function createScenario(name: string, base: number, change?: Change): number {
  const num = Math.max(0, ...state.scenarios.map((x) => x.num)) + 1
  const sc: Scenario = { num, name, base, patches: change?.patches ?? [], notes: change ? [change.note] : [], created: now() }
  set({ ...state, scenarios: [...state.scenarios, sc] })
  return num
}

export function renameScenario(num: number, name: string) {
  set({ ...state, scenarios: state.scenarios.map((x) => (x.num === num ? { ...x, name } : x)) })
}

/** Promote a scenario to a new case version on top of the latest one. */
export function promoteScenario(num: number): number {
  const sc = scenario(num)!
  return addVersion(applyPatches(head().data, sc.patches), `Scenario ${num} “${sc.name}” applied`, 'operation')
}

export function saveLayout(layout: State['layout']) { set({ ...state, layout }) }

// ------------------------------------------------------------------------------------------------ sweeps

export function createSweep(spec: Omit<Sweep, 'num' | 'scenarios' | 'created' | 'name'> & { name?: string }, settings = DEFAULT_SETTINGS): number {
  const num = Math.max(0, ...state.sweeps.map((x) => x.num)) + 1
  const base = version(spec.base)!.data
  const steps = sweepSteps(spec.from, spec.to, spec.step, spec.producing, spec.absorbing)
  const label = spec.element.replace('generator:', 'Generator ').replace('load:', 'Load ')
  const name = spec.name || `${label} power factor ${spec.from.toFixed(2)} → ${spec.to.toFixed(2)}`
  let scNum = Math.max(0, ...state.scenarios.map((x) => x.num))
  const scs: Scenario[] = steps.map((v) => {
    const ch = convertToFixedPQ(base, spec.element, Math.abs(v), v > 0)
    return { num: ++scNum, name: `${label} pf ${Math.abs(v).toFixed(2)} ${v > 0 ? 'producing' : 'absorbing'}`, base: spec.base,
      patches: ch.patches, notes: [ch.note], sweep: num, sweepValue: v, created: now() }
  })
  const sw: Sweep = { ...spec, num, name, scenarios: scs.map((x) => x.num), created: now() }
  set({ ...state, sweeps: [...state.sweeps, sw], scenarios: [...state.scenarios, ...scs] })
  for (const sc of scs) queueRun({ kind: 'scenario', num: sc.num }, spec.objective, settings)
  return num
}

// ------------------------------------------------------------------------------------------------ runs

export function queueRun(target: Target, objective: Objective, settings: SolverSettings = DEFAULT_SETTINGS, note?: string): number {
  const num = Math.max(0, ...state.runs.map((r) => r.num)) + 1
  const sc = target.kind === 'scenario' ? scenario(target.num)! : undefined
  const ver = sc ? sc.base : target.num
  const patches = sc ? sc.patches : []
  const input: SolverInput = { format: 'opf-workbench/solver-input@1', case: applyPatches(version(ver)!.data, patches), objective, settings, meta: { run: num, version: ver, scenario: sc?.num, hash: '' } }
  const r: Run = { num, version: ver, scenario: sc?.num, sweep: sc?.sweep, sweepValue: sc?.sweepValue, objective, settings, patches,
    hash: hash(JSON.stringify({ ...input, meta: undefined })), solver: `${stubSolver.name} ${stubSolver.version}`,
    status: 'queued', queued: now(), shown: 0, note }
  set({ ...state, runs: [...state.runs, r] })
  pump()
  return num
}

function update(num: number, patch: Partial<Run>) { set({ ...state, runs: state.runs.map((r) => (r.num === num ? { ...r, ...patch } : r)) }) }

let busy = false
/** One run at a time: solve, then reveal the iteration log line by line (the progress view). */
function pump() {
  if (busy) return
  const next = state.runs.find((r) => r.status === 'queued')
  if (!next) return
  busy = true
  update(next.num, { status: 'running', started: now() })
  const output = stubSolver.solve(runInput(next))
  const queuedBehind = state.runs.filter((r) => r.status === 'queued').length
  const delay = queuedBehind > 2 ? 8 : 45
  let shown = 0
  update(next.num, { output: { ...output }, shown: 0 })
  const tick = () => {
    shown = Math.min(output.log.length, shown + (queuedBehind > 2 ? 6 : 1))
    if (shown < output.log.length) { update(next.num, { shown }); setTimeout(tick, delay); return }
    update(next.num, { shown, status: output.status, finished: now() })
    busy = false
    setTimeout(pump, 0)
  }
  setTimeout(tick, delay)
}
// resume runs interrupted by a reload
state = { ...state, runs: state.runs.map((r) => (r.status === 'running' ? { ...r, status: 'queued' as const, shown: 0 } : r)) }
setTimeout(pump, 50)

// ------------------------------------------------------------------------------------------------ seed + reset

/** Runs a seed run synchronously (no animation), for the demo history. */
function solvedRun(s: State, num: number, target: Target, objective: Objective, note?: string, minutesAgo = 0): Run {
  const sc = target.kind === 'scenario' ? s.scenarios.find((x) => x.num === target.num) : undefined
  const ver = sc ? sc.base : target.num
  const patches = sc ? sc.patches : []
  const data = applyPatches(s.versions.find((v) => v.num === ver)!.data, patches)
  const input: SolverInput = { format: 'opf-workbench/solver-input@1', case: data, objective, settings: DEFAULT_SETTINGS, meta: { run: num, version: ver, scenario: sc?.num, hash: '' } }
  const output = stubSolver.solve(input)
  const t = new Date(Date.now() - minutesAgo * 60000).toISOString()
  return { num, version: ver, scenario: sc?.num, sweep: sc?.sweep, sweepValue: sc?.sweepValue, objective, settings: DEFAULT_SETTINGS, patches,
    hash: hash(JSON.stringify({ ...input, meta: undefined })), solver: `${stubSolver.name} ${stubSolver.version}`, status: output.status,
    queued: t, started: t, finished: t, shown: output.log.length, output, note }
}

export function seedState(): State {
  const seed = seedCase()
  const ago = (m: number) => new Date(Date.now() - m * 60000).toISOString()
  const v1 = readRaw(writeRaw(seed))
  const v2 = applyVolts(v1, writeVolts(seed)).data
  const v3 = applyCosts(v2, writeCosts(seed)).data
  const s: State = {
    caseName: 'Mock 17-bus test system',
    versions: [
      { num: 1, parent: null, note: 'Imported mock17.raw (17 buses, 12 loads, 4 generators, 20 lines, 3 transformers)', source: 'import', created: ago(240), data: v1 },
      { num: 2, parent: 1, note: 'Applied mock17_Volts.txt: voltage limits for 17 buses', source: 'side_file', created: ago(238), data: v2 },
      { num: 3, parent: 2, note: 'Applied mock17_Costs.txt: costs for 4 generators', source: 'side_file', created: ago(237), data: v3 },
    ],
    scenarios: [], sweeps: [], runs: [], layout: {},
  }
  // scenario 1: the bus-12 load as a fixed P/Q unit, done with the one-click operation
  const c1 = convertToFixedPQ(v3, 'load:12-1', 0.95, false)
  s.scenarios.push({ num: 1, name: 'Bus 12 load as fixed P/Q unit (pf 0.95 absorbing)', base: 3, patches: c1.patches, notes: [c1.note], created: ago(200) })
  // scenario 2: the same unit with its limits typed by hand, P min and P max the wrong way round
  const g = c1.patches.find((p) => p.field === '__row' && p.value)!.value as any
  const c2: Patch[] = [...c1.patches, { element: 'generator:12-1', field: 'pmin', value: -6.0 }, { element: 'generator:12-1', field: 'pmax', value: -6.1 }]
  s.scenarios.push({ num: 2, name: 'Bus 12 unit, limits entered by hand', base: 3, patches: c2, created: ago(190),
    notes: [c1.note, `Generator 12-1: P min ${g.pmin} → −6 MW`, `Generator 12-1: P max ${g.pmax} → −6.1 MW`] })
  s.runs.push(solvedRun(s, 1, { kind: 'version', num: 3 }, 'economic_dispatch', 'Base case', 180))
  s.runs.push(solvedRun(s, 2, { kind: 'scenario', num: 2 }, 'economic_dispatch', undefined, 170))
  s.runs.push(solvedRun(s, 3, { kind: 'scenario', num: 1 }, 'economic_dispatch', undefined, 160))
  // sweep 1: generator 8 as a fixed P/Q unit, power factor 0.95 -> 0.80 both directions
  const steps = sweepSteps(0.95, 0.8, 0.05, true, true)
  const sw: Sweep = { num: 1, name: 'Generator 8-1 power factor 0.95 → 0.80', element: 'generator:8-1', parameter: 'power_factor', from: 0.95, to: 0.8,
    step: 0.05, producing: true, absorbing: true, base: 3, objective: 'economic_dispatch', scenarios: [], created: ago(120) }
  steps.forEach((v, i) => {
    const ch = convertToFixedPQ(v3, 'generator:8-1', Math.abs(v), v > 0)
    const num = 3 + i
    s.scenarios.push({ num, name: `Generator 8-1 pf ${Math.abs(v).toFixed(2)} ${v > 0 ? 'producing' : 'absorbing'}`, base: 3, patches: ch.patches,
      notes: [ch.note], sweep: 1, sweepValue: v, created: ago(120) })
    sw.scenarios.push(num)
  })
  s.sweeps.push(sw)
  sw.scenarios.forEach((scNum, i) => s.runs.push(solvedRun(s, 4 + i, { kind: 'scenario', num: scNum }, 'economic_dispatch', undefined, 119 - i)))
  return s
}

export function resetDemo() { resolved.clear(); set(seedState()) }

// ------------------------------------------------------------------------------------------------ UI state (not persisted except units)

export type Units = 'physical' | 'pu'
export interface UI { selected: string | null; units: Units; target: Target }
let ui: UI = {
  selected: null,
  units: (() => { try { return (localStorage.getItem('opf-workbench/units') as Units) || 'physical' } catch { return 'physical' } })(),
  target: { kind: 'version', num: head().num },
}
const uiListeners = new Set<() => void>()
export function setUI(p: Partial<UI>) {
  ui = { ...ui, ...p }
  if (p.units) try { localStorage.setItem('opf-workbench/units', p.units) } catch { /* ignore */ }
  uiListeners.forEach((l) => l())
}
export function useUI(): UI { return useSyncExternalStore((l) => { uiListeners.add(l); return () => uiListeners.delete(l) }, () => ui) }
export const getUI = () => ui
