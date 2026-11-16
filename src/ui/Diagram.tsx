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

const AREA_COLORS = ['#133033', '#2f7aa3', '#9aab1c', '#de5b15', '#65797a'] // ink, ocean, olive-lime, burnt orange, slate
const mix = (a: number[], b: number[], t: number) => `rgb(${a.map((x, i) => Math.round(x + (b[i] - x) * Math.max(0, Math.min(1, t)))).join(',')})`
const BLUE = [47, 122, 163], GREEN = [31, 122, 90], RED = [222, 91, 21], GRAY = [215, 215, 215], AMBER = [205, 218, 60], DARK = [222, 91, 21]

/** Ink or white, whichever reads on a fill given as #rrggbb or rgb(r,g,b). */
function inkOn(fill: string) {
  const m = fill.startsWith('#') ? [1, 3, 5].map((i) => parseInt(fill.slice(i, i + 2), 16)) : (fill.match(/\d+/g) ?? []).map(Number)
  if (m.length < 3 || m.some(Number.isNaN)) return '#fff'
  const l = 0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]
  return l > 150 ? '#000' : '#fff'
}

/** Voltage position in its band: 0 = at V min, 1 = at V max. Ocean low, teal-green mid, chartreuse then orange high. */
export function vmColor(vm: number, vn: number, vx: number) {
  const t = (vm - vn) / (vx - vn || 1)
  if (t < 0) return 'rgb(19,48,51)'
  if (t > 1) return 'rgb(232,39,60)'
  // through amber on the high side, so in-between buses stay bright instead of mixing to brown
  return t < 0.5 ? mix(BLUE, GREEN, t / 0.5) : t < 0.75 ? mix(GREEN, AMBER, (t - 0.5) / 0.25) : mix(AMBER, RED, (t - 0.75) / 0.25)
}

export default function Diagram({ data, selected, onSelect, issues, result, overlay, onOverlay, layout, onLayout, inset = 0 }: {
  data: CaseData
  selected: string | null
  onSelect: (k: string) => void
  issues: Issue[]
  result?: SolverOutput | null
  overlay: Overlay
  onOverlay?: (o: Overlay) => void
  layout: Record<string, { x: number; y: number }>
  onLayout: (l: Record<string, { x: number; y: number }>) => void
  /** pixels on the right covered by a floating card: the network is fitted into the space left of it */
  inset?: number
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

  // ---- viewport: the layout is fitted to the pane in screen pixels, so buses keep a readable size at any pane size.
  // The fit is frozen while dragging a bus; zoom and pan sit on top of it (buttons, wheel, drag the background).
  const [size, setSize] = useState({ w: 800, h: 500 })
  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth || 800, h: el.clientHeight || 500 }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const [drag, setDrag] = useState<string | null>(null)
  const [view, setView] = useState({ k: 1, x: 0, y: 0 })
  const pan = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null)
  const fitRef = useRef({ s: 1, cx: 0, cy: 0 })
  if (!drag) {
    const ps = Object.values(pos)
    if (ps.length) {
      const xs = ps.map((p) => p.x), ys = ps.map((p) => p.y)
      const bw = Math.max(...xs) - Math.min(...xs) || 1, bh = Math.max(...ys) - Math.min(...ys) || 1
      const padX = 70, padTop = onOverlay ? 70 : 48, padBottom = 64 // room for the map controls
      const sc = Math.min((size.w - inset - 2 * padX) / bw, (size.h - padTop - padBottom) / bh, 2.4)
      fitRef.current = { s: Math.max(0.2, sc), cx: (Math.max(...xs) + Math.min(...xs)) / 2, cy: (Math.max(...ys) + Math.min(...ys)) / 2 - (padTop - padBottom) / 2 / Math.max(0.2, sc) }
    }
  }
  const { s: fs, cx, cy } = fitRef.current
  const k = fs * view.k
  const ox = size.w / 2 - inset / 2
  const scr = (p: { x: number; y: number }) => ({ x: ox + view.x + (p.x - cx) * k, y: size.h / 2 + view.y + (p.y - cy) * k })
  const px = (e: React.PointerEvent) => { const r = svgRef.current!.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top } }
  const toSvg = (e: React.PointerEvent) => { const p = px(e); return { x: cx + (p.x - ox - view.x) / k, y: cy + (p.y - size.h / 2 - view.y) / k } }
  const zoom = (f: number, at?: { x: number; y: number }) => setView((v) => {
    const nk = Math.max(0.4, Math.min(5, v.k * f)), r = nk / v.k
    const ax = (at?.x ?? ox) - ox, ay = (at?.y ?? size.h / 2) - size.h / 2
    return { k: nk, x: ax - (ax - v.x) * r, y: ay - (ay - v.y) * r }
  })
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
    if (b.type === 4) return '#d7d7d7'
    if (!result || overlay === 'area' || overlay === 'loading') return AREA_COLORS[(b.area - 1) % AREA_COLORS.length] ?? AREA_COLORS[0]
    const r = busRes.get(b.id)
    if (!r) return '#d7d7d7'
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
    return AREA_COLORS[0]
  }
  const edgeStyle = (e: E): { stroke?: string; width?: number } => {
    if (overlay !== 'loading' || !result) return {}
    const r = brRes.get(e.leg ?? e.id)
    if (!r || !r.rating) return { stroke: '#d7d7d7' }
    const t = r.loadingPct / 100
    return { stroke: t > 1 ? 'rgb(232,39,60)' : t > 0.8 ? 'rgb(222,91,21)' : t > 0.5 ? 'rgb(205,218,60)' : '#b9c3c3', width: 1.5 + Math.min(4, t * 3.5) }
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
      <svg ref={svgRef} viewBox={`0 0 ${size.w} ${size.h}`} className={pan.current ? 'panning' : ''}
        onPointerDown={(e) => {
          if (e.target !== svgRef.current) return
          ;(e.target as Element).setPointerCapture?.(e.pointerId)
          const p = px(e); pan.current = { x: p.x, y: p.y, vx: view.x, vy: view.y }
        }}
        onPointerMove={(e) => {
          if (pan.current) { const p = px(e), o = pan.current; setView((v) => ({ ...v, x: o.vx + p.x - o.x, y: o.vy + p.y - o.y })); return }
          if (!drag) return; moved.current = true; const p = toSvg(e); setPos((ps) => ({ ...ps, [drag]: p }))
        }}
        onPointerUp={() => {
          pan.current = null
          if (drag && moved.current) onLayout({ ...layout, [drag]: pos[drag] })
          setDrag(null)
        }}
        onWheel={(e) => { if (!e.ctrlKey && !e.metaKey) return; e.preventDefault(); zoom(e.deltaY < 0 ? 1.15 : 1 / 1.15, { x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY }) }}>
        {edges.map((e, i) => {
          if (!pos[e.a] || !pos[e.b]) return null
          const a = scr(pos[e.a]), b = scr(pos[e.b])
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
          if (!pos[n.id]) return null
          const p = scr(pos[n.id])
          const sel = selBus === n.id || selEquipBus === n.id || selected === n.id.replace('star:', '')
          const iss = issueAt(n)
          const r = busRes.get(n.bus ?? -1)
          return (
            <g key={n.id} className={`node ${sel ? 'sel' : ''}`} transform={`translate(${p.x},${p.y})`}
              onPointerDown={(e) => { (e.target as Element).setPointerCapture?.(e.pointerId); moved.current = false; setDrag(n.id) }}
              onClick={() => { if (!moved.current) onSelect(n.star ? n.id.replace('star:', '') : n.id) }}>
              {n.star
                ? <rect x={-6} y={-6} width={12} height={12} transform="rotate(45)" fill="#fff" stroke="var(--lime-deep)" strokeWidth={2} />
                : <circle className="body" r={15} fill={fillOf(n)} />}
              {sel && <circle className="ring" r={n.star ? 12 : 21} />}
              <text className="glyph" textAnchor="middle" dy="0.35em" fill={inkOn(fillOf(n))}>{glyph(n)}</text>
              <text className="name" textAnchor="middle" y={n.star ? 21 : 31}>{n.star ? 'star' : n.label}{r && overlay === 'vm' ? ` · ${r.vm.toFixed(3)}` : ''}{r && overlay === 'price' ? ` · $${r.price.toFixed(1)}` : ''}</text>
              {iss && <circle className={`issue-dot ${iss === 'warning' ? 'warn' : ''}`} cx={12} cy={-12} r={5} />}
              {layout[n.id] && <circle className="pin" cx={-13} cy={-13} r={3}><title>pinned</title></circle>}
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
      </div>
      <div className="map-tools">
        <button className="btn small" disabled={!Object.keys(layout).length} onClick={() => onLayout({})} title="Release pinned buses and lay out again">Unpin all</button>
        <button className="btn small" onClick={() => downloadPng(wrap.current, 'network.png')} title="Download the diagram as a PNG">PNG</button>
        <span className="zoom">
          <button onClick={() => zoom(1.25)} title="Zoom in (or ctrl + wheel)" aria-label="Zoom in">+</button>
          <button onClick={() => zoom(0.8)} title="Zoom out" aria-label="Zoom out">−</button>
          <button onClick={() => setView({ k: 1, x: 0, y: 0 })} title="Fit the whole network" aria-label="Fit">⤢</button>
        </span>
      </div>
      <div className="legend">
        {(!result || overlay === 'area' || overlay === 'loading') && data.areas.map((a, i) => (
          <div key={a.id}><i style={{ background: AREA_COLORS[i % AREA_COLORS.length] }} />Area {a.id}{a.name ? ` · ${a.name}` : ''}</div>
        ))}
        {result && overlay === 'vm' && <div><span className="bar" style={{ background: 'linear-gradient(90deg, rgb(47,122,163), rgb(31,122,90), rgb(205,218,60), rgb(222,91,21))' }} />&nbsp;V min → V max</div>}
        {result && overlay === 'price' && <div><span className="bar" style={{ background: 'linear-gradient(90deg, rgb(205,218,60), rgb(222,91,21))' }} />&nbsp;{pmin.toFixed(1)} → {pmax.toFixed(1)} $/MWh</div>}
        {result && overlay === 'qheadroom' && <div><span className="bar" style={{ background: 'linear-gradient(90deg, rgb(222,91,21), rgb(31,122,90))' }} />&nbsp;at a Q limit → mid-range</div>}
        {result && overlay === 'loading' && <div><span className="line" style={{ background: 'rgb(205,218,60)' }} />&gt; 50% <span className="line" style={{ background: 'rgb(222,91,21)', marginLeft: 6 }} />&gt; 80% of rating <span className="line" style={{ background: 'rgb(232,39,60)', marginLeft: 6 }} />&gt; 100%</div>}
        <div>★ reference &nbsp; ~ generator &nbsp; ⇅ fixed P/Q &nbsp; ↓ load</div>
        <div><span className="line" style={{ background: '#a3afaf' }} />line <span className="line" style={{ background: 'var(--lime-deep)', marginLeft: 6 }} />transformer <span className="line" style={{ background: 'var(--ocean)', marginLeft: 6 }} />tie</div>
        <div><i style={{ background: 'var(--bad)', width: 8, height: 8 }} />error <i style={{ background: '#fff', boxShadow: 'inset 0 0 0 2px var(--warn)', width: 9, height: 9, marginLeft: 6 }} />warning · drag a bus to pin it, the background to pan</div>
      </div>
    </div>
  )
}
