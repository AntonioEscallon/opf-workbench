// The case: the network diagram over the equipment tables, the selected element in the left panel, validation on
// every edit. Edits on the latest version create a new version; edits on a scenario add overrides to it.
import { useMemo, useState } from 'react'
import { Header, Shell, useToast } from '../App'
import { keyOf, labelOf } from '../model/types'
import type { Table } from '../model/types'
import { editField } from '../model/ops'
import type { Change } from '../model/ops'
import { RULES } from '../model/validate'
import type { Issue } from '../model/validate'
import {
  commit, createScenario, head, issuesOf, promoteScenario, resolve, restoreVersion, saveLayout, scenario, setUI, useStore, useUI, version,
} from '../store'
import type { Target } from '../store'
import { COLUMNS, fmtCell, fromDisplay, TABLE_LABEL, toDisplay, unitOf, valueOf } from '../ui/columns'
import { DataTable } from '../ui/DataTable'
import type { TCol } from '../ui/DataTable'
import Detail, { IssueList } from '../ui/Detail'
import Diagram from '../ui/Diagram'
import type { Overlay } from '../ui/Diagram'
import { href } from '../router'

const TABS: (Table | 'issues' | 'history')[] = ['buses', 'loads', 'generators', 'branches', 'transformers', 'shunts', 'issues', 'history']
const ago = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : new Date(iso).toLocaleDateString()
}
export const targetLabel = (t: Target) => (t.kind === 'version' ? `v${t.num}` : `Scenario ${t.num}`)

export function TargetPicker({ value, onChange, includeSweeps }: { value: string; onChange: (v: string) => void; includeSweeps?: boolean }) {
  const s = useStore()
  const h = head(s)
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      <optgroup label="Case versions">
        {[...s.versions].reverse().map((v) => <option key={v.num} value={`v${v.num}`}>v{v.num}{v.num === h.num ? ' (latest)' : ''} · {v.note.slice(0, 60)}</option>)}
      </optgroup>
      {s.scenarios.length > 0 && <optgroup label="Scenarios">
        {s.scenarios.map((x) => <option key={x.num} value={`s${x.num}`}>Scenario {x.num} · {x.name.slice(0, 60)}</option>)}
      </optgroup>}
      {includeSweeps && s.sweeps.length > 0 && <optgroup label="Sweeps (all scenarios)">
        {s.sweeps.map((x) => <option key={x.num} value={`w${x.num}`}>Sweep {x.num} · {x.name.slice(0, 60)} ({x.scenarios.length})</option>)}
      </optgroup>}
    </select>
  )
}
export const parseTarget = (v: string): Target => (v.startsWith('s') ? { kind: 'scenario', num: Number(v.slice(1)) } : { kind: 'version', num: Number(v.slice(1)) })

export default function CasePage() {
  const s = useStore()
  const ui = useUI()
  const toast = useToast()
  const [tab, setTab] = useState<(typeof TABS)[number]>('generators')
  const [overlay, setOverlay] = useState<Overlay>('area')
  const [sev, setSev] = useState<'all' | 'error' | 'warning'>('all')

  // the working target (falls back to the latest version if it disappeared, e.g. after a reset)
  const target: Target = (ui.target.kind === 'version' ? version(ui.target.num, s) : scenario(ui.target.num, s)) ? ui.target : { kind: 'version', num: head(s).num }
  const data = resolve(target, s)!
  const issues = issuesOf(data)
  const errors = issues.filter((i) => i.severity === 'error'), warnings = issues.filter((i) => i.severity === 'warning')
  const isHead = target.kind === 'version' && target.num === head(s).num
  const readOnly = target.kind === 'version' && !isHead
  const sc = target.kind === 'scenario' ? scenario(target.num, s)! : null

  // latest finished run on exactly this target: drives result overlays and the detail panel's result block
  const lastRun = [...s.runs].reverse().find((r) => r.output?.summary && r.status !== 'running' && r.status !== 'queued'
    && (target.kind === 'version' ? r.version === target.num && !r.scenario : r.scenario === target.num))
  const result = lastRun?.output ?? null

  const select = (k: string | null) => {
    setUI({ selected: k })
    if (!k) return
    const t = k.split(':')[0]
    const map: Record<string, Table> = { bus: 'buses', load: 'loads', generator: 'generators', branch: 'branches', transformer: 'transformers', shunt: 'shunts' }
    if (map[t] && tab !== 'issues' && tab !== 'history') setTab(map[t])
  }
  const doCommit = (change: Change, source: 'edit' | 'operation' | 'fix' | 'bulk_edit' = 'edit') => {
    if (readOnly) return
    const next = commit(target, change, source)
    setUI({ target: next })
    toast(next.kind === 'version' ? `v${next.num}: ${change.note}` : `Scenario ${next.num}: ${change.note}`)
  }
  const asScenario = (change: Change) => {
    const base = sc ? sc.base : target.num
    const full = sc ? { patches: [...sc.patches, ...change.patches], note: change.note } : change
    const num = createScenario(change.note, base, full)
    setUI({ target: { kind: 'scenario', num } })
    toast({ text: `Scenario ${num} created on v${base}`, link: { label: 'Run it', href: href('/runs') } })
  }
  const fix = (i: Issue) => i.fix && doCommit({ patches: i.fix.patches, note: `${labelOf(i.element, data)}: ${i.fix.label}` }, 'fix')

  // ---- equipment tables from the shared column definitions
  const tableCols = useMemo(() => {
    const out = {} as Record<Table, TCol<any>[]>
    for (const t of Object.keys(COLUMNS) as Table[]) {
      out[t] = COLUMNS[t].map((c) => ({
        key: c.key, label: c.label, unit: unitOf(c, ui.units), title: [c.old && `Old name: ${c.old}`, c.hint].filter(Boolean).join(' · ') || undefined,
        num: c.kind === 'num' || c.kind === 'int', editable: c.editable && !readOnly, options: c.options,
        value: (r: any) => toDisplay(c, valueOf(c, r, data), ui.units, data.sbase),
        fmt: (v: unknown) => fmtCell(c, v, ui.units),
        cellClass: (r: any) => {
          const k = keyOf(t, r)
          const hit = issues.filter((i) => i.element === k && i.field === c.key)
          return hit.some((i) => i.severity === 'error') ? 'err' : hit.length ? 'warn' : ''
        },
      }))
    }
    return out
  }, [data, issues, ui.units, readOnly])

  const onEdit = (t: Table) => (keys: string[], col: TCol<any>, value: string) => {
    const def = COLUMNS[t].find((c) => c.key === col.key)!
    let v: unknown = value
    if (def.options || def.kind === 'num' || def.kind === 'int') {
      const x = Number(String(value).replace('−', '-'))
      if (Number.isNaN(x)) { toast(`“${value}” is not a number`); return }
      v = def.options ? x : fromDisplay(def, x, ui.units, data.sbase)
    }
    doCommit(editField(data, keys, col.key, v), keys.length > 1 ? 'bulk_edit' : 'edit')
  }

  const loadMw = data.loads.filter((l) => l.status).reduce((a, l) => a + l.pl, 0)
  const capMw = data.generators.filter((g) => g.status && g.pmax > 0).reduce((a, g) => a + g.pmax, 0)
  const strip = (
    <div className="strip">
      <span>Working on<b>{targetLabel(target)}{isHead ? ' (latest)' : ''}</b></span>
      <span>Buses<b>{data.buses.length}</b></span>
      <span>Load<b>{loadMw.toFixed(1)} MW</b></span>
      <span>Capacity<b>{capMw.toFixed(1)} MW</b></span>
      <span>Blocking errors<b className={errors.length ? 'bad' : 'good'}>{errors.length}</b></span>
      <span>Warnings<b className={warnings.length ? 'warn' : ''}>{warnings.length}</b></span>
      {lastRun && <span>Last run<b><a href={href(`/run/${lastRun.num}/overview`)}>Run {lastRun.num}</a></b></span>}
    </div>
  )

  const panel = (
    <>
      <Header active="case" />
      <div className="label" style={{ marginTop: 4 }}>Case data · {s.caseName}</div>
      <TargetPicker value={target.kind === 'version' ? `v${target.num}` : `s${target.num}`} onChange={(v) => setUI({ target: parseTarget(v), selected: ui.selected })} />
      <div className="row" style={{ marginTop: 8 }}>
        <div className="seg" style={{ flex: 1 }}>
          <button className={ui.units === 'physical' ? 'on' : ''} onClick={() => setUI({ units: 'physical' })}>MW · Mvar</button>
          <button className={ui.units === 'pu' ? 'on' : ''} onClick={() => setUI({ units: 'pu' })}>per-unit ({data.sbase} MVA)</button>
        </div>
      </div>
      {readOnly && (
        <div className="callout warn" style={{ marginTop: 12 }}>
          <b className="t">v{target.num} is an earlier version (read-only)</b>
          Runs on it stay reproducible. To keep editing from here, restore it as a new version.
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn small primary" onClick={() => { const v = restoreVersion(target.num); setUI({ target: { kind: 'version', num: v } }); toast(`v${v}: restored v${target.num}`) }}>Restore as v{head(s).num + 1}</button>
            <button className="btn small" onClick={() => setUI({ target: { kind: 'version', num: head(s).num } })}>Go to latest</button>
          </div>
        </div>
      )}
      {sc && (
        <div className="callout" style={{ marginTop: 12 }}>
          <b className="t">Scenario {sc.num}: {sc.name}</b>
          {sc.patches.length} override{sc.patches.length === 1 ? '' : 's'} on v{sc.base}{sc.sweep ? ` · step of sweep ${sc.sweep}` : ''}. Edits here add overrides; the base version does not change.
          <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 13 }}>{sc.notes.map((x, i) => <li key={i}>{x}</li>)}</ul>
          <div className="row" style={{ marginTop: 8 }}>
            <a className="btn small primary" href={href('/runs')} onClick={() => setUI({})}>Run it</a>
            <button className="btn small" onClick={() => { const v = promoteScenario(sc.num); setUI({ target: { kind: 'version', num: v } }); toast(`v${v}: scenario ${sc.num} applied to the latest version`) }}>Apply to latest version</button>
          </div>
        </div>
      )}
      {ui.selected ? (
        <>
          <div className="label"><span>Selected</span><button className="btn small link" onClick={() => setUI({ selected: null })}>clear</button></div>
          <Detail data={data} element={ui.selected} units={ui.units} readOnly={readOnly} issues={issues}
            result={lastRun?.output ? { output: lastRun.output, run: lastRun.num } : null}
            onCommit={doCommit} onScenario={asScenario} onSelect={select} onFix={fix} />
        </>
      ) : (
        <>
          <p className="hint" style={{ marginTop: 14 }}>Click a bus or branch on the diagram, or a row in a table, to see and edit it here. Yellow cells are editable; changes are validated as you make them.</p>
          <div className="label"><span>Validation</span><button className="btn small link" onClick={() => setTab('issues')}>all {issues.length}</button></div>
          <IssueList issues={[...errors, ...warnings]} limit={6} onPick={(k) => k !== 'case' && select(k)} onFix={readOnly ? undefined : fix} />
        </>
      )}
    </>
  )

  // ---- issues tab grouped by rule, with "fix all like this"
  const shownIssues = issues.filter((i) => sev === 'all' || i.severity === sev)
  const rules = [...new Set(shownIssues.map((i) => i.rule))]

  return (
    <Shell panel={panel} strip={strip}>
      <div className="split">
        <div className="pane">
          <Diagram data={data} selected={ui.selected} onSelect={select} issues={issues} result={result}
            overlay={result ? overlay : 'area'} onOverlay={setOverlay} layout={s.layout} onLayout={saveLayout} />
          {result && overlay !== 'area' && <div className="muted small" style={{ position: 'absolute', left: 12, top: 10 }}>colored by Run {lastRun!.num}</div>}
        </div>
        <div className="subtabs">
          {TABS.map((t) => {
            const count = t === 'issues' ? issues.length : t === 'history' ? s.versions.length : (data[t as Table] as unknown[]).length
            const cls = t === 'issues' ? (errors.length ? 'bad' : warnings.length ? 'warn' : '') : ''
            return <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
              {t === 'issues' ? 'Issues' : t === 'history' ? 'History' : TABLE_LABEL[t as Table]}<span className={`count ${cls}`}>{count}</span></button>
          })}
        </div>
        <div className="pane table-pane">
          {tab !== 'issues' && tab !== 'history' && (
            <DataTable key={tab} cols={tableCols[tab]} rows={data[tab] as any[]} rowKey={(r) => keyOf(tab, r)}
              selected={ui.selected} onSelect={select} onEdit={readOnly ? undefined : onEdit(tab)} onBulk={!readOnly}
              csvName={`${targetLabel(target)}_${tab}.csv`} dimmed={(r: any) => (tab === 'buses' ? r.type === 4 : r.status === 0)}
              toolbarExtra={<span className="muted small">{readOnly ? 'read-only version' : 'click a yellow cell to edit · check rows for bulk edit'}</span>} />
          )}
          {tab === 'issues' && (
            <div style={{ padding: '10px 14px' }}>
              <div className="row" style={{ marginBottom: 8 }}>
                <div className="seg" style={{ width: 320 }}>
                  {(['all', 'error', 'warning'] as const).map((x) => <button key={x} className={sev === x ? 'on' : ''} onClick={() => setSev(x)}>
                    {x === 'all' ? `All ${issues.length}` : x === 'error' ? `Blocking ${errors.length}` : `Warnings ${warnings.length}`}</button>)}
                </div>
              </div>
              {rules.length === 0 && <p className="muted">No issues. The case is ready to run.</p>}
              {rules.map((rule) => {
                const group = shownIssues.filter((i) => i.rule === rule)
                const fixable = group.filter((i) => i.fix)
                return (
                  <div key={rule} className="block" style={{ marginBottom: 14 }}>
                    <h3><span>{RULES[rule].title} · {group.length}</span>
                      {!readOnly && fixable.length > 1 && <span className="row"><button className="btn small" onClick={() => doCommit({
                        patches: fixable.flatMap((i) => i.fix!.patches), note: `Fixed ${fixable.length} × ${RULES[rule].title.toLowerCase()}` }, 'fix')}>
                        Apply the suggested fix to all {fixable.length}</button></span>}</h3>
                    <IssueList issues={group} onPick={(k) => k !== 'case' && setUI({ selected: k })} onFix={readOnly ? undefined : fix} />
                  </div>
                )
              })}
            </div>
          )}
          {tab === 'history' && (
            <div style={{ padding: '10px 14px' }}>
              <p className="muted small" style={{ marginTop: 0 }}>Every edit is a new version. Runs point at the version they used, so any result can be traced to its data.</p>
              <ul className="history">
                {[...s.versions].reverse().map((v) => {
                  const runs = s.runs.filter((r) => r.version === v.num)
                  return (
                    <li key={v.num} className={target.kind === 'version' && target.num === v.num ? 'on' : ''}>
                      <span className="v">v{v.num}</span>
                      <span>{v.note} <span className="tag gray">{v.source.replace('_', ' ')}</span>
                        {runs.length > 0 && <span className="muted small"> · {runs.length} run{runs.length > 1 ? 's' : ''}</span>}</span>
                      <span className="row"><span className="muted small">{ago(v.created)}</span>
                        <button className="btn small" onClick={() => setUI({ target: { kind: 'version', num: v.num } })}>view</button></span>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}
        </div>
      </div>
    </Shell>
  )
}
