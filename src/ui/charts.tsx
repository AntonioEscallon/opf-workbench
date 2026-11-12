// Charts. Rules (dataviz skill): one y-axis; a legend for >= 2 series, none for one; series colors by fixed slot;
// 2px lines, >= 8px markers; a tooltip on every mark; text in text colors; every chart has a table next to it.
import {
  Area, Bar, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis,
} from 'recharts'
import type { ReactNode } from 'react'

const S = (n: number) => `var(--series-${n})`
const F = (n: number) => `var(--series-${n}-fill)`
const minus = (s: string) => s.replace('-', '−')

export function Legend({ items }: { items: { label: string; color: string; edge?: string; shape?: 'dot' | 'x' | 'ring' }[] }) {
  return (
    <div className="chart-legend">
      {items.map((i) => (
        <span key={i.label}>
          {i.shape === 'x' ? <b style={{ color: 'var(--bad)', marginRight: 6 }}>×</b>
            : i.shape === 'ring' ? <i style={{ background: '#fff', borderRadius: '50%', ['--edge' as string]: 'var(--bad)' }} />
            : <i style={{ background: i.color, borderRadius: i.shape === 'dot' ? '50%' : 3, ['--edge' as string]: i.edge ?? 'transparent' }} />}
          {i.label}
        </span>
      ))}
    </div>
  )
}

function Tip({ active, payload, render }: { active?: boolean; payload?: { payload: Record<string, unknown> }[]; render: (p: any) => ReactNode }) {
  if (!active || !payload?.length) return null
  return <div className="tip">{render(payload[0].payload)}</div>
}

export type VRow = { name: string; vm: number; vn: number; vx: number; other?: number }

/** Voltage profile by bus: the V min–V max band shaded, VM as a line with dots; buses named on the axis. */
export function VoltageProfile({ rows, otherLabel, label = 'VM' }: { rows: VRow[]; otherLabel?: string; label?: string }) {
  const data = rows.map((r) => ({ ...r, band: [r.vn, r.vx], out: r.vm > r.vx + 1e-4 || r.vm < r.vn - 1e-4 }))
  const lo = Math.min(...rows.map((r) => Math.min(r.vm, r.vn, r.other ?? 9))) - 0.01
  const hi = Math.max(...rows.map((r) => Math.max(r.vm, r.vx, r.other ?? 0))) + 0.01
  return (
    <>
      <Legend items={[
        { label: 'V min – V max band', color: F(5), edge: S(5) },
        { label, color: 'var(--text)', shape: 'dot' },
        ...(otherLabel ? [{ label: otherLabel, color: S(3), shape: 'dot' as const }] : []),
        { label: 'outside band', color: '#fff', shape: 'ring' as const },
      ]} />
      <ResponsiveContainer width="100%" height={300}>
        <ComposedChart data={data} margin={{ left: 4, right: 12, top: 8, bottom: 8 }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="name" interval={0} angle={-40} textAnchor="end" height={56} tick={{ fontSize: 11 }} />
          <YAxis domain={[+lo.toFixed(2), +hi.toFixed(2)]} tickFormatter={(v) => v.toFixed(2)} width={44}
            label={{ value: 'pu', angle: -90, position: 'insideLeft', fill: 'var(--muted)', fontSize: 11 }} />
          <Area dataKey="band" fill={F(5)} stroke={S(5)} strokeWidth={1} type="step" isAnimationActive={false} activeDot={false} />
          {otherLabel && <Line dataKey="other" stroke={S(3)} strokeWidth={2} strokeDasharray="5 4" dot={{ r: 3.5, fill: S(3), stroke: '#fff', strokeWidth: 2 }} isAnimationActive={false} />}
          <Line dataKey="vm" stroke="var(--text)" strokeWidth={2} isAnimationActive={false}
            dot={(p: any) => <circle key={p.index} cx={p.cx} cy={p.cy} r={p.payload.out ? 5.5 : 4} fill={p.payload.out ? '#fff' : 'var(--text)'}
              stroke={p.payload.out ? 'var(--bad)' : '#fff'} strokeWidth={2} />} />
          <Tooltip content={<Tip render={(p) => (
            <><b>{p.name}</b><br />VM {p.vm.toFixed(4)} pu{p.other !== undefined && <> · {otherLabel} {p.other.toFixed(4)}</>}<br />
              band {p.vn.toFixed(3)} – {p.vx.toFixed(3)} pu{p.out ? <><br /><b style={{ color: 'var(--bad)' }}>outside the band</b></> : null}</>
          )} />} />
        </ComposedChart>
      </ResponsiveContainer>
    </>
  )
}

export type QRow = { name: string; qmin: number; qmax: number; qg: number; fixed: boolean }

/** Generator Q against its limits: the Q min–Q max range as a bar, QG as a dot. */
export function GenQChart({ rows }: { rows: QRow[] }) {
  const data = rows.map((r) => ({ ...r, range: [r.qmin, r.qmax], atLimit: r.qg >= r.qmax - 0.05 || r.qg <= r.qmin + 0.05 }))
  return (
    <>
      <Legend items={[{ label: 'Q min – Q max', color: F(2), edge: S(2) }, { label: 'Q (solved)', color: 'var(--text)', shape: 'dot' },
        { label: 'at a limit', color: '#fff', shape: 'ring' }]} />
      <ResponsiveContainer width="100%" height={Math.max(150, 38 * data.length + 50)}>
        <ComposedChart data={data} layout="vertical" margin={{ left: 8, right: 24, top: 4, bottom: 18 }}>
          <CartesianGrid horizontal={false} />
          <XAxis type="number" domain={['auto', 'auto']} tickFormatter={(v) => minus(String(v))}
            label={{ value: 'Mvar', position: 'insideBottom', offset: -10, fill: 'var(--muted)', fontSize: 11 }} />
          <YAxis type="category" dataKey="name" width={110} tickLine={false} />
          <ReferenceLine x={0} stroke="var(--muted)" />
          <Bar dataKey="range" fill={F(2)} stroke={S(2)} strokeWidth={1} radius={4} barSize={12} isAnimationActive={false} />
          <Scatter dataKey="qg" isAnimationActive={false}
            shape={(p: any) => <circle cx={p.cx} cy={p.cy} r={p.payload.atLimit ? 6 : 5} fill={p.payload.atLimit ? '#fff' : 'var(--text)'} stroke={p.payload.atLimit ? 'var(--bad)' : '#fff'} strokeWidth={2} />} />
          <Tooltip cursor={{ fill: 'var(--chip)' }} content={<Tip render={(p) => (
            <><b>{p.name}</b>{p.fixed ? ' (fixed P/Q)' : ''}<br />Q {minus(p.qg.toFixed(2))} Mvar<br />limits {minus(p.qmin.toFixed(2))} … {minus(p.qmax.toFixed(2))} Mvar
              <br />headroom {Math.min(p.qmax - p.qg, p.qg - p.qmin).toFixed(2)} Mvar</>
          )} />} />
        </ComposedChart>
      </ResponsiveContainer>
    </>
  )
}

export type SweepPoint = { x: number; y: number | null; label: string; run: number; status: string; side: 'producing' | 'absorbing' | 'run' }

/**
 * A quantity against the swept parameter. x is the Q set point (Mvar) so absorbing sits left of producing on one
 * monotone axis; ticks carry the power factor. Failed runs are × on the floor; runs with violations are hollow.
 */
export function SweepChart({ points, yLabel, xLabel, onPick, refY }: {
  points: SweepPoint[]; yLabel: string; xLabel: string; onPick?: (run: number) => void; refY?: { y: number; label: string }[]
}) {
  const ok = points.filter((p) => p.y !== null).sort((a, b) => a.x - b.x)
  const ys = ok.map((p) => p.y!)
  const pad = (Math.max(...ys) - Math.min(...ys)) * 0.15 || Math.abs(ys[0] ?? 1) * 0.02 || 0.01
  const rawMin = Math.min(...ys, ...(refY ?? []).map((r) => r.y)) - pad, rawMax = Math.max(...ys, ...(refY ?? []).map((r) => r.y)) + pad
  // round the domain to a "nice" step so the ticks read 0.92, 0.94, ... rather than 0.9219
  const span = rawMax - rawMin || 1
  const mag = 10 ** Math.floor(Math.log10(span / 4))
  const tickStep = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((x) => span / x <= 6) ?? mag * 10
  const yMin = Math.floor(rawMin / tickStep) * tickStep, yMax = Math.ceil(rawMax / tickStep) * tickStep
  const yTicks: number[] = []
  for (let t = yMin; t <= yMax + tickStep / 2; t += tickStep) yTicks.push(+t.toPrecision(10))
  const failed = points.filter((p) => p.y === null).map((p) => ({ ...p, y: yMin }))
  const series = (side: SweepPoint['side']) => ok.filter((p) => p.side === side)
  const sides = (['absorbing', 'producing', 'run'] as const).filter((s) => series(s).length)
  const color = { absorbing: 2, producing: 1, run: 5 }
  const fmtY = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 1 ? v.toFixed(2) : Math.abs(v) < 1e-3 && v !== 0 ? v.toExponential(1) : v.toFixed(4))
  const dot = (p: any, side: SweepPoint['side']) => {
    const bad = p.payload.status === 'limits_violated'
    return <circle key={p.payload.run} cx={p.cx} cy={p.cy} r={bad ? 5.5 : 5} fill={bad ? '#fff' : S(color[side])} stroke={bad ? 'var(--bad)' : '#fff'} strokeWidth={2}
      style={{ cursor: onPick ? 'pointer' : undefined }} onClick={() => onPick?.(p.payload.run)} />
  }
  const ticks = [...new Set(points.map((p) => p.x))].sort((a, b) => a - b)
  const tickLabel = Object.fromEntries(points.map((p) => [p.x, p.label]))
  return (
    <>
      <Legend items={[
        ...(sides.length > 1 ? sides.map((s) => ({ label: s, color: S(color[s]), shape: 'dot' as const })) : []),
        { label: 'limit violated', color: '#fff', shape: 'ring' },
        ...(failed.length ? [{ label: 'failed run', color: '', shape: 'x' as const }] : []),
      ]} />
      <ResponsiveContainer width="100%" height={320}>
        <ComposedChart margin={{ left: 8, right: 16, top: 8, bottom: 30 }}>
          <CartesianGrid />
          <XAxis type="number" dataKey="x" domain={['dataMin', 'dataMax']} ticks={ticks} interval={0} angle={-35} textAnchor="end" height={60}
            tickFormatter={(v) => tickLabel[v] ?? String(v)} tick={{ fontSize: 11 }} allowDuplicatedCategory={false}
            label={{ value: xLabel, position: 'insideBottom', offset: -26, fill: 'var(--muted)', fontSize: 11 }} />
          <YAxis type="number" dataKey="y" domain={[yMin, yMax]} ticks={yTicks} tickFormatter={(v) => minus(fmtY(v))} width={64}
            label={{ value: yLabel, angle: -90, position: 'insideLeft', fill: 'var(--muted)', fontSize: 11, dy: 50 }} />
          {(refY ?? []).map((r) => <ReferenceLine key={r.label} y={r.y} stroke="var(--text)" strokeDasharray="4 3"
            label={{ value: r.label, position: 'insideTopRight', fill: 'var(--muted)', fontSize: 11 }} />)}
          {sides.map((s) => (
            <Line key={s} data={series(s)} dataKey="y" stroke={S(color[s])} strokeWidth={2} isAnimationActive={false} dot={(p: any) => dot(p, s)} activeDot={false} />
          ))}
          {failed.length > 0 && <Scatter data={failed} dataKey="y" isAnimationActive={false}
            shape={(p: any) => <text x={p.cx} y={p.cy} textAnchor="middle" dy="0.35em" fill="var(--bad)" fontSize={16} fontWeight={700}
              style={{ cursor: onPick ? 'pointer' : undefined }} onClick={() => onPick?.(p.payload.run)}>×</text>} />}
          <Tooltip cursor={{ strokeDasharray: '3 3' }} content={<Tip render={(p) => (
            <><b>Run {p.run}</b> · {p.label}<br />{p.status === 'failed' ? <b style={{ color: 'var(--bad)' }}>failed</b> : <>{yLabel}: {minus(fmtY(p.y))}</>}
              {p.status === 'limits_violated' && <><br /><span style={{ color: 'var(--bad)' }}>limit violated</span></>}</>
          )} />} />
        </ComposedChart>
      </ResponsiveContainer>
    </>
  )
}
