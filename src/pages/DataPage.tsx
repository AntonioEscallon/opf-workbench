// Data exchange and reference: RAW / side-file import and export, a live round-trip check, the database schema,
// the solver interface, and the open questions this sketch had to assume answers to.
import { useState } from 'react'
import { Shell, useToast } from '../App'
import { applyCosts, applyVolts, readRaw, writeCosts, writeRaw, writeVolts } from '../model/raw'
import { addVersion, head, resetDemo, setUI, useStore, version } from '../store'
import { download } from '../ui/export'
import { go, href } from '../router'
import schemaSql from '../../db/schema.sql?raw'
import solverTs from '../solver/interface.ts?raw'

const SECTIONS: [string, string][] = [['exchange', 'Import / export'], ['roundtrip', 'Round-trip check'], ['schema', 'Database schema'], ['solver', 'Solver interface'], ['questions', 'Open questions']]

export default function DataPage() {
  const s = useStore()
  const toast = useToast()
  const [section, setSection] = useState('exchange')
  const [vnum, setVnum] = useState(head(s).num)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [rt, setRt] = useState<null | { ok: boolean; lines: string[] }>(null)
  const v = version(vnum, s) ?? head(s)
  const base = `mock17_v${v.num}`

  const readFile = (accept: string, then: (text: string, name: string) => void) => {
    const input = document.createElement('input')
    input.type = 'file'; input.accept = accept
    input.onchange = () => { const f = input.files?.[0]; if (f) f.text().then((t) => then(t, f.name)) }
    input.click()
  }
  const importRaw = (text: string, name: string) => {
    try {
      const c = readRaw(text)
      const n = addVersion(c, `Imported ${name} (${c.buses.length} buses, ${c.generators.length} generators, ${c.branches.length} lines, ${c.transformers.length} transformers)`, 'import')
      setMsg({ ok: true, text: `v${n} created from ${name}. Voltage limits and costs are defaults until the side files are applied.` })
      setVnum(n)
    } catch (e) { setMsg({ ok: false, text: `${name}: ${(e as Error).message}` }) }
  }
  const importSide = (kind: 'volts' | 'costs') => (text: string, name: string) => {
    try {
      const r = (kind === 'volts' ? applyVolts : applyCosts)(head().data, text)
      const n = addVersion(r.data, `Applied ${name}: ${r.applied} ${kind === 'volts' ? 'buses' : 'generators'}`, 'side_file')
      setMsg({ ok: r.unknown.length === 0, text: `v${n}: ${r.applied} rows applied.${r.unknown.length ? ` Not in the case: ${r.unknown.join(', ')}.` : ''}` })
      setVnum(n)
    } catch (e) { setMsg({ ok: false, text: `${name}: ${(e as Error).message}` }) }
  }
  const roundTrip = () => {
    const text = writeRaw(v.data)
    const back = readRaw(text)
    const again = writeRaw(back)
    const lines: string[] = []
    const strip = (c: typeof v.data) => JSON.stringify({ ...c, buses: c.buses.map(({ vn: _a, vx: _b, vl: _c, vh: _d, ...b }) => b),
      generators: c.generators.map(({ cost1: _a, cost2: _b, ...g }) => g), rawExtras: c.rawExtras ?? undefined })
    const sameModel = strip(back) === strip(v.data)
    const sameText = again === text
    const side = applyCosts(applyVolts(back, writeVolts(v.data)).data, writeCosts(v.data)).data
    const sameAll = JSON.stringify({ ...side, rawExtras: side.rawExtras ?? undefined }) === JSON.stringify({ ...v.data, rawExtras: v.data.rawExtras ?? undefined })
    lines.push(`${sameModel ? '✓' : '✗'} export → import gives the same equipment rows (${v.data.buses.length} buses, ${v.data.loads.length} loads, ${v.data.generators.length} generators, ${v.data.branches.length} lines, ${v.data.transformers.length} transformers, ${v.data.shunts.length} shunts)`)
    lines.push(`${sameText ? '✓' : '✗'} import → export gives the same RAW text, byte for byte (${text.split('\n').length} lines)`)
    lines.push(`${sameAll ? '✓' : '✗'} RAW + Volts + Costs together restore the whole case, limits and costs included`)
    const offShunts = v.data.shunts.filter((x) => !x.status).length
    if (offShunts) lines.push(`note: ${offShunts} out-of-service shunt(s) cannot be written to a v30 bus record and are dropped by RAW`)
    setRt({ ok: sameModel && sameText && sameAll, lines })
  }

  const panel = (
    <>
      <ul className="sections">
        {SECTIONS.map(([id, name]) => <li key={id}><a className={section === id ? 'on' : ''} href="#/data" onClick={(e) => { e.preventDefault(); setSection(id) }}>{name}</a></li>)}
      </ul>
      <div className="label">Demo data</div>
      <p className="hint" style={{ marginTop: 0 }}>Everything here is mock data on a 17-bus system built from the public IEEE 14-bus case, and lives in this browser only.</p>
      <button className="btn" onClick={() => { if (window.confirm('Discard all edits, scenarios and runs and rebuild the demo data?')) { resetDemo(); setUI({ target: { kind: 'version', num: 3 }, selected: null }); toast('Demo data reset'); go('/') } }}>Reset demo data</button>
    </>
  )

  return (
    <Shell panel={panel} strip={<div className="strip"><span>Case<b>{s.caseName}</b></span><span>Versions<b>{s.versions.length}</b></span><span>System base<b>{head(s).data.sbase} MVA</b></span></div>}>
      <div className="frame-scroll">
        {section === 'exchange' && <>
          <h2 className="view">Import and export</h2>
          <p className="view-sub">PSS/E RAW stays the exchange format so existing tools keep working; the database is the working copy. Each import creates a new case version.</p>
          {msg && <div className={`callout ${msg.ok ? 'good' : 'bad'}`}>{msg.text} {msg.ok && <a href={href('/')} onClick={() => setUI({ target: { kind: 'version', num: head().num } })}>Open it</a>}</div>}
          <div className="grid2">
            <div className="block">
              <h3>Import</h3>
              <div className="card"><h4>PSS/E RAW (v26 / v30 layout)</h4><p className="muted small">Bus, load, generator, branch, transformer (2- and 3-winding), area and zone records are parsed; other sections are kept verbatim. Errors name the line and the field.</p>
                <button className="btn small" onClick={() => readFile('.raw,.txt', importRaw)}>Choose .raw file…</button></div>
              <div className="card"><h4>Voltage limits (*_Volts.txt)</h4><p className="muted small">Assumed layout: <code>bus, VN, VX[, VL, VH]</code> per line, <code>#</code> comments. To be matched to the real file.</p>
                <button className="btn small" onClick={() => readFile('.txt,.csv', importSide('volts'))}>Choose file…</button></div>
              <div className="card"><h4>Generator costs (*_Costs.txt)</h4><p className="muted small">Assumed layout: <code>bus, 'id', cost1, cost2</code> per line.</p>
                <button className="btn small" onClick={() => readFile('.txt,.csv', importSide('costs'))}>Choose file…</button></div>
            </div>
            <div className="block">
              <h3>Export</h3>
              <div className="fieldrow"><label>Version</label>
                <select value={v.num} onChange={(e) => setVnum(Number(e.target.value))}>
                  {[...s.versions].reverse().map((x) => <option key={x.num} value={x.num}>v{x.num} · {x.note.slice(0, 70)}</option>)}
                </select></div>
              <div className="row" style={{ marginTop: 8 }}>
                <button className="btn small" onClick={() => download(`${base}.raw`, writeRaw(v.data))}>RAW</button>
                <button className="btn small" onClick={() => download(`${base}_Volts.txt`, writeVolts(v.data))}>Volts.txt</button>
                <button className="btn small" onClick={() => download(`${base}_Costs.txt`, writeCosts(v.data))}>Costs.txt</button>
                <button className="btn small" onClick={() => download(`${base}.json`, JSON.stringify(v.data, null, 1), 'application/json')}>JSON snapshot</button>
              </div>
              <p className="muted small">Scenarios export the same way after “Apply to latest version”. Every run also offers its exact solver input as JSON.</p>
              <h3 style={{ marginTop: 18 }}>RAW preview · v{v.num}</h3>
              <pre className="code" style={{ maxHeight: 340 }}>{writeRaw(v.data).split('\n').slice(0, 40).join('\n')}{'\n…'}</pre>
            </div>
          </div>
        </>}
        {section === 'roundtrip' && <>
          <h2 className="view">Round-trip check</h2>
          <p className="view-sub">RAW import → database → RAW export must be lossless. The same checks run in the test suite (<code>npm test</code>); here they run in the browser on any version.</p>
          <div className="row">
            <select value={v.num} onChange={(e) => { setVnum(Number(e.target.value)); setRt(null) }} style={{ width: 'auto' }}>
              {[...s.versions].reverse().map((x) => <option key={x.num} value={x.num}>v{x.num}</option>)}
            </select>
            <button className="btn primary" onClick={roundTrip}>Run the check on v{v.num}</button>
          </div>
          {rt && <div className={`callout ${rt.ok ? 'good' : 'bad'}`} style={{ marginTop: 14 }}>
            <b className="t">{rt.ok ? 'Lossless' : 'Differences found'}</b>
            {rt.lines.map((l) => <div key={l} className="mono small">{l}</div>)}
          </div>}
          <p className="muted small">Not yet run against a real case file; the test is written so the file can be dropped in.</p>
        </>}
        {section === 'schema' && <>
          <h2 className="view">Database schema</h2>
          <p className="view-sub">SQLite dialect, Postgres-portable. Versions are immutable; scenarios are overrides; runs point at exactly one version (+ scenario) and the hash of their solver input. In this hosted sketch the same tables live in the browser (store.ts).</p>
          <button className="btn small" style={{ marginBottom: 10 }} onClick={() => download('schema.sql', schemaSql)}>Download schema.sql</button>
          <pre className="code" style={{ maxHeight: 'none' }}>{schemaSql}</pre>
        </>}
        {section === 'solver' && <>
          <h2 className="view">Solver interface</h2>
          <p className="view-sub">The optimization engine stays separate. It plugs in behind this contract: a JSON snapshot in, per-element results and a status code out. The stub behind it here runs a dispatch and a Newton power flow so the interface can be exercised end to end; it is not an OPF.</p>
          <pre className="code" style={{ maxHeight: 'none' }}>{solverTs}</pre>
        </>}
        {section === 'questions' && <>
          <h2 className="view">Open questions</h2>
          <p className="view-sub">Assumptions this sketch had to make. Each one is marked where it shows up in the interface.</p>
          <ol style={{ lineHeight: 1.6 }}>
            <li><b>OS V / OS P / OS Q.</b> Shown as shadow prices (marginal cost of a voltage limit, of real and of reactive power at a bus). Unconfirmed.</li>
            <li><b>VL / VH vs VN / VX.</b> Treated as emergency vs normal voltage limits, with a warning when the emergency band is inside the normal band.</li>
            <li><b>Hidden warnings.</b> The old tool let users hide limit warnings. Here every warning stays visible with an explanation and, where obvious, a fix; whether any of them should block a run is open.</li>
            <li><b>The engine's input and output formats.</b> The stub uses a JSON snapshot. An adapter would translate to the engine's own files and invocation once they are known.</li>
            <li><b>Side-file layouts.</b> The Volts and Costs readers use an assumed comma-separated layout.</li>
            <li><b>Cost 1 / Cost 2.</b> Read as linear ($/MWh) and quadratic ($/MWh²) coefficients.</li>
            <li><b>Error codes.</b> The code table (403 etc.) is a placeholder shaped like the old tool's codes.</li>
          </ol>
        </>}
      </div>
    </Shell>
  )
}
