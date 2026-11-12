// One table component for equipment and results: labeled columns with units, sort, filter, multi-select (shift-click
// for a range), inline edit (click a yellow cell), bulk edit of the checked rows, issue highlighting, CSV export.
import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { downloadCsv } from './export'

export type TCol<R> = {
  key: string
  label: string
  unit?: string
  title?: string
  num?: boolean
  value: (r: R) => unknown           // raw value: sorting, CSV, filter
  show?: (r: R) => ReactNode         // display (defaults to the formatted value)
  fmt?: (v: unknown) => string
  editable?: boolean
  options?: [number | string, string][]
  cellClass?: (r: R) => string
}

export function DataTable<R>({ cols, rows, rowKey, selected, onSelect, onEdit, onBulk, csvName, toolbarExtra, dimmed, empty, maxHeight }: {
  cols: TCol<R>[]
  rows: R[]
  rowKey: (r: R) => string
  selected?: string | null
  onSelect?: (k: string) => void
  onEdit?: (keys: string[], col: TCol<R>, value: string) => void   // value as typed; parent converts
  onBulk?: boolean
  csvName?: string
  toolbarExtra?: ReactNode
  dimmed?: (r: R) => boolean
  empty?: string
  maxHeight?: number
}) {
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null)
  const [filter, setFilter] = useState('')
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [lastCheck, setLastCheck] = useState<string | null>(null)
  const [editing, setEditing] = useState<{ row: string; col: string; value: string } | null>(null)
  const [bulkCol, setBulkCol] = useState('')
  const [bulkVal, setBulkVal] = useState('')

  const text = (c: TCol<R>, r: R) => { const v = c.value(r); return c.fmt ? c.fmt(v) : v === null || v === undefined ? '' : String(v) }
  const view = useMemo(() => {
    const f = filter.trim().toLowerCase()
    let out = f ? rows.filter((r) => cols.some((c) => text(c, r).toLowerCase().includes(f))) : [...rows]
    if (sort) {
      const c = cols.find((x) => x.key === sort.key)!
      out = out.sort((a, b) => {
        const va = c.value(a), vb = c.value(b)
        if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * sort.dir
        return String(va ?? '').localeCompare(String(vb ?? ''), undefined, { numeric: true }) * sort.dir
      })
    }
    return out
  }, [rows, cols, filter, sort])

  const keys = view.map(rowKey)
  const toggle = (k: string, shift: boolean) => {
    const next = new Set(checked)
    if (shift && lastCheck && keys.includes(lastCheck)) {
      const [a, b] = [keys.indexOf(lastCheck), keys.indexOf(k)].sort((x, y) => x - y)
      keys.slice(a, b + 1).forEach((x) => next.add(x))
    } else if (next.has(k)) next.delete(k); else next.add(k)
    setChecked(next); setLastCheck(k)
  }
  const editableCols = cols.filter((c) => c.editable)
  const commitEdit = () => {
    if (!editing || !onEdit) return
    const c = cols.find((x) => x.key === editing.col)!
    const r = rows.find((x) => rowKey(x) === editing.row)
    if (r && editing.value !== text(c, r)) onEdit([editing.row], c, editing.value)
    setEditing(null)
  }

  return (
    <>
      <div className="toolbar">
        <input type="text" placeholder="Filter rows…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <span className="muted">{view.length === rows.length ? `${rows.length} rows` : `${view.length} of ${rows.length}`}</span>
        <span className="grow" />
        {toolbarExtra}
        {csvName && <button className="btn small" onClick={() => downloadCsv(csvName, cols.map((c) => (c.unit ? `${c.label} (${c.unit})` : c.label)), view.map((r) => cols.map((c) => c.value(r))))}>CSV</button>}
      </div>
      {onBulk && onEdit && checked.size > 0 && (
        <div className="bulk">
          <b>{checked.size} selected</b>
          <span>Set</span>
          <select value={bulkCol} onChange={(e) => setBulkCol(e.target.value)}>
            <option value="">field…</option>
            {editableCols.map((c) => <option key={c.key} value={c.key}>{c.label}{c.unit ? ` (${c.unit})` : ''}</option>)}
          </select>
          <span>to</span>
          {(() => {
            const c = cols.find((x) => x.key === bulkCol)
            return c?.options
              ? <select value={bulkVal} onChange={(e) => setBulkVal(e.target.value)}><option value="">value…</option>{c.options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
              : <input type="text" value={bulkVal} onChange={(e) => setBulkVal(e.target.value)} placeholder="value" />
          })()}
          <button className="btn small primary" disabled={!bulkCol || bulkVal === ''}
            onClick={() => { onEdit([...checked], cols.find((x) => x.key === bulkCol)!, bulkVal); setBulkVal('') }}>Apply to {checked.size}</button>
          <button className="btn small" onClick={() => setChecked(new Set())}>Clear selection</button>
        </div>
      )}
      <div style={maxHeight ? { maxHeight, overflow: 'auto' } : undefined}>
        <table>
          <thead className="sticky">
            <tr>
              {onBulk && <th className="check"><input type="checkbox" checked={checked.size > 0 && keys.every((k) => checked.has(k))}
                onChange={(e) => setChecked(e.target.checked ? new Set(keys) : new Set())} /></th>}
              {cols.map((c) => (
                <th key={c.key} className={`sort ${c.num ? 'num' : ''}`} title={c.title}
                  onClick={() => setSort(sort?.key === c.key ? (sort.dir === 1 ? { key: c.key, dir: -1 } : null) : { key: c.key, dir: 1 })}>
                  {c.label}{c.unit && <span className="unit">{c.unit}</span>}
                  {sort?.key === c.key ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {view.length === 0 && <tr><td colSpan={cols.length + 1} className="muted">{empty ?? 'No rows.'}</td></tr>}
            {view.map((r) => {
              const k = rowKey(r)
              return (
                <tr key={k} className={`click ${selected === k ? 'sel' : ''} ${dimmed?.(r) ? 'dim' : ''}`} onClick={() => onSelect?.(k)}>
                  {onBulk && <td className="check" onClick={(e) => { e.stopPropagation(); toggle(k, e.shiftKey) }}>
                    <input type="checkbox" checked={checked.has(k)} readOnly /></td>}
                  {cols.map((c) => {
                    const isEditing = editing?.row === k && editing.col === c.key
                    const canEdit = c.editable && !!onEdit
                    return (
                      <td key={c.key} className={`${c.num ? 'num mono' : ''} ${canEdit ? 'edit' : ''} ${c.cellClass?.(r) ?? ''}`}
                        onClick={canEdit ? (e) => { e.stopPropagation(); onSelect?.(k); if (!isEditing) setEditing({ row: k, col: c.key, value: c.options ? String(c.value(r)) : text(c, r).replace('−', '-') }) } : undefined}>
                        {isEditing ? (
                          c.options
                            ? <select autoFocus value={editing.value} onChange={(e) => { const v = e.target.value; setEditing(null); if (v !== String(c.value(r))) onEdit!([k], c, v) }} onBlur={() => setEditing(null)}>
                                {c.options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
                            : <input className="cell" autoFocus value={editing.value} onChange={(e) => setEditing({ ...editing, value: e.target.value })}
                                onBlur={commitEdit} onKeyDown={(e) => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') setEditing(null) }} />
                        ) : c.show ? c.show(r) : text(c, r)}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </>
  )
}
