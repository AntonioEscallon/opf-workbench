// The solver contract. The real AC OPF engine plugs in behind `Solver`; the workbench only depends on this file.
//
//   input   SolverInput: a self-contained JSON snapshot of one case version (+ scenario overrides already applied),
//           in physical units, plus the objective and settings. Download it from any run ("Solver input").
//   output  SolverOutput: per-bus, per-generator and per-branch results plus a summary, an iteration log and a
//           numeric status code. The workbench translates codes into messages (codes.ts); the solver only has to
//           say which element and field a code refers to, when it knows.
//
// An external engine (a CLI or a service) is wrapped by an adapter that writes SolverInput as JSON, runs the engine,
// and parses its files into SolverOutput. The adapter is the only part that needs to know the engine's formats.
import type { CaseData } from '../model/types'

export type Objective = 'economic_dispatch' | 'max_q_reserve' | 'manage_voltage' | 'min_generation'
  | 'transfer_limit' | 'max_loadability' | 'custom'

export const OBJECTIVES: { id: Objective; label: string; short: string; family: string; description: string }[] = [
  { id: 'economic_dispatch', label: 'Economic Dispatch', short: 'ED', family: 'OPF', description: 'Minimize total generation cost subject to network and unit limits.' },
  { id: 'max_q_reserve', label: 'Maximize Reactive Power Reserves', short: 'Q reserve', family: 'OQF', description: 'Keep regulating units as far from their Q limits as possible.' },
  { id: 'manage_voltage', label: 'Manage Extreme Voltages', short: 'Voltage', family: 'MV', description: 'Pull bus voltages toward the middle of their bands.' },
  { id: 'min_generation', label: 'Minimize Total Real Power Generation', short: 'Min gen', family: 'OPF', description: 'Equal costs: equivalent to minimizing losses.' },
  { id: 'transfer_limit', label: 'Determine Transfer Limits', short: 'Transfer', family: 'OLD', description: 'Scale area-2 load until a limit binds; report the multiplier.' },
  { id: 'max_loadability', label: 'Maximize Loadability', short: 'Loadability', family: 'OLD', description: 'Scale all load until a limit binds; report the multiplier.' },
  { id: 'custom', label: 'Custom', short: 'Custom', family: 'OPF', description: 'Placeholder for user-defined objectives (runs as Economic Dispatch in the stub).' },
]
export const objectiveLabel = (o: Objective) => { const x = OBJECTIVES.find((y) => y.id === o)!; return `${x.label} (${x.family})` }

export interface SolverSettings {
  tolerance: number            // pu mismatch
  maxIterations: number        // per power-flow solve
  enforceQLimits: boolean
  rate: 'A' | 'B' | 'C'        // branch limit used
  zeroImpedance: number        // pu: |R| and |X| at or below -> tie
}
export const DEFAULT_SETTINGS: SolverSettings = { tolerance: 1e-6, maxIterations: 20, enforceQLimits: true, rate: 'A', zeroImpedance: 1e-4 }

export interface SolverInput {
  format: 'opf-workbench/solver-input@1'
  case: CaseData
  objective: Objective
  settings: SolverSettings
  meta: { run: number; version: number; scenario?: number; hash: string }
}

export interface BusResult { id: number; vm: number; va: number; osV: number; osP: number; osQ: number; price: number }
export interface GenResult { bus: number; id: string; pg: number; qg: number; osP: number; osQ: number; cost: number; revenue: number; profit: number }
export interface BranchResult { element: string; pFrom: number; qFrom: number; pTo: number; qTo: number; loss: number; loadingPct: number; rating: number }

export interface Summary {
  objectiveValue: number
  objectiveUnit: string
  mismatch: number             // pu, root of sum of squared P and Q mismatches
  iterations: number
  genP: number; genQ: number; loadP: number; loadQ: number
  lineLossP: number; lineLossQ: number; txLossP: number; txLossQ: number
  shuntQ: number               // Mvar (negative = supplied by capacitors)
  genCost: number; genRevenue: number; loadCharge: number; surplus: number
  minVm: number; minVmBus: number; maxVm: number; maxVmBus: number
  worst: { element: string; text: string; margin: number } | null
  violations: number
  loadability?: number
  lambda: number               // system marginal price, $/MWh
}

export interface SolverOutput {
  status: 'optimal' | 'limits_violated' | 'failed'
  code: number
  detail?: { element?: string; field?: string; value?: number }
  log: string[]
  buses: BusResult[]
  generators: GenResult[]
  branches: BranchResult[]
  summary: Summary | null
}

export interface Solver {
  name: string
  version: string
  solve(input: SolverInput): SolverOutput
}
