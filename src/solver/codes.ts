// Solver status codes -> messages a researcher can act on. The numbers are placeholders shaped like the codes the
// existing tool prints (e.g. 403); replace the table with the real engine's list when it is known.
import { labelOf } from '../model/types'
import type { CaseData } from '../model/types'
import { FIELD_LABEL } from '../model/ops'
import type { SolverOutput } from './interface'

export const CODES: Record<number, { title: string; advice: string }> = {
  0: { title: 'Optimal', advice: '' },
  1: { title: 'Solved with limit violations', advice: 'The case solved but at least one limit is exceeded; see the worst constraint.' },
  401: { title: 'Input could not be read', advice: 'Re-export the case; the solver input is malformed.' },
  402: { title: 'No reference bus', advice: 'Pick a reference bus: select a generator bus and use "Make reference bus".' },
  403: { title: 'Inconsistent unit limit', advice: 'A minimum is above its maximum, or the two are equal. Fix the field named below; for negative values the minimum is the more negative number.' },
  404: { title: 'Islanded bus', advice: 'The bus has no in-service path to the reference bus. Re-enable a branch or take the bus out of service.' },
  405: { title: 'Inconsistent voltage limits', advice: 'VN is above VX on the bus named below.' },
  410: { title: 'Power flow did not converge', advice: 'The largest mismatch was at the bus named below. Check its load, nearby impedances and Q limits, or raise the iteration limit.' },
  411: { title: 'Singular Jacobian', advice: 'Usually an islanded or zero-impedance part of the network. Check the validation warnings.' },
  420: { title: 'Load cannot be served', advice: 'Total load is outside the in-service units\' P range. Enable units or raise P max.' },
}

export type Translated = { title: string; message: string; advice: string; element?: string; field?: string }

export function translate(out: Pick<SolverOutput, 'code' | 'detail'>, c?: CaseData): Translated {
  const info = CODES[out.code] ?? { title: `Unknown solver code ${out.code}`, advice: 'Not in the code table; see the log.' }
  const el = out.detail?.element
  const field = out.detail?.field
  const where = el ? `${labelOf(el, c)}${field ? `, field ${FIELD_LABEL[field] ?? field}` : ''}` : ''
  const value = out.detail?.value !== undefined ? ` (value ${out.detail.value})` : ''
  return {
    title: `${info.title} (code ${out.code})`,
    message: where ? `${where}${value}.` : 'The solver did not name an element.',
    advice: info.advice, element: el, field,
  }
}
