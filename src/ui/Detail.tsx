// The detail panel for the selected element: the same fields as its table (editable ones in yellow), computed values
// below them, its issues with one-click fixes, the one-click operations that apply to it, and what it connects to.
import { useEffect, useState } from 'react'
import { findRow, isFixedPQ, key, labelOf } from '../model/types'
import type { CaseData, Generator, Table } from '../model/types'
import { convertToFixedPQ, editField, makeReference, qAtPf, restoreRegulating, toggleInService } from '../model/ops'
import type { Change } from '../model/ops'
import { n } from '../model/validate'
import type { Issue } from '../model/validate'
import type { SolverOutput } from '../solver/interface'
import type { Units } from '../store'
import { COLUMNS, fmtCell, fromDisplay, toDisplay, unitOf, valueOf } from './columns'

const KIND: Record<Table, string> = { buses: 'Bus', loads: 'Load', generators: 'Generator', branches: 'AC line', transformers: 'Transformer', shunts: 'Shunt' }

export function IssueList({ issues, onFix, onPick, data, limit }: {
  issues: Issue[]; onFix?: (i: Issue) => void; onPick?: (element: string) => void; data?: CaseData; limit?: number
}) {
  const [open, setOpen] = useState<string | null>(null)
  const shown = limit ? issues.slice(0, limit) : issues
  if (!issues.length) return <p className="muted small">No issues.</p>
  return (
    <ul className="issues">
      {shown.map((i) => (
        <li key={i.id} className={`issue ${onPick ? 'click' : ''}`} onClick={() => onPick?.(i.element)}>
          <span className={`mark ${i.severity}`} title={i.severity === 'error' ? 'Blocks a run' : 'Warning'} />
          <div>
            <div>{i.message}</div>
            {open === i.id && <div className="why">{i.why}</div>}
            <div className="acts">
              <span className={`tag ${i.severity === 'error' ? 'bad' : 'warn'}`}>{i.severity === 'error' ? 'blocks run' : 'warning'}</span>
              {i.fix && onFix && <button className="btn small" onClick={(e) => { e.stopPropagation(); onFix(i) }}>Fix: {i.fix.label}</button>}
              <button className="btn small link" onClick={(e) => { e.stopPropagation(); setOpen(open === i.id ? null : i.id) }}>{open === i.id ? 'less' : 'why?'}</button>
              {data && i.element !== 'case' && !onPick && <span className="muted small">{labelOf(i.element, data)}</span>}
            </div>
          </div>
        </li>
      ))}
      {limit && issues.length > limit && <li className="muted small" style={{ padding: '6px 2px' }}>… and {issues.length - limit} more in the Issues tab</li>}
    </ul>
  )
}

function Field({ col, row, data, units, readOnly, issue, onCommit }: {
  col: (typeof COLUMNS)['buses'][number]; row: any; data: CaseData; units: Units; readOnly: boolean; issue?: Issue; onCommit: (v: unknown) => void
}) {
  const raw = valueOf(col, row, data)
  const shown = col.options ? String(raw) : fmtCell(col, toDisplay(col, raw, units, data.sbase), units).replace('−', '-')
  const [v, setV] = useState(shown)
  useEffect(() => setV(shown), [shown])
  const unit = unitOf(col, units)
  const commit = () => {
    if (v === shown) return
    if (col.kind === 'text') return onCommit(v)
    const x = Number(v)
    if (Number.isNaN(x)) { setV(shown); return }
    onCommit(col.kind === 'int' ? Math.round(x) : fromDisplay(col, x, units, data.sbase))
  }
  return (
    <div className={`fieldrow ${issue ? (issue.severity === 'error' ? 'err' : 'warn') : ''}`} title={issue?.message}>
      <label title={col.hint}>{col.label}{col.old && <span className="unit"> {col.old}</span>}<span className="unit">{unit}</span></label>
      {readOnly || !col.editable ? <span className="ro">{fmtCell(col, toDisplay(col, raw, units, data.sbase), units) || '—'}</span>
        : col.options ? (
          <select className="editable" value={v} onChange={(e) => { setV(e.target.value); onCommit(Number(e.target.value)) }}>
            {col.options.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        ) : <input className="editable" type="text" value={v} onChange={(e) => setV(e.target.value)} onBlur={commit}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setV(shown) }} />}
    </div>
  )
}

export default function Detail({ data, element, units, readOnly, issues, result, onCommit, onScenario, onSelect, onFix }: {
  data: CaseData
  element: string
  units: Units
  readOnly: boolean
  issues: Issue[]
  result?: { output: SolverOutput; run: number } | null
  onCommit: (c: Change, source?: 'edit' | 'operation' | 'fix') => void
  onScenario: (c: Change) => void
  onSelect: (k: string) => void
  onFix: (i: Issue) => void
}) {
  const hit = findRow(data, element)
  const [pf, setPf] = useState('0.95')
  const [dir, setDir] = useState<'producing' | 'absorbing'>('absorbing')
  const [vs, setVs] = useState('1.02')
  const [qlo, setQlo] = useState('-10')
  const [qhi, setQhi] = useState('10')
  const [qAbs, setQAbs] = useState('')
  useEffect(() => { setPf('0.95'); setQAbs('') }, [element])
  if (!hit) return <p className="muted">The selected element is not in this case.</p>
  const { table, row } = hit as { table: Table; row: any }
  const own = issues.filter((i) => i.element === element)
  const cols = COLUMNS[table]
  const editable = cols.filter((c) => c.editable)
  const computed = cols.filter((c) => !c.editable && !['id', 'bus', 'from', 'to', 'k', 'ckt'].includes(c.key))
  const field = (c: (typeof cols)[number]) => (
    <Field key={c.key} col={c} row={row} data={data} units={units} readOnly={readOnly} issue={own.find((i) => i.field === c.key)}
      onCommit={(v) => onCommit(editField(data, [element], c.key, v))} />
  )

  // ---- one-click operations
  const pfNum = Number(pf)
  const pfOk = pfNum > 0 && pfNum <= 1
  const pNow = table === 'loads' ? -row.pl : table === 'generators' ? row.pg : 0
  const convert = () => convertToFixedPQ(data, element, pfNum, dir === 'producing')
  const bus = table === 'buses' ? row : data.buses.find((b) => b.id === (row.bus ?? row.from))
  const busGen = bus ? data.generators.find((g) => g.bus === bus.id && g.status && !isFixedPQ(g)) : undefined

  // ---- results for this element
  const r = result?.output
  const busR = table === 'buses' ? r?.buses.find((x) => x.id === row.id) : undefined
  const genR = table === 'generators' ? r?.generators.find((x) => x.bus === row.bus && x.id === row.id) : undefined
  const brR = table === 'branches' || table === 'transformers' ? r?.branches.filter((x) => x.element.split('#')[0] === element) : undefined

  const connected: string[] = table === 'buses' ? [
    ...data.generators.filter((g) => g.bus === row.id).map(key.gen),
    ...data.loads.filter((l) => l.bus === row.id).map(key.load),
    ...data.shunts.filter((s) => s.bus === row.id).map(key.shunt),
    ...data.branches.filter((b) => b.from === row.id || b.to === row.id).map(key.branch),
    ...data.transformers.filter((t) => [t.from, t.to, t.k].includes(row.id)).map(key.tx),
  ] : table === 'branches' ? [key.bus({ id: row.from }), key.bus({ id: row.to })]
    : table === 'transformers' ? [row.from, row.to, row.k].filter(Boolean).map((id: number) => key.bus({ id }))
    : [key.bus({ id: row.bus })]
  const inService = table === 'buses' ? row.type !== 4 : !!row.status

  return (
    <div>
      <div className="label" style={{ marginTop: 6 }}>
        <span>{table === 'generators' && isFixedPQ(row) ? 'Fixed P/Q unit' : KIND[table]}</span>
        {!readOnly && <button className="btn small" onClick={() => onCommit(toggleInService(data, element), 'operation')}>{inService ? 'Disable' : 'Enable'}</button>}
      </div>
      <h2 className="view" style={{ fontSize: 19 }}>{labelOf(element, data)} {!inService && <span className="tag gray">out of service</span>}</h2>

      {own.length > 0 && <div style={{ margin: '8px 0' }}><IssueList issues={own} onFix={readOnly ? undefined : onFix} /></div>}

      <div className="fields" style={{ marginTop: 8 }}>{editable.map(field)}</div>
      {computed.length > 0 && <>
        <div className="label">In the case data</div>
        <div className="fields">{computed.map(field)}</div>
      </>}

      {r && (busR || genR || (brR && brR.length > 0)) && <>
        <div className="label">Run {result!.run} result <a href={`#/run/${result!.run}/overview`}>open</a></div>
        <dl className="facts">
          {busR && <>
            <dt>VM</dt><dd>{busR.vm.toFixed(4)} pu</dd><dt>VA</dt><dd>{n(busR.va, 3)}°</dd>
            <dt>Margin to band</dt><dd>{n(Math.min(row.vx - busR.vm, busR.vm - row.vn), 4)} pu</dd>
            <dt>Price (OS P)</dt><dd>{busR.price.toFixed(2)} $/MWh</dd><dt>OS Q</dt><dd>{n(busR.osQ, 3)}</dd>
          </>}
          {genR && <>
            <dt>PG</dt><dd>{n(genR.pg, 3)} MW</dd><dt>QG</dt><dd>{n(genR.qg, 3)} Mvar</dd>
            <dt>Q headroom</dt><dd>{n(Math.min(row.qmax - genR.qg, genR.qg - row.qmin), 3)} Mvar</dd>
            <dt>Cost</dt><dd>{genR.cost.toFixed(2)} $/h</dd><dt>Profit</dt><dd>{genR.profit.toFixed(2)} $/h</dd>
          </>}
          {brR?.map((b) => <span key={b.element} style={{ display: 'contents' }}>
            <dt>{b.element.includes('#') ? `Winding ${b.element.slice(-1)}` : 'Flow'}</dt>
            <dd>{n(b.pFrom, 2)} MW, {n(b.qFrom, 2)} Mvar · {b.loadingPct.toFixed(1)}%</dd>
          </span>)}
        </dl>
      </>}

      {!readOnly && (table === 'generators' || table === 'loads') && (
        <div className="op">
          <h4>Convert to fixed P/Q at power factor</h4>
          <p>Grid-following unit: Q = |P|·tan(acos pf), no voltage regulation (IREG 0), P and Q held in a ±0.01 band (the solver rejects equal limits).
            {table === 'loads' && ' The load is replaced by a unit drawing the same P.'}</p>
          <div className="row">
            <input type="number" step="0.01" min="0.5" max="1" value={pf} onChange={(e) => setPf(e.target.value)} style={{ maxWidth: 80 }} />
            <div className="seg" style={{ flex: 2 }}>
              {(['producing', 'absorbing'] as const).map((d) => <button key={d} className={dir === d ? 'on' : ''} onClick={() => setDir(d)}>{d}</button>)}
            </div>
          </div>
          {pfOk && <p style={{ marginTop: 6 }}>→ P {n(pNow)} MW, Q {n(qAtPf(pNow, pfNum, dir === 'producing'))} Mvar</p>}
          <div className="row" style={{ marginTop: 6 }}>
            <button className="btn small primary" disabled={!pfOk} onClick={() => onCommit(convert(), 'operation')}>Apply</button>
            <button className="btn small" disabled={!pfOk} onClick={() => onScenario(convert())}>As a new scenario</button>
          </div>
        </div>
      )}
      {!readOnly && table === 'generators' && isFixedPQ(row as Generator) && (
        <div className="op">
          <h4>Restore voltage regulation</h4>
          <div className="row">
            <label className="small">VS <input type="number" step="0.005" value={vs} onChange={(e) => setVs(e.target.value)} /></label>
            <label className="small">Q min <input type="number" value={qlo} onChange={(e) => setQlo(e.target.value)} /></label>
            <label className="small">Q max <input type="number" value={qhi} onChange={(e) => setQhi(e.target.value)} /></label>
          </div>
          <button className="btn small primary" style={{ marginTop: 6 }} disabled={Number(qlo) >= Number(qhi)}
            onClick={() => onCommit(restoreRegulating(data, element, Number(vs), Number(qlo), Number(qhi), Math.min(row.pmin, row.pg - 5), Math.max(row.pmax, row.pg + 5)), 'operation')}>Apply</button>
        </div>
      )}
      {!readOnly && table === 'buses' && row.type !== 3 && (
        <div className="op">
          <h4>Make reference bus</h4>
          {busGen ? <>
            <p>Moves the slack here (the old reference becomes a generator bus). Optionally shrink this unit's Q range.</p>
            <div className="row">
              <input type="number" placeholder={`±Q Mvar (now ${n(busGen.qmin)} … ${n(busGen.qmax)})`} value={qAbs} onChange={(e) => setQAbs(e.target.value)} />
              <button className="btn small primary" onClick={() => onCommit(makeReference(data, row.id, qAbs === '' ? undefined : Number(qAbs)), 'operation')}>Apply</button>
            </div>
          </> : <p>Needs an in-service voltage-regulating generator on this bus.</p>}
        </div>
      )}
      {!readOnly && table === 'buses' && row.type === 3 && busGen && (
        <div className="op">
          <h4>Shrink the reference unit's Q range</h4>
          <div className="row">
            <input type="number" placeholder={`±Q Mvar (now ${n(busGen.qmin)} … ${n(busGen.qmax)})`} value={qAbs} onChange={(e) => setQAbs(e.target.value)} />
            <button className="btn small primary" disabled={qAbs === ''} onClick={() => onCommit(makeReference(data, row.id, Number(qAbs)), 'operation')}>Apply</button>
          </div>
        </div>
      )}

      <div className="label">{table === 'buses' ? 'Connected equipment' : 'Connects to'}</div>
      <ul className="sections" style={{ marginTop: 0 }}>
        {connected.map((k) => <li key={k}><a href="#/" onClick={(e) => { e.preventDefault(); onSelect(k) }}>{labelOf(k, data)}
          {issues.some((i) => i.element === k) && <> <span className={`tag ${issues.some((i) => i.element === k && i.severity === 'error') ? 'bad' : 'warn'}`}>issue</span></>}</a></li>)}
      </ul>
    </div>
  )
}
