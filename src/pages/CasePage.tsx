// The case: the network diagram is the centre of the page. Above it, the case and version being edited, the study's
// progress (data → run → results) and one tile per way of coloring the diagram; each tile opens an indicator card with
// what it shows, how the buses or branches are spread, and its headline figure. The selected element opens in a card
// over the diagram; the equipment tables, issues and history sit in a drawer underneath that folds away.
// Edits on the latest version create a new version; edits on a scenario add overrides to it.
import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Shell, useToast } from '../App'
import { isFixedPQ, keyOf, labelOf } from '../model/types'
import type { CaseData, Table } from '../model/types'
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
import type { SolverOutput } from '../solver/interface'
import { href } from '../router'

const TABS: (Table | 'issues' | 'history')[] = ['buses', 'loads', 'generators', 'branches', 'transformers', 'shunts', 'issues', 'history']
const ago = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : new Date(iso).toLocaleDateString()
}
const DRAWER_KEY = 'opf-workbench/drawer'
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
  const [drawer, setDrawerState] = useState(() => { try { return localStorage.getItem(DRAWER_KEY) === 'open' } catch { return false } })
  const setDrawer = (open: boolean) => { setDrawerState(open); try { localStorage.setItem(DRAWER_KEY, open ? 'open' : 'closed') } catch { /* private mode */ } }
  const openTab = (t: (typeof TABS)[number]) => { if (drawer && tab === t) setDrawer(false); else { setTab(t); setDrawer(true) } }
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
  const inds = indicators(data, result, loadMw, capMw)
  const shown: Overlay = result ? overlay : 'area'
  const ind = inds[shown]

  // ---- issues tab grouped by rule, with "fix all like this"
  const shownIssues = issues.filter((i) => sev === 'all' || i.severity === sev)
  const rules = [...new Set(shownIssues.map((i) => i.rule))]

  return (
    <Shell>
      <header className="casehead">
        <div>
          <h2>{s.caseName}</h2>
          <div className="pick" style={{ marginTop: 6 }}>
            <TargetPicker value={target.kind === 'version' ? `v${target.num}` : `s${target.num}`} onChange={(v) => setUI({ target: parseTarget(v), selected: ui.selected })} />
            <div className="seg">
              <button className={ui.units === 'physical' ? 'on' : ''} onClick={() => setUI({ units: 'physical' })}>MW · Mvar</button>
              <button className={ui.units === 'pu' ? 'on' : ''} onClick={() => setUI({ units: 'pu' })}>per-unit ({data.sbase} MVA)</button>
            </div>
          </div>
        </div>
        <nav className="stepper" aria-label="Study progress">
          <a href="#" onClick={(e) => { e.preventDefault(); setTab('issues'); setDrawer(true) }} title="Validation runs on every edit; open the issues">
            Case data<span className={`sub ${errors.length ? 'bad' : warnings.length ? 'warn' : ''}`}>
              {errors.length ? `${errors.length} blocking error${errors.length > 1 ? 's' : ''}` : warnings.length ? `ready · ${warnings.length} warning${warnings.length > 1 ? 's' : ''}` : 'ready'}</span>
            <span className="num">1</span></a>
          <a href={href('/runs')} className={lastRun ? '' : 'todo'}>
            Run<span className="sub">{lastRun ? `Run ${lastRun.num} · ${lastRun.status.replace('_', ' ')}` : errors.length ? 'fix blocking errors first' : 'not run yet'}</span>
            <span className="num">2</span></a>
          {lastRun
            ? <a href={href(`/run/${lastRun.num}/overview`)}>Results &amp; export<span className="sub">open Run {lastRun.num}</span><span className="num">3</span></a>
            : <span className="step todo">Results &amp; export<span className="sub">after a run</span><span className="num">3</span></span>}
        </nav>
        <a className="btn go" href={href('/runs')} title="Start a run on this version or scenario">Run ▸</a>
      </header>

      {readOnly && (
        <div className="banner warn">
          <span className="grow"><b>v{target.num} is an earlier version (read-only).</b> Runs on it stay reproducible. To keep editing from here, restore it as a new version.</span>
          <button className="btn small primary" onClick={() => { const v = restoreVersion(target.num); setUI({ target: { kind: 'version', num: v } }); toast(`v${v}: restored v${target.num}`) }}>Restore as v{head(s).num + 1}</button>
          <button className="btn small" onClick={() => setUI({ target: { kind: 'version', num: head(s).num } })}>Go to latest</button>
        </div>
      )}
      {sc && (
        <div className="banner">
          <span className="grow" title={sc.notes.join('\n')}><b>Scenario {sc.num}: {sc.name}</b> · {sc.patches.length} override{sc.patches.length === 1 ? '' : 's'} on v{sc.base}{sc.sweep ? ` · step of sweep ${sc.sweep}` : ''}. Edits here add overrides; the base version does not change.</span>
          <a className="btn small go" href={href('/runs')}>Run it</a>
          <button className="btn small" onClick={() => { const v = promoteScenario(sc.num); setUI({ target: { kind: 'version', num: v } }); toast(`v${v}: scenario ${sc.num} applied to the latest version`) }}>Apply to latest version</button>
        </div>
      )}

      <nav className="tiles" aria-label="Color the diagram by">
        {(Object.keys(inds) as Overlay[]).map((o, i) => {
          const x = inds[o]
          const off = o !== 'area' && !result
          return (
            <button key={o} className={`tile ${shown === o ? 'on' : ''} ${x.bad ? 'bad' : ''}`} disabled={off} onClick={() => setOverlay(o)}
              title={off ? 'Run this case to color the diagram by results' : x.about}>
              <b>{i + 1}</b><span className="lbl">{x.label}</span><span className="val">{off ? '—' : x.tile}</span>
            </button>
          )
        })}
      </nav>

      <section className="ind">
        <div className="ind-title">{ind.label}{shown !== 'area' && lastRun && <small>from Run {lastRun.num}</small>}{!result && <small>run this case to color the diagram by results</small>}</div>
        <div className="ind-info">
          <div><h4>About this view</h4><p>{ind.about}</p>{ind.facts && <div className="facts-line">{ind.facts}</div>}</div>
          <div>{ind.dist && <><h4>{ind.dist.title}</h4><Dist d={ind.dist} /></>}</div>
          <div className="score"><h4>{ind.score.title}</h4><span className={`badge-big ${ind.score.cls ?? ''}`}>{ind.score.text}</span><span className="cap">{ind.score.cap}</span></div>
        </div>
        <div className={`ind-map ${ui.selected ? 'has-card' : ''}`}>
          <Diagram data={data} selected={ui.selected} onSelect={select} issues={issues} result={result}
            overlay={shown} layout={s.layout} onLayout={saveLayout} inset={ui.selected ? 410 : 0} />
          {!ui.selected && <div className="map-hint">Click a bus or branch to inspect and edit it</div>}
          {ui.selected && (
            <aside className="float-card">
              <div className="label"><span>Selected</span><button className="x" onClick={() => setUI({ selected: null })} aria-label="Close" title="Close">×</button></div>
              <Detail data={data} element={ui.selected} units={ui.units} readOnly={readOnly} issues={issues}
                result={lastRun?.output ? { output: lastRun.output, run: lastRun.num } : null}
                onCommit={doCommit} onScenario={asScenario} onSelect={select} onFix={fix} />
            </aside>
          )}
        </div>
      </section>

      <section className={`drawer ${drawer ? 'open' : ''}`}>
        <div className="subtabs">
          {TABS.map((t) => {
            const count = t === 'issues' ? issues.length : t === 'history' ? s.versions.length : (data[t as Table] as unknown[]).length
            const cls = t === 'issues' ? (errors.length ? 'bad' : warnings.length ? 'warn' : '') : ''
            return <button key={t} className={tab === t ? 'on' : ''} onClick={() => openTab(t)}>
              {t === 'issues' ? 'Issues' : t === 'history' ? 'History' : TABLE_LABEL[t as Table]}<span className={`count ${cls}`}>{count}</span></button>
          })}
          <button className="toggle" onClick={() => setDrawer(!drawer)} aria-expanded={drawer}>{drawer ? 'Hide tables ▾' : 'Show tables ▴'}</button>
        </div>
        {drawer && <div className="table-pane">
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
        </div>}
      </section>
    </Shell>
  )
}

// ------------------------------------------------------------------------------------------------ indicators
// One per diagram coloring: the tile's short figure, what the view shows, how the elements are spread along a 0–1
// line (the worst one highlighted), and a headline figure.
type Dot = { x: number; label: string }
type DistSpec = { title: string; dots: Dot[]; worst: number; band?: [number, number]; ticks?: number[]; left: string; right: string }
type Indicator = {
  label: string; tile: string; bad?: boolean; about: string; facts?: ReactNode
  dist?: DistSpec; score: { title: string; text: string; cap: string; cls?: 'hot' | 'ok' }
}
const clamp = (x: number) => Math.max(0, Math.min(1, x))

function indicators(data: CaseData, r: SolverOutput | null, loadMw: number, capMw: number): Record<Overlay, Indicator> {
  const busName = (id: number) => data.buses.find((b) => b.id === id)?.name ?? `Bus ${id}`
  const out = {} as Record<Overlay, Indicator>
  out.area = {
    label: 'Network', tile: `${data.areas.length} area${data.areas.length === 1 ? '' : 's'}`,
    about: 'The network as entered: buses colored by area, with the reference bus (★), generators (~), fixed P/Q units (⇅) and loads (↓). Run the case to color it by a result.',
    facts: <>Buses <b>{data.buses.length}</b> · branches <b>{data.branches.length + data.transformers.length}</b> · load <b>{loadMw.toFixed(1)} MW</b> · capacity <b>{capMw.toFixed(1)} MW</b></>,
    score: { title: 'Capacity margin', text: `${capMw ? Math.round((1 - loadMw / capMw) * 100) : 0}%`, cap: 'in-service P max above load' },
  }
  const none = (label: string, about: string): Indicator => ({ label, tile: '—', about, score: { title: 'Headline', text: '—', cap: 'run the case first' } })
  if (!r || !r.summary) {
    out.vm = none('Voltage vs limits', ABOUT.vm); out.qheadroom = none('Q headroom', ABOUT.qheadroom)
    out.price = none('Price', ABOUT.price); out.loading = none('Branch loading', ABOUT.loading)
    return out
  }
  // voltage: position in each bus's own band, shown on -25% … 125% of the band
  const vm = r.buses.flatMap((b) => {
    const bus = data.buses.find((x) => x.id === b.id)
    if (!bus || bus.type === 4) return []
    const t = (b.vm - bus.vn) / (bus.vx - bus.vn || 1)
    return [{ t, x: clamp((t + 0.25) / 1.5), label: `${bus.name} ${b.vm.toFixed(3)}` }]
  })
  const outside = vm.filter((v) => v.t < -1e-4 || v.t > 1 + 1e-4).length
  const vWorst = vm.reduce((w, v, i) => (Math.abs(v.t - 0.5) > Math.abs(vm[w].t - 0.5) ? i : w), 0)
  out.vm = {
    label: 'Voltage vs limits', tile: `${r.summary.minVm.toFixed(3)}–${r.summary.maxVm.toFixed(3)}`, bad: outside > 0, about: ABOUT.vm,
    facts: <>Lowest <b>{r.summary.minVm.toFixed(4)} pu</b> at {busName(r.summary.minVmBus)} · highest <b>{r.summary.maxVm.toFixed(4)} pu</b> at {busName(r.summary.maxVmBus)}</>,
    dist: { title: `Distribution of ${vm.length} buses in their bands`, dots: vm, worst: vWorst, band: [0.25 / 1.5, 1.25 / 1.5], left: 'below', right: 'above' },
    score: { title: 'Outside band', text: String(outside), cap: `bus${outside === 1 ? '' : 'es'} outside V min–V max`, cls: outside ? 'hot' : 'ok' },
  }
  // reactive headroom of each regulating unit: 0 = at a Q limit, 1 = mid-range
  const q = data.generators.filter((g) => g.status && !isFixedPQ(g)).flatMap((g) => {
    const res = r.generators.find((x) => x.bus === g.bus && x.id === g.id)
    if (!res) return []
    const head = clamp(Math.min(g.qmax - res.qg, res.qg - g.qmin) / ((g.qmax - g.qmin) / 2 || 1))
    return [{ x: head, label: `${labelOf(`generator:${g.bus}-${g.id}`, data)} ${res.qg.toFixed(1)} Mvar` }]
  })
  const atLimit = q.filter((v) => v.x < 0.02).length
  out.qheadroom = {
    label: 'Q headroom', tile: `${atLimit} at limit`, bad: atLimit > 0, about: ABOUT.qheadroom,
    facts: <>Total Q <b>{r.summary.genQ.toFixed(1)} Mvar</b> from {q.length} regulating unit{q.length === 1 ? '' : 's'}</>,
    dist: q.length ? { title: `Distribution of ${q.length} regulating units`, dots: q, worst: q.reduce((w, v, i) => (v.x < q[w].x ? i : w), 0), ticks: [0], left: 'at limit', right: 'mid-range' } : undefined,
    score: { title: 'At a Q limit', text: String(atLimit), cap: `unit${atLimit === 1 ? '' : 's'} with < 2% headroom`, cls: atLimit ? 'hot' : 'ok' },
  }
  // price
  const ps = r.buses.map((b) => b.price), pmin = Math.min(...ps), pmax = Math.max(...ps)
  const pr = r.buses.map((b) => ({ x: (b.price - pmin) / (pmax - pmin || 1), label: `${busName(b.id)} $${b.price.toFixed(2)}` }))
  out.price = {
    label: 'Price', tile: `λ ${r.summary.lambda.toFixed(1)}`, about: ABOUT.price,
    facts: <>Generation cost <b>${r.summary.genCost.toFixed(0)}/h</b> · losses <b>{(r.summary.lineLossP + r.summary.txLossP).toFixed(2)} MW</b></>,
    dist: { title: `Distribution of ${pr.length} bus prices`, dots: pr, worst: pr.reduce((w, v, i) => (v.x > pr[w].x ? i : w), 0), left: `$${pmin.toFixed(1)}`, right: `$${pmax.toFixed(1)}` },
    score: { title: 'System λ', text: `$${r.summary.lambda.toFixed(1)}`, cap: 'per MWh' },
  }
  // branch loading on 0 … 130% of rating
  const ld = r.branches.filter((b) => b.rating > 0).map((b) => ({ pct: b.loadingPct, x: clamp(b.loadingPct / 130), label: `${labelOf(b.element.split('#')[0], data)} ${b.loadingPct.toFixed(0)}%` }))
  const lw = ld.reduce((w, v, i) => (v.pct > ld[w].pct ? i : w), 0)
  const maxPct = ld.length ? ld[lw].pct : 0
  out.loading = {
    label: 'Branch loading', tile: `max ${maxPct.toFixed(0)}%`, bad: maxPct > 100, about: ABOUT.loading,
    facts: <>{ld.filter((v) => v.pct > 80).length} of {ld.length} rated branches above 80% · {r.summary.violations} limit violation{r.summary.violations === 1 ? '' : 's'}</>,
    dist: ld.length ? { title: `Distribution of ${ld.length} rated branches`, dots: ld, worst: lw, ticks: [100 / 130], left: '0%', right: '130%' } : undefined,
    score: { title: 'Highest loading', text: `${maxPct.toFixed(0)}%`, cap: 'of rating', cls: maxPct > 100 ? 'hot' : maxPct < 80 ? 'ok' : undefined },
  }
  return out
}

const ABOUT = {
  vm: 'Each bus voltage against its own limits: blue toward V min, green mid-band, chartreuse then orange toward V max. Labels show VM in pu.',
  qheadroom: 'How close each regulating unit is to its reactive limit. Orange buses are at or near a Q limit and cannot hold voltage much further.',
  price: 'Marginal price at each bus (the solver\'s OS P) in $/MWh, chartreuse to orange. Spreads come from losses and binding limits.',
  loading: 'Branch flow as a share of its rating: chartreuse above 50%, orange above 80%, red above 100%; thicker lines carry more.',
}

/** The distribution strip: every element as a dot on a 0–1 line, the worst one highlighted and labelled. */
function Dist({ d }: { d: DistSpec }) {
  const w = d.dots[d.worst]
  return (
    <div className="dist">
      <span className="axis" />
      {d.band && <span className="band" style={{ left: `${d.band[0] * 100}%`, width: `${(d.band[1] - d.band[0]) * 100}%` }} title="within limits" />}
      {d.ticks?.map((t) => <span key={t} className="tick" style={{ left: `${t * 100}%` }} />)}
      {d.dots.map((p, i) => <span key={i} className={`dot ${i === d.worst ? 'worst' : ''}`} style={{ left: `${p.x * 100}%` }} title={p.label} />)}
      <span className="end l">{d.left}</span><span className="end r">{d.right}</span>
      {w && <span className="wl" style={{ left: `${Math.min(80, Math.max(20, w.x * 100))}%` }}>{w.label}</span>}
    </div>
  )
}
