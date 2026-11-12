// A tiny hash router: every view has a URL, so the back button works and a view can be linked. Hash routing also
// works on a static host (GitHub Pages) with no server rewrites.
//   #/                          the case: diagram, equipment tables, validation, edits
//   #/scenarios                 scenarios and parameter sweeps
//   #/runs                      the run queue and history; start a run
//   #/run/<n>/<section>         one run: overview | buses | generators | branches | diagram | charts | log | input
//   #/compare?sweep=1 | ?runs=1,2,3   compare runs against the swept parameter
//   #/data                      import / export (RAW, side files), schema, solver interface
import { useEffect, useState } from 'react'

export type Route = { parts: string[]; query: URLSearchParams }

function parse(): Route {
  const raw = window.location.hash.replace(/^#\/?/, '')
  const [path, qs] = raw.split('?')
  return { parts: path.split('/').filter(Boolean), query: new URLSearchParams(qs ?? '') }
}

export function useRoute(): Route {
  const [r, setR] = useState(parse)
  useEffect(() => {
    const on = () => setR(parse())
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return r
}

export const go = (path: string) => { window.location.hash = path }
export const href = (path: string) => `#${path}`
