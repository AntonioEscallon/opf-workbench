// Run comparison, the main research view: one quantity against the swept parameter (or across any picked runs),
// failed runs marked, and the full table beside it.
import { useRef, useState } from 'react'
import { Header, Shell } from '../App'
import { labelOf } from '../model/types'
import { objectiveLabel } from '../solver/interface'
import { runData, scenario, useStore } from '../store'
import type { Run } from '../store'
import { go, href } from '../router'
import { SweepChart } from '../ui/charts'
import type { SweepPoint } from '../ui/charts'
import { DataTable } from '../ui/DataTable'
import type { TCol } from '../ui/DataTable'
import { downloadPng } from '../ui/export'
import { StatusTag, runTargetLabel, runTitle } from './RunsPage'

type Q = { id: string; label: string; unit: string; get: (r: Run, element?: string) => number | null; digits: number; sweepOnly?: boolean }

const unitBus = (element?: string) => (element ? Number(element.split(':')[1].split('-')[0]) : NaN)
const QUANTITIES: Q[] = [
  { id: 'minVm', label: 'Min VM', unit: 'pu', digits: 4, get: (r) => r.output?.summary?.minVm ?? null },
  { id: 'maxVm', label: 'Max VM', unit: 'pu', digits: 4, get: (r) => r.output?.summary?.maxVm ?? null },
  { id: 'slackQ', label: 'Reference unit QG', unit: 'Mvar', digits: 3, get: (r) => {
    if (!r.output?.summary) return null
    const slack = runData(r).buses.find((b) => b.type === 3)
    return r.output.generators.filter((g) => g.bus === slack?.id).reduce((a, g) => a + g.qg, 0)
  } },
  { id: 'unitVm', label: 'VM at the swept unit\'s bus', unit: 'pu', digits: 4, sweepOnly: true, get: (r, el) => r.output?.buses.find((b) => b.id === unitBus(el))?.vm ?? null },
  { id: 'mismatch', label: 'Power mismatch', unit: 'pu', digits: 8, get: (r) => r.output?.summary?.mismatch ?? null },
  { id: 'losses', label: 'Real power losses', unit: 'MW', digits: 3, get: (r) => (r.output?.summary ? r.output.summary.lineLossP + r.output.summary.txLossP : null) },
  { id: 'genQ', label: 'Total generator Q', unit: 'Mvar', digits: 2, get: (r) => r.output?.summary?.genQ ?? null },
  { id: 'objective', label: 'Objective value', unit: '', digits: 3, get: (r) => r.output?.summary?.objectiveValue ?? null },
  { id: 'price', label: 'Price at the swept unit\'s bus', unit: '$/MWh', digits: 3, sweepOnly: true, get: (r, el) => r.output?.buses.find((b) => b.id === unitBus(el))?.price ?? null },
  { id: 'worst', label: 'Worst-constraint margin', unit: 'of range', digits: 4, get: (r) => r.output?.summary?.worst?.margin ?? null },
]

export default function ComparePage({ sweep: sweepQ, runs: runsQ }: { sweep: string | null; runs: string | null }) {
  const s = useStore()
  const chart = useRef<HTMLDivElement>(null)
  const sw = sweepQ ? s.sweeps.find((x) => x.num === Number(sweepQ)) : !runsQ ? s.sweeps[s.sweeps.length - 1] : undefined
  const picked = runsQ ? runsQ.split(',').map(Number) : []
  const [qid, setQid] = useState('minVm')
  const quants = QUANTITIES.filter((q) => sw || !q.sweepOnly)
  const q = quants.find((x) => x.id === qid) ?? quants[0]

  // runs in the comparison: for a sweep, the latest run of each of its scenarios
  let runs: Run[] = []
  if (sw) runs = sw.scenarios.map((num) => [...s.runs].reverse().find((r) => r.scenario === num)).filter((r): r is Run => !!r)
  else runs = picked.map((n) => s.runs.find((r) => r.num === n)).filter((r): r is Run => !!r)
  const done = runs.filter((r) => r.status !== 'queued' && r.status !== 'running')

  const qSet = (r: Run) => {
    const p = r.patches.find((x) => x.field === '__row' && x.value && x.element === sw?.element.replace('load:', 'generator:'))
      ?? r.patches.find((x) => x.field === '__row' && x.value && x.element.startsWith('generator:'))
    return (p?.value as { qg?: number } | undefined)?.qg ?? 0
  }
  const points: SweepPoint[] = done.map((r, i) => {
    const v = r.sweepValue ?? scenario(r.scenario ?? -1, s)?.sweepValue
    return sw && v !== undefined
      ? { x: qSet(r), y: r.status === 'failed' ? null : q.get(r, sw.element), run: r.num, status: r.status,
          label: `${Math.abs(v).toFixed(2)} ${v > 0 ? 'prod' : 'abs'}`, side: v > 0 ? 'producing' : 'absorbing' }
      : { x: i, y: r.status === 'failed' ? null : q.get(r), run: r.num, status: r.status, label: `Run ${r.num}`, side: 'run' }
  })
  const vmRef = q.id === 'minVm' || q.id === 'maxVm' || q.id === 'unitVm'
  const vb = runs[0] ? runData(runs[0]).buses : []
  const refY = vmRef && vb.length ? (q.id === 'minVm' ? [{ y: Math.max(...vb.map((b) => b.vn)), label: 'V min' }] : q.id === 'maxVm' ? [{ y: Math.min(...vb.map((b) => b.vx)), label: 'lowest V max' }] : []) : undefined

  const cols: TCol<Run>[] = [
    { key: 'run', label: 'Run', num: true, value: (r) => r.num },
    ...(sw ? [
      { key: 'pf', label: 'Power factor', num: true, value: (r: Run) => (r.sweepValue === undefined ? null : Math.abs(r.sweepValue)), fmt: (v: unknown) => (typeof v === 'number' ? v.toFixed(2) : '') },
      { key: 'dir', label: 'Direction', value: (r: Run) => (r.sweepValue === undefined ? '' : r.sweepValue > 0 ? 'producing' : 'absorbing') },
      { key: 'qset', label: 'Q set point', unit: 'Mvar', num: true, value: (r: Run) => qSet(r), fmt: (v: unknown) => (typeof v === 'number' ? v.toFixed(3) : '') },
    ] : [
      { key: 'what', label: 'What', value: (r: Run) => `${runTargetLabel(r)} · ${runTitle(r)}` },
    ]),
    { key: 'status', label: 'Status', value: (r) => r.status, show: (r) => <StatusTag s={r.status} /> },
    ...quants.map((x) => ({ key: x.id, label: x.label, unit: x.unit || undefined, num: true, value: (r: Run) => x.get(r, sw?.element),
      fmt: (v: unknown) => (typeof v === 'number' ? (x.digits > 6 ? v.toExponential(2) : v.toFixed(x.digits)) : r_fail) })),
  ]

  const panel = (
    <>
      <Header active="compare" />
      <div className="label" style={{ marginTop: 4 }}>Compare</div>
      <ul className="sections" style={{ marginTop: 0 }}>
        {s.sweeps.map((x) => (
          <li key={x.num}><a className={sw?.num === x.num ? 'on' : ''} href={href(`/compare?sweep=${x.num}`)}>Sweep {x.num}: {x.name}
            <small>{x.scenarios.length} scenarios · {objectiveLabel(x.objective)}</small></a></li>
        ))}
        {picked.length > 0 && <li><a className="on" href={href(`/compare?runs=${picked.join(',')}`)}>Runs {picked.join(', ')}<small>picked on the Runs page</small></a></li>}
      </ul>
      <p className="hint">To compare any runs, check them on the <a href={href('/runs')}>Runs</a> page. To make a sweep, see <a href={href('/scenarios')}>Scenarios</a>.</p>
      <div className="label">Quantity</div>
      <div className="sections" style={{ borderTop: 0 }}>
        {quants.map((x) => (
          <label key={x.id} style={{ display: 'flex', gap: 8, padding: '5px 2px', cursor: 'pointer', fontSize: 14, borderBottom: '1px solid var(--line)' }}>
            <input type="radio" checked={q.id === x.id} onChange={() => setQid(x.id)} />{x.label}{x.unit && <span className="muted"> ({x.unit})</span>}
          </label>
        ))}
      </div>
    </>
  )
  const failedN = done.filter((r) => r.status === 'failed').length
  const violN = done.filter((r) => r.status === 'limits_violated').length
  const strip = (
    <div className="strip">
      <span>Runs<b>{runs.length}</b></span>
      <span>Finished<b>{done.length}</b></span>
      <span>With violations<b className={violN ? 'warn' : ''}>{violN}</b></span>
      <span>Failed<b className={failedN ? 'bad' : ''}>{failedN}</b></span>
    </div>
  )
  return (
    <Shell panel={panel} strip={strip}>
      <div className="frame-scroll">
        {!sw && picked.length === 0 && <p className="muted">No sweep yet. Create one on the <a href={href('/scenarios')}>Scenarios</a> page.</p>}
        {(sw || picked.length > 0) && <>
          <h2 className="view">{q.label}{sw ? ` vs power factor of ${labelOf(sw.element)}` : ' across runs'}</h2>
          <p className="view-sub">{sw ? `${sw.name} · base v${sw.base} · ${objectiveLabel(sw.objective)}. x axis = the unit's Q set point (absorbing left, producing right); ticks show the power factor. Click a point to open the run.`
            : 'Each point is one run.'}</p>
          {runs.length > done.length && <div className="callout">{runs.length - done.length} run{runs.length - done.length > 1 ? 's' : ''} still queued or running; the chart fills in as they finish.</div>}
          <div className="block" ref={chart}>
            <h3><span>{q.label}{q.unit ? ` (${q.unit})` : ''}</span><span className="row"><button className="btn small" onClick={() => downloadPng(chart.current, `compare_${q.id}.png`)}>PNG</button></span></h3>
            {points.length ? <SweepChart points={points} yLabel={`${q.label}${q.unit ? ` (${q.unit})` : ''}`} xLabel={sw ? 'Q set point (Mvar) · power factor' : 'run'}
              onPick={(n) => go(`/run/${n}/overview`)} refY={refY} /> : <p className="muted">No finished runs yet.</p>}
          </div>
          <p className="muted small">The table below lists every run in this comparison with all quantities; the CSV button exports it.</p>
        </>}
      </div>
      {(sw || picked.length > 0) && <div style={{ maxHeight: '40%', overflow: 'auto', borderTop: '1px solid var(--line)' }}>
        <DataTable cols={cols} rows={runs} rowKey={(r) => String(r.num)} onSelect={(k) => go(`/run/${k}/overview`)} csvName={sw ? `sweep${sw.num}.csv` : 'runs_compare.csv'} />
      </div>}
    </Shell>
  )
}
const r_fail = '—'
