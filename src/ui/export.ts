// Export any table to CSV and any chart or diagram to PNG.

export function download(name: string, content: string | Blob, type = 'text/plain') {
  const blob = typeof content === 'string' ? new Blob([content], { type }) : content
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = name
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function toCsv(header: string[], rows: unknown[][]): string {
  const cell = (v: unknown) => {
    const s = v === null || v === undefined ? '' : typeof v === 'number' ? String(v) : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return [header, ...rows].map((r) => r.map(cell).join(',')).join('\n') + '\n'
}

export const downloadCsv = (name: string, header: string[], rows: unknown[][]) => download(name, toCsv(header, rows), 'text/csv')

const STYLE_PROPS = ['fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'opacity', 'fill-opacity', 'stroke-opacity', 'font-size',
  'font-family', 'font-weight', 'text-anchor', 'dominant-baseline', 'paint-order', 'stroke-linejoin']

/** Render the first <svg> inside `el` to a PNG. CSS variables and classes are inlined so the file looks the same. */
export async function downloadPng(el: HTMLElement | null, name: string) {
  const svg = el?.querySelector('svg')
  if (!svg) return
  const rect = svg.getBoundingClientRect()
  const clone = svg.cloneNode(true) as SVGSVGElement
  const src = [svg, ...svg.querySelectorAll('*')] as Element[]
  const dst = [clone, ...clone.querySelectorAll('*')] as Element[]
  src.forEach((s, i) => {
    const cs = getComputedStyle(s)
    const style = STYLE_PROPS.map((p) => `${p}:${cs.getPropertyValue(p)}`).join(';')
    dst[i].setAttribute('style', style)
  })
  clone.setAttribute('width', String(rect.width))
  clone.setAttribute('height', String(rect.height))
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  const data = new XMLSerializer().serializeToString(clone)
  const img = new Image()
  const url = URL.createObjectURL(new Blob([data], { type: 'image/svg+xml' }))
  await new Promise<void>((ok, bad) => { img.onload = () => ok(); img.onerror = () => bad(new Error('render failed')); img.src = url })
  const scale = 2
  const canvas = document.createElement('canvas')
  canvas.width = rect.width * scale; canvas.height = rect.height * scale
  const ctx = canvas.getContext('2d')!
  // the svg's own background (the diagram's night sky), white when it has none
  const bg = getComputedStyle(svg).backgroundColor
  ctx.fillStyle = !bg || bg === 'transparent' || bg === 'rgba(0, 0, 0, 0)' ? '#fff' : bg
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.scale(scale, scale)
  ctx.drawImage(img, 0, 0, rect.width, rect.height)
  URL.revokeObjectURL(url)
  canvas.toBlob((b) => b && download(name, b, 'image/png'), 'image/png')
}
