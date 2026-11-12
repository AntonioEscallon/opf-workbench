// Runs: start a run (objective + a version, a scenario or a whole sweep), watch the queue, open or compare results.
import { useState } from 'react'
import { Header, Shell, useToast } from '../App'
import { DEFAULT_SETTINGS, OBJECTIVES, objectiveLabel } from '../solver/interface'
import type { Objective, SolverSettings } from '../solver/interface'
import { head, issuesOf, queueRun, resolve, scenario, sweep, useStore, useUI } from '../store'
import type { Run, Target } from '../store'
import { parseTarget, TargetPicker, targetLabel } from './CasePage'
import { go, href } from '../router'
import { DataTable } from '../ui/DataTable'
import type { TCol } from '../ui/DataTable'

export const STATUS_TAG: Record<string, [string, string]> = {
  queued: ['gray', 'queued'], running: ['blue', 'running'], optimal: ['good', 'optimal'], limits_violated: ['warn', 'limits violated'], failed: ['bad', 'failed'],
}
export const StatusTag = ({ s }: { s: string }) => <span className={`tag ${STATUS_TAG[s][0]}`}>{STATUS_TAG[s][1]}</span>

export const runTargetLabel = (r: Run) => (r.scenario ? `Scenario ${r.scenario}` : `v${r.version}`)
export function runTitle(r: Run): string {
  if (r.scenario) { const sc = scenario(r.scenario); return sc ? sc.name : `Scenario ${r.scenario}` }
  return r.note ?? `Case v${r.version}`
}

export default function RunsPage() {
  const s = useStore()
  const ui = useUI()
  const toast = useToast()
  const [tv, setTv] = useState(ui.target.kind === 'version' ? `v${ui.target.num}` : `s${ui.target.num}`)
  const [objective, setObjective] = useState<Objective>('economic_dispatch')
  const [settings, setSettings] = useState<SolverSettings>(DEFAULT_SETTINGS)
  const [picked, setPicked] = useState<Set<number>>(new Set())

  const isSweep = tv.startsWith('w')
  const targets: Target[] = isSweep ? (sweep(Number(tv.slice(1)), s)?.scenarios ?? []).map((num) => ({ kind: 'scenario', num }))
    : [(scenario(Number(tv.slice(1)), s) || tv.startsWith('v')) ? parseTarget(tv) : { kind: 'version', num: head(s).num }]
  const blocking = targets.reduce((a, t) => { const d = resolve(t, s); return a + (d ? issuesOf(d).filter((i) => i.severity === 'error').length : 0) }, 0)

  const start = () => {
    const nums = targets.map((t) => queueRun(t, objective, settings))
    toast(nums.length === 1 ? `Run ${nums[0]} queued` : `${nums.length} runs queued (runs ${nums[0]}–${nums[nums.length - 1]})`)
    if (nums.length === 1) go(`/run/${nums[0]}/overview`)
  }

  const running = s.runs.find((r) => r.status === 'running')
  const queued = s.runs.filter((r) => r.status === 'queued').length

  const cols: TCol<Run>[] = [
    { key: 'pick', label: '', value: (r) => picked.has(r.num), show: (r) => <input type="checkbox" checked={picked.has(r.num)} onClick={(e) => e.stopPropagation()}
      onChange={() => { const n = new Set(picked); if (n.has(r.num)) n.delete(r.num); else n.add(r.num); setPicked(n) }} /> },
    { key: 'num', label: 'Run', num: true, value: (r) => r.num },
    { key: 'target', label: 'Data', value: (r) => runTargetLabel(r), show: (r) => <><b>{runTargetLabel(r)}</b>{r.scenario ? <span className="muted"> on v{r.version}</span> : null}</> },
    { key: 'title', label: 'What', value: (r) => runTitle(r), show: (r) => <span title={runTitle(r)}>{runTitle(r).slice(0, 48)}{runTitle(r).length > 48 ? '…' : ''}</span> },
    { key: 'objective', label: 'Objective', value: (r) => OBJECTIVES.find((o) => o.id === r.objective)!.short },
    { key: 'status', label: 'Status', value: (r) => r.status, show: (r) => <StatusTag s={r.status} /> },
    { key: 'obj', label: 'Objective value', num: true, value: (r) => r.output?.summary?.objectiveValue ?? null,
      fmt: (v) => (typeof v === 'number' ? v.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '') },
    { key: 'minvm', label: 'Min VM', unit: 'pu', num: true, value: (r) => r.output?.summary?.minVm ?? null, fmt: (v) => (typeof v === 'number' ? v.toFixed(4) : '') },
    { key: 'maxvm', label: 'Max VM', unit: 'pu', num: true, value: (r) => r.output?.summary?.maxVm ?? null, fmt: (v) => (typeof v === 'number' ? v.toFixed(4) : '') },
    { key: 'mis', label: 'Mismatch', unit: 'pu', num: true, value: (r) => r.output?.summary?.mismatch ?? null, fmt: (v) => (typeof v === 'number' ? v.toExponential(1) : '') },
    { key: 'worst', label: 'Worst constraint / error', value: (r) => (r.status === 'failed' ? `code ${r.output?.code}` : r.output?.summary?.worst?.text ?? ''),
      show: (r) => r.status === 'failed' ? <span style={{ color: 'var(--bad)' }}>code {r.output?.code}{r.output?.detail?.element ? ` · ${r.output.detail.element}` : ''}</span>
        : <span className="muted">{r.output?.summary?.worst?.text ?? ''}</span> },
    { key: 'when', label: 'Finished', value: (r) => r.finished ?? '', fmt: (v) => (v ? new Date(String(v)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '') },
  ]

  const panel = (
    <>
      <Header active="runs" />
      <div className="label" style={{ marginTop: 4 }}>New run</div>
      <TargetPicker value={tv} onChange={setTv} includeSweeps />
      <p className="hint">{isSweep ? `Queues one run per scenario of the sweep (${targets.length}).` : 'Runs use the data exactly as it is now; the run keeps a pointer to it.'}</p>
      <div className="label">Objective</div>
      <div className="sections" style={{ borderTop: 0 }}>
        {OBJECTIVES.map((o) => (
          <label key={o.id} style={{ display: 'grid', gridTemplateColumns: '20px 1fr', gap: 6, padding: '6px 2px', borderBottom: '1px solid var(--line)', cursor: 'pointer', fontSize: 14 }}>
            <input type="radio" checked={objective === o.id} onChange={() => setObjective(o.id)} />
            <span><b>{o.label}</b> <span className="muted">({o.family})</span><small className="muted" style={{ display: 'block' }}>{o.description}</small></span>
          </label>
        ))}
      </div>
      <details style={{ marginTop: 10 }}>
        <summary className="small" style={{ cursor: 'pointer' }}>Solver settings</summary>
        <div className="fields" style={{ marginTop: 6 }}>
          <div className="fieldrow"><label>Tolerance <span className="unit">pu</span></label>
            <input type="number" value={settings.tolerance} step="any" onChange={(e) => setSettings({ ...settings, tolerance: Number(e.target.value) })} /></div>
          <div className="fieldrow"><label>Max iterations</label>
            <input type="number" value={settings.maxIterations} onChange={(e) => setSettings({ ...settings, maxIterations: Number(e.target.value) })} /></div>
          <div className="fieldrow"><label>Branch limit</label>
            <select value={settings.rate} onChange={(e) => setSettings({ ...settings, rate: e.target.value as 'A' })}>
              <option value="A">Rate A (normal)</option><option value="B">Rate B (emergency)</option><option value="C">Rate C</option></select></div>
          <div className="fieldrow"><label>Q limits</label>
            <select value={settings.enforceQLimits ? '1' : '0'} onChange={(e) => setSettings({ ...settings, enforceQLimits: e.target.value === '1' })}>
              <option value="1">Enforced</option><option value="0">Ignored</option></select></div>
        </div>
      </details>
      {blocking > 0 && <div className="callout bad" style={{ marginTop: 12 }}><b className="t">{blocking} blocking error{blocking > 1 ? 's' : ''} in this data</b>
        The solver will most likely reject it. <a href={href('/')}>Review in the case view</a>, or run anyway to see the solver's message.</div>}
      <button className="btn primary" style={{ marginTop: 12, width: '100%', justifyContent: 'center' }} onClick={start}>
        ▶ Run {objectiveLabel(objective)}{targets.length > 1 ? ` × ${targets.length}` : ''}
      </button>
      <p className="hint">Solver: stub (dispatch + Newton power flow) behind the solver interface. See Data → Solver interface.</p>
    </>
  )

  const strip = (
    <div className="strip">
      <span>Runs<b>{s.runs.length}</b></span>
      <span>Queued<b>{queued}</b></span>
      <span>Running<b>{running ? `Run ${running.num}` : '—'}</b></span>
      <span>Failed<b className={s.runs.some((r) => r.status === 'failed') ? 'bad' : ''}>{s.runs.filter((r) => r.status === 'failed').length}</b></span>
    </div>
  )

  return (
    <Shell panel={panel} strip={strip}>
      <div className="frame-scroll" style={{ padding: 0 }}>
        <div style={{ padding: '18px 22px 6px' }}>
          <h2 className="view">Runs</h2>
          <p className="view-sub">Newest first. Click a run for its results; check two or more to compare them.</p>
          {running && (
            <div className="callout" style={{ marginBottom: 12 }}>
              <b className="t">Run {running.num} running · {objectiveLabel(running.objective)} on {runTargetLabel(running)}{queued ? ` · ${queued} more queued` : ''}</b>
              <div className="progress"><i style={{ width: `${(running.shown / Math.max(1, running.output?.log.length ?? 1)) * 100}%` }} /></div>
              <a href={href(`/run/${running.num}/log`)}>watch the log</a>
            </div>
          )}
        </div>
        <DataTable cols={cols} rows={[...s.runs].reverse()} rowKey={(r) => String(r.num)} onSelect={(k) => go(`/run/${k}/overview`)} csvName="runs.csv"
          toolbarExtra={<button className="btn small primary" disabled={picked.size < 2} onClick={() => go(`/compare?runs=${[...picked].sort((a, b) => a - b).join(',')}`)}>
            Compare {picked.size || ''} selected</button>} />
      </div>
    </Shell>
  )
}

export { targetLabel }
