// The network diagram: force-directed like the old tool, but with bus names, a legend, issue markers, result
// overlays, and pinned positions (drag a bus; the layout is saved with the case). Click a bus or a branch to select it.
import { useEffect, useMemo, useRef, useState } from 'react'
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation } from 'd3-force'
import { isFixedPQ, key } from '../model/types'
import type { CaseData } from '../model/types'
import type { Issue } from '../model/validate'
import type { SolverOutput } from '../solver/interface'
import { downloadPng } from './export'

export type Overlay = 'area' | 'vm' | 'price' | 'qheadroom' | 'loading'
export const OVERLAYS: [Overlay, string][] = [
  ['area', 'Area (no results)'], ['vm', 'Voltage vs limits'], ['qheadroom', 'Generator Q headroom'], ['price', 'Price (OS P)'], ['loading', 'Branch loading'],
]

type N = { id: string; label: string; x: number; y: number; fx?: number | null; fy?: number | null; star?: boolean; bus?: number }
type E = { id: string; a: string; b: string; kind: 'line' | 'tx' | 'tie'; on: boolean; leg?: string }

const AREA_COLORS = ['#2d3748', '#805ad5', '#2f9e5f', '#dd6b20', '#5b8fd9']
const mix = (a: number[], b: number[], t: number) => `rgb(${a.map((x, i) => Math.round(x + (b[i] - x) * Math.max(0, Math.min(1, t)))).join(',')})`
const BLUE = [79, 134, 214], GREEN = [47, 158, 95], RED = [214, 64, 107], GRAY = [203, 213, 224], AMBER = [246, 184, 41], DARK = [123, 52, 30]

/** Voltage position in its band: 0 = at V min, 1 = at V max. Blue low, green mid, red high. */
export function vmColor(vm: number, vn: number, vx: number) {
  const t = (vm - vn) / (vx - vn || 1)
  if (t < 0) return 'rgb(44,82,160)'
  if (t > 1) return 'rgb(197,48,48)'
  return t < 0.5 ? mix(BLUE, GREEN, t / 0.5) : mix(GREEN, RED, (t - 0.5) / 0.5)
}

export default function Diagram({ data, selected, onSelect, issues, result, overlay, onOverlay, layout, onLayout }: {
  data: CaseData
  selected: string | null
  onSelect: (k: string) => void
  issues: Issue[]
  result?: SolverOutput | null
  overlay: Overlay
  onOverlay?: (o: Overlay) => void
  layout: Record<string, { x: number; y: number }>
  onLayout: (l: Record<string, { x: number; y: number }>) => void
}) {
  const wrap = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)

  // ---- structure
  const { nodes0, edges } = useMemo(() => {
    const nodes0: N[] = data.buses.map((b) => ({ id: key.bus(b), label: b.name, x: 0, y: 0, bus: b.id }))
    const edges: E[] = []
    for (const br of data.branches) {
      const tie = Math.abs(br.r) <= 1e-4 && Math.abs(br.x) <= 1e-4
      edges.push({ id: key.branch(br), a: key.bus({ id: br.from }), b: key.bus({ id: br.to }), kind: tie ? 'tie' : 'line', on: !!br.status })
    }
    for (const t of data.transformers) {
      if (!t.k) { edges.push({ id: key.tx(t), a: key.bus({ id: t.from }), b: key.bus({ id: t.to }), kind: 'tx', on: !!t.status }); continue }
      const s = `star:${key.tx(t)}`
      nodes0.push({ id: s, label: 'Star', x: 0, y: 0, star: true })
      ;[t.from, t.to, t.k].forEach((bus, w) => edges.push({ id: key.tx(t), leg: `${key.tx(t)}#w${w + 1}`, a: key.bus({ id: bus }), b: s, kind: 'tx', on: !!t.status }))
    }
    return { nodes0, edges }
  }, [data])
  const structure = nodes0.map((n) => n.id).join() + '|' + edges.map((e) => `${e.a}-${e.b}`).join()

  // ---- layout: deterministic start on a circle, pinned nodes fixed, 300 ticks
  const [pos, setPos] = useState<Record<string, { x: number; y: number }>>({})
  useEffect(() => {
    const ns: N[] = nodes0.map((n, i) => {
      const p = layout[n.id]
      const a = (i / nodes0.length) * Math.PI * 2
      return { ...n, x: p?.x ?? Math.cos(a) * 200, y: p?.y ?? Math.sin(a) * 200, fx: p ? p.x : null, fy: p ? p.y : null }
    })
    const links = edges.map((e) => ({ source: e.a, target: e.b }))
    const sim = forceSimulation(ns as any)
      .force('link', forceLink(links).id((d: any) => d.id).distance(62).strength(0.8))
      .force('charge', forceManyBody().strength(-330))
      .force('center', forceCenter(0, 0))
      .force('collide', forceCollide(30))
      .stop()
    for (let i = 0; i < 400; i++) sim.tick()
    // stretch the free nodes to the pane's shape, so a tall layout does not end up tiny in a wide pane
    const el = wrap.current
    const free = ns.filter((n) => n.fx === null)
    if (el && free.length > 2 && el.clientHeight > 0) {
      const xs = ns.map((n) => n.x), ys = ns.map((n) => n.y)
      const w = Math.max(...xs) - Math.min(...xs) || 1, h = Math.max(...ys) - Math.min(...ys) || 1
      const target = (el.clientWidth - 120) / (el.clientHeight - 60)
      const sx = Math.min(2.6, Math.max(1, (target * h) / w))
      const cx = (Math.max(...xs) + Math.min(...xs)) / 2
      for (const n of free) n.x = cx + (n.x - cx) * sx
    }
    setPos(Object.fromEntries(ns.map((n) => [n.id, { x: n.x, y: n.y }])))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [structure, Object.keys(layout).length === 0])

  // ---- view box (frozen while dragging)
  const [drag, setDrag] = useState<string | null>(null)
  const vbRef = useRef('0 0 100 100')
  if (!drag) {
    const ps = Object.values(pos)
    if (ps.length) {
      const xs = ps.map((p) => p.x), ys = ps.map((p) => p.y)
      const pad = 48, top = 80 // room for the overlay controls in the top-right corner
      vbRef.current = `${Math.min(...xs) - pad} ${Math.min(...ys) - top} ${Math.max(...xs) - Math.min(...xs) + 2 * pad} ${Math.max(...ys) - Math.min(...ys) + top + pad}`
    }
  }
  const toSvg = (e: React.PointerEvent) => {
    const svg = svgRef.current!
    const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY
    const p = pt.matrixTransform(svg.getScreenCTM()!.inverse())
    return { x: p.x, y: p.y }
  }
  const moved = useRef(false)

  // ---- colors
  const busRes = new Map(result?.buses.map((b) => [b.id, b]) ?? [])
  const genRes = result?.generators ?? []
  const brRes = new Map(result?.branches.map((b) => [b.element, b]) ?? [])
  const prices = result?.buses.map((b) => b.price) ?? []
  const pmin = Math.min(...prices), pmax = Math.max(...prices)
  const fillOf = (n: N): string => {
    if (n.star) return '#fff'
    const b = data.buses.find((x) => x.id === n.bus)!
    if (b.type === 4) return '#e2e8f0'
    if (!result || overlay === 'area' || overlay === 'loading') return AREA_COLORS[(b.area - 1) % AREA_COLORS.length] ?? '#2d3748'
    const r = busRes.get(b.id)
    if (!r) return '#e2e8f0'
    if (overlay === 'vm') return vmColor(r.vm, b.vn, b.vx)
    if (overlay === 'price') return mix(AMBER, DARK, (r.price - pmin) / (pmax - pmin || 1))
    if (overlay === 'qheadroom') {
      const units = data.generators.filter((g) => g.bus === b.id && g.status && !isFixedPQ(g))
      if (!units.length) return mix(GRAY, GRAY, 0)
      const q = units.reduce((a, g) => a + (genRes.find((x) => x.bus === g.bus && x.id === g.id)?.qg ?? 0), 0)
      const lo = units.reduce((a, g) => a + g.qmin, 0), hi = units.reduce((a, g) => a + g.qmax, 0)
      const head = Math.min(hi - q, q - lo) / ((hi - lo) / 2 || 1)
      return mix(RED, GREEN, head)
    }
    return '#2d3748'
  }
  const edgeStyle = (e: E): { stroke?: string; width?: number } => {
    if (overlay !== 'loading' || !result) return {}
    const r = brRes.get(e.leg ?? e.id)
    if (!r || !r.rating) return { stroke: '#cbd5e0' }
    const t = r.loadingPct / 100
    return { stroke: t > 1 ? 'rgb(197,48,48)' : t > 0.8 ? 'rgb(221,107,32)' : t > 0.5 ? 'rgb(246,184,41)' : '#a0aec0', width: 1.5 + Math.min(4, t * 3.5) }
  }
  const glyph = (n: N) => {
    if (n.star) return ''
    const b = data.buses.find((x) => x.id === n.bus)!
    const gens = data.generators.filter((g) => g.bus === b.id && g.status)
    if (b.type === 3) return '★'
    if (gens.some((g) => !isFixedPQ(g))) return '~'
    if (gens.length) return '⇅'
    if (data.loads.some((l) => l.bus === b.id && l.status)) return '↓'
    return ''
  }
  const issueAt = (n: N): 'error' | 'warning' | null => {
    const own = issues.filter((i) => {
      if (n.star) return i.element === n.id.replace('star:', '')
      const [kind, rest] = i.element.split(':')
      if (kind === 'bus') return rest === String(n.bus)
      if (kind === 'generator' || kind === 'load' || kind === 'shunt') return rest.split('-')[0] === String(n.bus)
      return false
    })
    return own.some((i) => i.severity === 'error') ? 'error' : own.length ? 'warning' : null
  }
  const selBus = selected?.startsWith('bus:') ? selected : null
  const selEquipBus = selected && /^(generator|load|shunt):/.test(selected) ? `bus:${selected.split(':')[1].split('-')[0]}` : null

  return (
    <div className="diagram" ref={wrap}>
      <svg ref={svgRef} viewBox={vbRef.current} preserveAspectRatio="xMidYMid meet"
        onPointerMove={(e) => { if (!drag) return; moved.current = true; const p = toSvg(e); setPos((ps) => ({ ...ps, [drag]: p })) }}
        onPointerUp={() => {
          if (drag && moved.current) onLayout({ ...layout, [drag]: pos[drag] })
          setDrag(null)
        }}>
        {edges.map((e, i) => {
          const a = pos[e.a], b = pos[e.b]
          if (!a || !b) return null
          const st = edgeStyle(e)
          const issue = issues.find((x) => x.element === e.id)
          return (
            <g key={`${e.id}${i}`} onClick={() => onSelect(e.id)}>
              <line className={`edge ${e.kind} ${e.on ? '' : 'off'} ${selected === e.id ? 'sel' : ''}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                style={st.stroke && selected !== e.id ? { stroke: st.stroke, strokeWidth: st.width } : undefined} />
              <line className="edge-hit" x1={a.x} y1={a.y} x2={b.x} y2={b.y}><title>{e.id}</title></line>
              {issue && <circle className={`issue-dot ${issue.severity === 'warning' ? 'warn' : ''}`} cx={(a.x + b.x) / 2} cy={(a.y + b.y) / 2} r={4} />}
            </g>
          )
        })}
        {nodes0.map((n) => {
          const p = pos[n.id]
          if (!p) return null
          const sel = selBus === n.id || selEquipBus === n.id || selected === n.id.replace('star:', '')
          const iss = issueAt(n)
          const r = busRes.get(n.bus ?? -1)
          return (
            <g key={n.id} className={`node ${sel ? 'sel' : ''}`} transform={`translate(${p.x},${p.y})`}
              onPointerDown={(e) => { (e.target as Element).setPointerCapture?.(e.pointerId); moved.current = false; setDrag(n.id) }}
              onClick={() => { if (!moved.current) onSelect(n.star ? n.id.replace('star:', '') : n.id) }}>
              {n.star
                ? <rect x={-6} y={-6} width={12} height={12} transform="rotate(45)" fill="#fff" stroke="var(--series-1)" strokeWidth={2} />
                : <circle className="body" r={13} fill={fillOf(n)} />}
              {sel && <circle className="ring" r={n.star ? 11 : 18} />}
              <text className="glyph" textAnchor="middle" dy="0.35em">{glyph(n)}</text>
              <text className="name" textAnchor="middle" y={n.star ? 20 : 27}>{n.star ? 'star' : n.label}{r && overlay === 'vm' ? ` · ${r.vm.toFixed(3)}` : ''}{r && overlay === 'price' ? ` · $${r.price.toFixed(1)}` : ''}</text>
              {iss && <circle className={`issue-dot ${iss === 'warning' ? 'warn' : ''}`} cx={10} cy={-10} r={4.5} />}
              {layout[n.id] && <circle className="pin" cx={-11} cy={-11} r={2.6}><title>pinned</title></circle>}
              <title>{n.star ? 'Three-winding transformer star point' : `${n.label}${r ? ` · VM ${r.vm.toFixed(4)} pu · ${r.price.toFixed(2)} $/MWh` : ''}`}</title>
            </g>
          )
        })}
      </svg>
      <div className="diagram-tools">
        {onOverlay && (
          <select value={overlay} onChange={(e) => onOverlay(e.target.value as Overlay)} title={result ? '' : 'Run the case to color by results'}>
            {OVERLAYS.map(([k, l]) => <option key={k} value={k} disabled={k !== 'area' && !result}>{l}</option>)}
          </select>
        )}
        <button className="btn small" disabled={!Object.keys(layout).length} onClick={() => onLayout({})} title="Release pinned buses and lay out again">Unpin all</button>
        <button className="btn small" onClick={() => downloadPng(wrap.current, 'network.png')}>PNG</button>
      </div>
      <div className="legend">
        {(!result || overlay === 'area' || overlay === 'loading') && data.areas.map((a, i) => (
          <div key={a.id}><i style={{ background: AREA_COLORS[i % AREA_COLORS.length] }} />Area {a.id}{a.name ? ` · ${a.name}` : ''}</div>
        ))}
        {result && overlay === 'vm' && <div><span className="bar" style={{ background: 'linear-gradient(90deg, rgb(79,134,214), rgb(47,158,95), rgb(214,64,107))' }} />&nbsp;V min → V max</div>}
        {result && overlay === 'price' && <div><span className="bar" style={{ background: 'linear-gradient(90deg, rgb(246,184,41), rgb(123,52,30))' }} />&nbsp;{pmin.toFixed(1)} → {pmax.toFixed(1)} $/MWh</div>}
        {result && overlay === 'qheadroom' && <div><span className="bar" style={{ background: 'linear-gradient(90deg, rgb(214,64,107), rgb(47,158,95))' }} />&nbsp;at a Q limit → mid-range</div>}
        {result && overlay === 'loading' && <div><span className="line" style={{ background: 'rgb(221,107,32)' }} />&gt; 80% of rating <span className="line" style={{ background: 'rgb(197,48,48)', marginLeft: 6 }} />&gt; 100%</div>}
        <div>★ reference &nbsp; ~ generator &nbsp; ⇅ fixed P/Q &nbsp; ↓ load</div>
        <div><span className="line" style={{ background: '#a0aec0' }} />line <span className="line" style={{ background: 'var(--series-1)', marginLeft: 6 }} />transformer <span className="line" style={{ background: '#4f86d6', marginLeft: 6 }} />tie</div>
        <div><i style={{ background: 'var(--bad)', width: 8, height: 8 }} />error <i style={{ background: 'var(--orange)', width: 8, height: 8, marginLeft: 6 }} />warning · drag a bus to pin it</div>
      </div>
    </div>
  )
}
