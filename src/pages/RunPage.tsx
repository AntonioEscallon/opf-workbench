// One run, one section at a time: Overview, Buses, Generators, Branches, Diagram, Charts, Log, Solver input.
import { useRef, useState } from 'react'
import { Header, Shell } from '../App'
import { isFixedPQ, key, labelOf } from '../model/types'
import { n } from '../model/validate'
import { translate } from '../solver/codes'
import { objectiveLabel } from '../solver/interface'
import type { BranchResult, BusResult, GenResult } from '../solver/interface'
import { run as getRun, runData, runInput, saveLayout, setUI, useStore } from '../store'
import { go, href } from '../router'
import { DataTable } from '../ui/DataTable'
import type { TCol } from '../ui/DataTable'
import Diagram, { OVERLAYS } from '../ui/Diagram'
import type { Overlay } from '../ui/Diagram'
import { GenQChart, VoltageProfile } from '../ui/charts'
import { download, downloadPng } from '../ui/export'
import { runTargetLabel, runTitle, StatusTag } from './RunsPage'

const SECTIONS: [string, string, string][] = [
  ['overview', 'Overview', 'Status, totals, worst constraint'],
  ['buses', 'Buses', 'VM, VA, margins, prices'],
  ['generators', 'Generators', 'PG, QG, headroom, cost'],
  ['branches', 'Branches', 'Flows, losses, loading'],
  ['diagram', 'Diagram', 'The network colored by a result'],
  ['charts', 'Charts', 'Voltage profile, generator Q'],
  ['log', 'Log', 'The solver\'s iteration log'],
  ['input', 'Solver input', 'The exact snapshot the solver got'],
]
const f = (x: number | undefined | null, d = 2) => (x === undefined || x === null || Number.isNaN(x) ? '' : n(x, d))
const fixed = (d: number) => (v: unknown) => (typeof v === 'number' ? (v < 0 ? '−' : '') + Math.abs(v).toFixed(d) : '')

export default function RunPage({ num, section }: { num: number; section: string }) {
  const s = useStore()
  const r = getRun(num, s)
  const [overlay, setOverlay] = useState<Overlay>('vm')
  const [sel, setSel] = useState<string | null>(null)
  const chartV = useRef<HTMLDivElement>(null), chartQ = useRef<HTMLDivElement>(null)
  if (!r) return <Shell panel={<Header active="runs" />}><div className="frame-scroll"><p className="muted">Run {num} does not exist (the demo data may have been reset). <a href={href('/runs')}>All runs</a></p></div></Shell>
  const data = runData(r)
  const out = r.output
  const sum = out?.summary
  const done = r.status !== 'queued' && r.status !== 'running'
  const failed = r.status === 'failed'
  const tr = out && failed ? translate(out, data) : null

  const openInCase = (element?: string) => {
    setUI({ target: r.scenario ? { kind: 'scenario', num: r.scenario } : { kind: 'version', num: r.version }, selected: element ?? null })
    go('/')
  }

  const panel = (
    <>
      <Header active="runs" />
      <a className="back" href={href('/runs')}>← all runs</a>
      <h2 className="view">Run {r.num} <StatusTag s={r.status} /></h2>
      <p className="muted" style={{ margin: '2px 0 0', fontSize: 14 }}>{objectiveLabel(r.objective)}</p>
      <dl className="facts" style={{ marginTop: 10 }}>
        <dt>Data</dt><dd className="text"><a href="#/" onClick={(e) => { e.preventDefault(); openInCase() }}>{runTargetLabel(r)}</a>{r.scenario ? ` on v${r.version}` : ''}</dd>
        <dt>What</dt><dd className="text">{runTitle(r)}</dd>
        {r.sweep && <><dt>Sweep</dt><dd className="text"><a href={href(`/compare?sweep=${r.sweep}`)}>Sweep {r.sweep}</a></dd></>}
        <dt>Input hash</dt><dd>{r.hash}</dd>
        <dt>Solver</dt><dd className="text">{r.solver}</dd>
        <dt>Finished</dt><dd className="text">{r.finished ? new Date(r.finished).toLocaleString() : '—'}</dd>
      </dl>
      <ul className="sections">
        {SECTIONS.map(([id, name, desc]) => (
          <li key={id}><a className={id === section ? 'on' : ''} href={href(`/run/${r.num}/${id}`)}>{name}<small>{desc}</small></a></li>
        ))}
      </ul>
    </>
  )
  const strip = sum ? (
    <div className="strip">
      <span>Objective<b>{sum.objectiveValue.toLocaleString(undefined, { maximumFractionDigits: 3 })} {sum.objectiveUnit}</b></span>
      <span>Mismatch<b className={sum.mismatch < 1e-4 ? 'good' : 'warn'}>{sum.mismatch.toExponential(2)} pu</b></span>
      <span>Generation<b>{sum.genP.toFixed(1)} MW</b></span>
      <span>Losses<b>{(sum.lineLossP + sum.txLossP).toFixed(2)} MW</b></span>
      <span>Violations<b className={sum.violations ? 'bad' : 'good'}>{sum.violations}</b></span>
    </div>
  ) : <div className="strip"><span>Status<b className={failed ? 'bad' : ''}>{failed ? `failed · code ${out?.code}` : r.status}</b></span></div>

  // ---- tables
  const busRows = (out?.buses ?? []).map((b) => ({ ...b, bus: data.buses.find((x) => x.id === b.id)! }))
  type BR = BusResult & { bus: (typeof data.buses)[number] }
  const busCols: TCol<BR>[] = [
    { key: 'id', label: 'Bus', num: true, value: (b) => b.id },
    { key: 'name', label: 'Name', value: (b) => b.bus.name },
    { key: 'kv', label: 'Base', unit: 'kV', num: true, value: (b) => b.bus.baseKv, fmt: fixed(1) },
    { key: 'vm', label: 'VM', unit: 'pu', num: true, value: (b) => b.vm, fmt: fixed(4),
      cellClass: (b) => (b.vm > b.bus.vx + 1e-4 || b.vm < b.bus.vn - 1e-4 ? 'err' : '') },
    { key: 'va', label: 'VA', unit: '°', num: true, value: (b) => b.va, fmt: fixed(3) },
    { key: 'vn', label: 'V min', unit: 'pu', num: true, value: (b) => b.bus.vn, fmt: fixed(3) },
    { key: 'vx', label: 'V max', unit: 'pu', num: true, value: (b) => b.bus.vx, fmt: fixed(3) },
    { key: 'margin', label: 'Margin', unit: 'pu', num: true, title: 'Distance to the nearer limit; negative = violated', value: (b) => Math.min(b.bus.vx - b.vm, b.vm - b.bus.vn), fmt: fixed(4) },
    { key: 'osv', label: 'OS V', num: true, title: 'Assumed: shadow price of the voltage limit (to be confirmed)', value: (b) => b.osV, fmt: fixed(3) },
    { key: 'osp', label: 'OS P', unit: '$/MWh', num: true, title: 'Assumed: marginal price of real power at the bus', value: (b) => b.osP, fmt: fixed(3) },
    { key: 'osq', label: 'OS Q', unit: '$/Mvarh', num: true, title: 'Assumed: marginal price of reactive power at the bus', value: (b) => b.osQ, fmt: fixed(3) },
  ]
  type GR = GenResult & { g: (typeof data.generators)[number] }
  const genRows: GR[] = (out?.generators ?? []).map((x) => ({ ...x, g: data.generators.find((g) => g.bus === x.bus && g.id === x.id)! }))
  const genCols: TCol<GR>[] = [
    { key: 'unit', label: 'Generator', value: (x) => `${x.bus}-${x.id}` },
    { key: 'mode', label: 'Control', value: (x) => (isFixedPQ(x.g) ? 'Fixed P/Q' : 'Voltage') },
    { key: 'pg', label: 'PG', unit: 'MW', num: true, value: (x) => x.pg, fmt: fixed(3) },
    { key: 'pmin', label: 'P min', unit: 'MW', num: true, value: (x) => x.g.pmin, fmt: fixed(2) },
    { key: 'pmax', label: 'P max', unit: 'MW', num: true, value: (x) => x.g.pmax, fmt: fixed(2) },
    { key: 'qg', label: 'QG', unit: 'Mvar', num: true, value: (x) => x.qg, fmt: fixed(3) },
    { key: 'qmin', label: 'Q min', unit: 'Mvar', num: true, value: (x) => x.g.qmin, fmt: fixed(2) },
    { key: 'qmax', label: 'Q max', unit: 'Mvar', num: true, value: (x) => x.g.qmax, fmt: fixed(2) },
    { key: 'head', label: 'Q headroom', unit: 'Mvar', num: true, value: (x) => Math.min(x.g.qmax - x.qg, x.qg - x.g.qmin), fmt: fixed(2),
      cellClass: (x) => (!isFixedPQ(x.g) && Math.min(x.g.qmax - x.qg, x.qg - x.g.qmin) < 0.05 ? 'warn' : '') },
    { key: 'osp', label: 'OS P', unit: '$/MWh', num: true, value: (x) => x.osP, fmt: fixed(2) },
    { key: 'osq', label: 'OS Q', unit: '$/Mvarh', num: true, value: (x) => x.osQ, fmt: fixed(3) },
    { key: 'cost', label: 'Cost', unit: '$/h', num: true, value: (x) => x.cost, fmt: fixed(2) },
    { key: 'rev', label: 'Revenue', unit: '$/h', num: true, value: (x) => x.revenue, fmt: fixed(2) },
    { key: 'profit', label: 'Profit', unit: '$/h', num: true, value: (x) => x.profit, fmt: fixed(2) },
  ]
  const brCols: TCol<BranchResult>[] = [
    { key: 'el', label: 'Element', value: (b) => (b.element.includes('#') ? `${labelOf(b.element.split('#')[0], data)} wdg ${b.element.slice(-1)}` : labelOf(b.element, data)) },
    { key: 'pf', label: 'P from', unit: 'MW', num: true, value: (b) => b.pFrom, fmt: fixed(3) },
    { key: 'qf', label: 'Q from', unit: 'Mvar', num: true, value: (b) => b.qFrom, fmt: fixed(3) },
    { key: 'pt', label: 'P to', unit: 'MW', num: true, value: (b) => b.pTo, fmt: fixed(3) },
    { key: 'qt', label: 'Q to', unit: 'Mvar', num: true, value: (b) => b.qTo, fmt: fixed(3) },
    { key: 'loss', label: 'Loss', unit: 'MW', num: true, value: (b) => b.loss, fmt: fixed(3) },
    { key: 'rate', label: `Rate ${r.settings.rate}`, unit: 'MVA', num: true, value: (b) => b.rating, fmt: fixed(1) },
    { key: 'load', label: 'Loading', unit: '%', num: true, value: (b) => b.loadingPct, fmt: fixed(1),
      cellClass: (b) => (b.loadingPct > 100 ? 'err' : b.loadingPct > 80 ? 'warn' : '') },
  ]

  const sumRows: [string, string, string][] = sum ? [
    ['Objective', `${sum.objectiveValue.toLocaleString(undefined, { maximumFractionDigits: 4 })}`, sum.objectiveUnit],
    ['System marginal price (λ)', f(sum.lambda, 3), '$/MWh'],
    ['Power mismatch (root of sum of squares)', sum.mismatch.toExponential(3), 'pu'],
    ['Power-flow iterations', String(sum.iterations), ''],
    ...(sum.loadability !== undefined ? [['Load multiplier at the binding limit', f(sum.loadability, 2), '×'] as [string, string, string]] : []),
  ] : []
  const totals: [string, number, number][] = sum ? [
    ['Generation', sum.genP, sum.genQ], ['Fixed load', sum.loadP, sum.loadQ], ['AC line losses', sum.lineLossP, sum.lineLossQ],
    ['Transformer losses', sum.txLossP, sum.txLossQ], ['Fixed shunts', 0, sum.shuntQ],
  ] : []

  return (
    <Shell panel={panel} strip={strip}>
      <div className="frame-scroll" style={['buses', 'generators', 'branches', 'diagram'].includes(section) ? { padding: 0, position: 'relative' } : undefined}>
        {section === 'overview' && (
          <>
            <h2 className="view">Overview</h2>
            <p className="view-sub">{runTitle(r)} · {objectiveLabel(r.objective)}</p>
            {!done && (
              <div className="callout"><b className="t">{r.status === 'queued' ? 'Queued' : 'Running…'}</b>
                <div className="progress"><i style={{ width: `${(r.shown / Math.max(1, out?.log.length ?? 1)) * 100}%` }} /></div>
                <div className="console" style={{ maxHeight: 220 }}>{out?.log.slice(Math.max(0, r.shown - 10), r.shown).join('\n') || 'waiting for the solver…'}</div>
              </div>
            )}
            {done && tr && (
              <div className="callout bad">
                <b className="t">{tr.title}</b>
                <div>{tr.message}</div>
                <div className="muted" style={{ marginTop: 4 }}>{tr.advice}</div>
                {tr.element && <div className="row" style={{ marginTop: 10 }}>
                  <button className="btn small primary" onClick={() => openInCase(tr.element)}>Open {labelOf(tr.element, data)} in {runTargetLabel(r)}</button>
                  <a className="btn small" href={href(`/run/${r.num}/log`)}>See the log</a>
                </div>}
              </div>
            )}
            {done && sum && <>
              <div className={`callout ${r.status === 'optimal' ? 'good' : 'warn'}`}>
                <b className="t">{r.status === 'optimal' ? 'Solved; all limits respected' : `Solved with ${sum.violations} limit violation${sum.violations > 1 ? 's' : ''}`}</b>
                Worst constraint: {sum.worst ? <><a href="#/" onClick={(e) => { e.preventDefault(); openInCase(sum.worst!.element) }}>{sum.worst.text}</a> (margin {f(sum.worst.margin, 3)} of its range)</> : '—'}
              </div>
              <div className="figures">
                <div className="figure"><b>{sum.objectiveValue.toLocaleString(undefined, { maximumFractionDigits: 2 })}<small>{sum.objectiveUnit}</small></b><span>Objective</span></div>
                <div className={`figure ${sum.mismatch < 1e-4 ? 'good' : 'bad'}`}><b>{sum.mismatch.toExponential(1)}<small>pu</small></b><span>Power mismatch</span></div>
                <div className="figure"><b>{sum.minVm.toFixed(3)}<small>Bus {sum.minVmBus}</small></b><span>Min VM (pu)</span></div>
                <div className="figure"><b>{sum.maxVm.toFixed(3)}<small>Bus {sum.maxVmBus}</small></b><span>Max VM (pu)</span></div>
                <div className="figure"><b>{(sum.lineLossP + sum.txLossP).toFixed(2)}<small>MW</small></b><span>Losses</span></div>
                <div className="figure"><b>{sum.lambda.toFixed(2)}<small>$/MWh</small></b><span>Marginal price</span></div>
              </div>
              <div className="grid2">
                <div className="block">
                  <h3>Real and reactive totals</h3>
                  <table>
                    <thead><tr><th></th><th className="num">P <span className="unit">MW</span></th><th className="num">Q <span className="unit">Mvar</span></th></tr></thead>
                    <tbody>{totals.map(([l, p, q]) => <tr key={l}><td>{l}</td><td className="num mono">{f(p, 3)}</td><td className="num mono">{f(q, 3)}</td></tr>)}</tbody>
                  </table>
                  <p className="muted small">Shunt Q is negative when capacitors supply reactive power. Line Q losses include line charging.</p>
                </div>
                <div className="block">
                  <h3>Solution and money</h3>
                  <table><tbody>
                    {sumRows.map(([l, v, u]) => <tr key={l}><td>{l}</td><td className="num mono">{v}</td><td className="muted">{u}</td></tr>)}
                    <tr><td>Generation cost</td><td className="num mono">{f(sum.genCost)}</td><td className="muted">$/h</td></tr>
                    <tr><td>Generator revenue</td><td className="num mono">{f(sum.genRevenue)}</td><td className="muted">$/h</td></tr>
                    <tr><td>Load charge</td><td className="num mono">{f(sum.loadCharge)}</td><td className="muted">$/h</td></tr>
                    <tr><td>Marginal surplus</td><td className="num mono">{f(sum.surplus)}</td><td className="muted">$/h</td></tr>
                  </tbody></table>
                </div>
              </div>
              <div className="block" ref={chartV}>
                <h3><span>Voltage profile</span><span className="row"><a href={href(`/run/${r.num}/charts`)}>more charts</a></span></h3>
                <VoltageProfile rows={busRows.map((b) => ({ name: b.bus.name, vm: b.vm, vn: b.bus.vn, vx: b.bus.vx }))} />
              </div>
            </>}
          </>
        )}
        {section === 'buses' && <DataTable cols={busCols} rows={busRows} rowKey={(b) => key.bus(b)} selected={sel} onSelect={setSel} csvName={`run${r.num}_buses.csv`} empty="No results (the run failed)." />}
        {section === 'generators' && <DataTable cols={genCols} rows={genRows} rowKey={(x) => key.gen(x)} selected={sel} onSelect={setSel} csvName={`run${r.num}_generators.csv`} empty="No results (the run failed)." />}
        {section === 'branches' && <DataTable cols={brCols} rows={out?.branches ?? []} rowKey={(b) => b.element} selected={sel} onSelect={setSel} csvName={`run${r.num}_branches.csv`} empty="No results (the run failed)." />}
        {section === 'diagram' && (out?.summary
          ? <div style={{ position: 'absolute', inset: 0 }}><Diagram data={data} selected={sel} onSelect={setSel} issues={[]} result={out} overlay={overlay} onOverlay={setOverlay} layout={s.layout} onLayout={saveLayout} />
              <div className="muted small" style={{ position: 'absolute', left: 12, top: 10 }}>{OVERLAYS.find(([k]) => k === overlay)?.[1]} · Run {r.num}{sel ? ` · selected ${labelOf(sel, data)}` : ''}</div></div>
          : <p className="muted" style={{ padding: 20 }}>No results to draw.</p>)}
        {section === 'charts' && (sum ? <>
          <h2 className="view">Charts</h2>
          <div className="block" ref={chartV}>
            <h3><span>Voltage profile by bus</span><span className="row"><button className="btn small" onClick={() => downloadPng(chartV.current, `run${r.num}_voltage.png`)}>PNG</button></span></h3>
            <VoltageProfile rows={busRows.map((b) => ({ name: b.bus.name, vm: b.vm, vn: b.bus.vn, vx: b.bus.vx }))} />
          </div>
          <div className="block" ref={chartQ}>
            <h3><span>Generator Q against its limits</span><span className="row"><button className="btn small" onClick={() => downloadPng(chartQ.current, `run${r.num}_gen_q.png`)}>PNG</button></span></h3>
            <GenQChart rows={genRows.map((x) => ({ name: `Gen ${x.bus}-${x.id}${isFixedPQ(x.g) ? ' (P/Q)' : ''}`, qmin: x.g.qmin, qmax: x.g.qmax, qg: x.qg, fixed: isFixedPQ(x.g) }))} />
          </div>
        </> : <p className="muted">No results to chart.</p>)}
        {section === 'log' && <>
          <h2 className="view">Iteration log</h2>
          <p className="view-sub">{done ? `${out?.log.length ?? 0} lines` : 'streaming…'}</p>
          <div className="console" style={{ maxHeight: 'none' }}>
            {(out?.log ?? []).slice(0, r.shown).map((l, i) => <div key={i} className={/ERROR|TERMINATED/.test(l) ? 'bad' : /COMPLETED/.test(l) ? 'ok' : /qlim|scan/.test(l) ? '' : 'dim'}>{l}</div>)}
          </div>
          <button className="btn small" style={{ marginTop: 10 }} onClick={() => download(`run${r.num}.log`, (out?.log ?? []).join('\n'))}>Download log</button>
        </>}
        {section === 'input' && (() => {
          const input = runInput(r)
          const json = JSON.stringify(input, null, 1)
          return <>
            <h2 className="view">Solver input</h2>
            <p className="view-sub">The self-contained snapshot the solver received ({(json.length / 1024).toFixed(0)} kB, hash {r.hash}). The real engine's adapter would read this file.</p>
            <div className="row" style={{ marginBottom: 10 }}>
              <button className="btn small" onClick={() => download(`run${r.num}_input.json`, json, 'application/json')}>Download input JSON</button>
              {out && <button className="btn small" onClick={() => download(`run${r.num}_output.json`, JSON.stringify(out, null, 1), 'application/json')}>Download output JSON</button>}
              {r.patches.length > 0 && <span className="muted small">{r.patches.length} scenario override{r.patches.length > 1 ? 's' : ''} applied on v{r.version}</span>}
            </div>
            <pre className="code">{json.slice(0, 6000)}{json.length > 6000 ? '\n… (truncated here; the download is complete)' : ''}</pre>
          </>
        })()}
      </div>
    </Shell>
  )
}
