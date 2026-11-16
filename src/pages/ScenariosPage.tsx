// Scenarios and sweeps. A scenario is a named set of overrides on one case version; a sweep generates one scenario
// per step of a parameter (here: a unit's power factor, producing and absorbing) and queues a run for each.
import { useState } from 'react'
import { Shell, useToast } from '../App'
import { key, labelOf } from '../model/types'
import { qAtPf, sweepSteps } from '../model/ops'
import { OBJECTIVES, objectiveLabel } from '../solver/interface'
import type { Objective } from '../solver/interface'
import { createScenario, createSweep, head, issuesOf, promoteScenario, queueRun, renameScenario, resolve, setUI, useStore, version } from '../store'
import type { Scenario } from '../store'
import { go, href } from '../router'
import { DataTable } from '../ui/DataTable'
import type { TCol } from '../ui/DataTable'
import { StatusTag } from './RunsPage'

export default function ScenariosPage() {
  const s = useStore()
  const toast = useToast()
  const h = head(s)
  const [base, setBase] = useState(h.num)
  const data = version(base, s)?.data ?? h.data
  const units = [...data.generators.map((g) => key.gen(g)), ...data.loads.map((l) => key.load(l))]
  const [element, setElement] = useState('generator:8-1')
  const [from, setFrom] = useState(0.95)
  const [to, setTo] = useState(0.8)
  const [step, setStep] = useState(0.05)
  const [prod, setProd] = useState(true)
  const [abs, setAbs] = useState(true)
  const [objective, setObjective] = useState<Objective>('economic_dispatch')
  const [newName, setNewName] = useState('')

  const steps = sweepSteps(from, to, step, prod, abs)
  const el = units.includes(element) ? element : units[0]
  const row = el.startsWith('generator:') ? data.generators.find((g) => key.gen(g) === el) : data.loads.find((l) => key.load(l) === el)
  const p = row ? ('pg' in row ? row.pg : -row.pl) : 0
  const valid = steps.length > 0 && steps.length <= 40 && from > 0 && from <= 1 && to > 0 && to <= 1

  const create = () => {
    const num = createSweep({ element: el, parameter: 'power_factor', from, to, step, producing: prod, absorbing: abs, base, objective })
    toast({ text: `Sweep ${num}: ${steps.length} scenarios created, ${steps.length} runs queued`, link: { label: 'Compare', href: href(`/compare?sweep=${num}`) } })
    go(`/compare?sweep=${num}`)
  }

  const lastRun = (sc: Scenario) => [...s.runs].reverse().find((r) => r.scenario === sc.num)
  const cols: TCol<Scenario>[] = [
    { key: 'num', label: 'Scenario', num: true, value: (x) => x.num },
    { key: 'name', label: 'Name', value: (x) => x.name },
    { key: 'base', label: 'Base', value: (x) => `v${x.base}` },
    { key: 'sweep', label: 'Sweep', value: (x) => (x.sweep ? `Sweep ${x.sweep}` : '') },
    { key: 'over', label: 'Overrides', num: true, value: (x) => x.patches.length },
    { key: 'issues', label: 'Blocking', num: true, value: (x) => { const d = resolve({ kind: 'scenario', num: x.num }, s); return d ? issuesOf(d).filter((i) => i.severity === 'error').length : 0 },
      cellClass: (x) => { const d = resolve({ kind: 'scenario', num: x.num }, s); return d && issuesOf(d).some((i) => i.severity === 'error') ? 'err' : '' } },
    { key: 'last', label: 'Last run', value: (x) => lastRun(x)?.num ?? '', show: (x) => { const r = lastRun(x); return r ? <><a href={href(`/run/${r.num}/overview`)} onClick={(e) => e.stopPropagation()}>Run {r.num}</a> <StatusTag s={r.status} /></> : <span className="muted">never run</span> } },
    { key: 'act', label: '', value: () => '', show: (x) => (
      <span className="row" onClick={(e) => e.stopPropagation()}>
        <button className="btn small" onClick={() => { setUI({ target: { kind: 'scenario', num: x.num }, selected: null }); go('/') }}>Edit</button>
        <button className="btn small" onClick={() => { const n = queueRun({ kind: 'scenario', num: x.num }, 'economic_dispatch'); toast(`Run ${n} queued`); go(`/run/${n}/overview`) }}>Run ED</button>
        <button className="btn small" title="Apply these overrides to the latest case version" onClick={() => { const v = promoteScenario(x.num); toast(`v${v}: scenario ${x.num} applied`) }}>Apply</button>
        <button className="btn small" onClick={() => { const n = window.prompt('Scenario name', x.name); if (n) renameScenario(x.num, n) }}>Rename</button>
      </span>
    ) },
  ]

  const panel = (
    <>
      <div className="label" style={{ marginTop: 4 }}>New parameter sweep</div>
      <p className="hint" style={{ marginTop: 0 }}>Converts the unit to fixed P/Q at each power factor (one scenario per step, both directions), then queues one run per scenario.</p>
      <div className="fields" style={{ gridTemplateColumns: '1fr' }}>
        <div className="fieldrow"><label>Unit</label>
          <select value={el} onChange={(e) => setElement(e.target.value)}>
            {units.map((u) => <option key={u} value={u}>{labelOf(u, data)}</option>)}
          </select></div>
      </div>
      <div className="fields" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
        <div className="fieldrow"><label>From pf</label><input type="number" step="0.01" value={from} onChange={(e) => setFrom(Number(e.target.value))} /></div>
        <div className="fieldrow"><label>To pf</label><input type="number" step="0.01" value={to} onChange={(e) => setTo(Number(e.target.value))} /></div>
        <div className="fieldrow"><label>Step</label><input type="number" step="0.01" value={step} onChange={(e) => setStep(Number(e.target.value))} /></div>
      </div>
      <div className="row" style={{ margin: '6px 0' }}>
        <label className="small"><input type="checkbox" checked={prod} onChange={(e) => setProd(e.target.checked)} /> producing Q</label>
        <label className="small"><input type="checkbox" checked={abs} onChange={(e) => setAbs(e.target.checked)} /> absorbing Q</label>
      </div>
      <div className="fields" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <div className="fieldrow"><label>Base version</label>
          <select value={base} onChange={(e) => setBase(Number(e.target.value))}>
            {[...s.versions].reverse().map((v) => <option key={v.num} value={v.num}>v{v.num}{v.num === h.num ? ' (latest)' : ''}</option>)}
          </select></div>
        <div className="fieldrow"><label>Objective</label>
          <select value={objective} onChange={(e) => setObjective(e.target.value as Objective)}>
            {OBJECTIVES.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select></div>
      </div>
      {valid && <table style={{ marginTop: 8 }}>
        <thead><tr><th>pf</th><th>direction</th><th className="num">P <span className="unit">MW</span></th><th className="num">Q <span className="unit">Mvar</span></th></tr></thead>
        <tbody>{steps.map((v) => <tr key={v}><td className="mono">{Math.abs(v).toFixed(2)}</td><td>{v > 0 ? 'producing' : 'absorbing'}</td>
          <td className="num mono">{p.toFixed(2)}</td><td className="num mono">{qAtPf(p, Math.abs(v), v > 0).toFixed(2)}</td></tr>)}</tbody>
      </table>}
      <button className="btn primary" style={{ marginTop: 12, width: '100%', justifyContent: 'center' }} disabled={!valid} onClick={create}>
        Create {steps.length} scenarios and queue {steps.length} runs</button>
      <p className="hint">{objectiveLabel(objective)} on v{base}.</p>

      <div className="label">Empty scenario</div>
      <div className="row">
        <input type="text" placeholder="Name" value={newName} onChange={(e) => setNewName(e.target.value)} style={{ flex: 1 }} />
        <button className="btn" disabled={!newName.trim()} onClick={() => { const n = createScenario(newName.trim(), h.num); setNewName(''); setUI({ target: { kind: 'scenario', num: n }, selected: null }); go('/') }}>Create on v{h.num}</button>
      </div>
      <p className="hint">Opens it in the case view; edits there become its overrides.</p>
    </>
  )

  return (
    <Shell panel={panel} strip={<div className="strip"><span>Scenarios<b>{s.scenarios.length}</b></span><span>Sweeps<b>{s.sweeps.length}</b></span></div>}>
      <div className="frame-scroll" style={{ padding: 0 }}>
        <div style={{ padding: '18px 22px 4px' }}>
          <h2 className="view">Sweeps</h2>
          <p className="view-sub">Each sweep is a set of scenarios that differ in one parameter.</p>
          {s.sweeps.length === 0 && <p className="muted">No sweeps yet.</p>}
          {[...s.sweeps].reverse().map((x) => {
            const rs = x.scenarios.map((num) => [...s.runs].reverse().find((r) => r.scenario === num))
            const count = (st: string) => rs.filter((r) => r?.status === st).length
            return (
              <div key={x.num} className="card">
                <h4>Sweep {x.num}: {x.name}</h4>
                <div className="row small">
                  <span className="muted">{labelOf(x.element)} · pf {x.from.toFixed(2)} → {x.to.toFixed(2)} step {x.step} · {[x.producing && 'producing', x.absorbing && 'absorbing'].filter(Boolean).join(' + ')} · v{x.base} · {objectiveLabel(x.objective)}</span>
                </div>
                <div className="row small" style={{ marginTop: 6 }}>
                  <span className="tag good">{count('optimal')} optimal</span>
                  {count('limits_violated') > 0 && <span className="tag warn">{count('limits_violated')} limits violated</span>}
                  {count('failed') > 0 && <span className="tag bad">{count('failed')} failed</span>}
                  {count('queued') + count('running') > 0 && <span className="tag blue">{count('queued') + count('running')} pending</span>}
                  <a className="btn small primary" href={href(`/compare?sweep=${x.num}`)}>Compare</a>
                </div>
              </div>
            )
          })}
          <h2 className="view" style={{ marginTop: 22 }}>Scenarios</h2>
          <p className="view-sub">Overrides on a base version. Runs copy the overrides they used, so later edits never change an old result.</p>
        </div>
        <DataTable cols={cols} rows={[...s.scenarios].reverse()} rowKey={(x) => String(x.num)} csvName="scenarios.csv"
          onSelect={(k) => { setUI({ target: { kind: 'scenario', num: Number(k) }, selected: null }); go('/') }} />
      </div>
    </Shell>
  )
}
