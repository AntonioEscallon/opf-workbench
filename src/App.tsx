// OPF Workbench: the case (diagram + tables + validation), scenarios and sweeps, runs, one run's results, run
// comparison, and data exchange. Every page is a white left panel and a framed main view.
import { createContext, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { href, useRoute } from './router'
import CasePage from './pages/CasePage'
import ScenariosPage from './pages/ScenariosPage'
import RunsPage from './pages/RunsPage'
import RunPage from './pages/RunPage'
import ComparePage from './pages/ComparePage'
import DataPage from './pages/DataPage'

type Toast = { text: string; link?: { label: string; href: string } }
const Ctx = createContext<{ toast: (t: Toast | string) => void }>({ toast: () => {} })
export const useToast = () => useContext(Ctx).toast

export type Page = 'case' | 'scenarios' | 'runs' | 'compare' | 'data' | ''

/** The left panel's header: title, byline, navigation. */
export function Header({ active }: { active: Page }) {
  const tab = (id: Page, path: string, label: string) => <a className={`btn ${active === id ? 'on' : ''}`} href={href(path)}>{label}</a>
  return (
    <>
      <h1 className="title">OPF Workbench</h1>
      <p className="byline">A sketch of a friendlier interface for optimal power flow studies</p>
      <div className="nav">
        {tab('case', '/', 'Case')}
        {tab('scenarios', '/scenarios', 'Scenarios')}
        {tab('runs', '/runs', 'Runs')}
        {tab('compare', '/compare', 'Compare')}
        {tab('data', '/data', 'Data')}
      </div>
    </>
  )
}

/** Left panel + framed main view. */
export function Shell({ panel, children, strip }: { panel: ReactNode; children: ReactNode; strip?: ReactNode }) {
  return (
    <div className="shell">
      <aside className="panel">{panel}</aside>
      <section className="stage"><div className="frame">{strip}{children}</div></section>
    </div>
  )
}

export default function App() {
  const route = useRoute()
  const [toast, setToast] = useState<Toast | null>(null)
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 4500); return () => clearTimeout(t) }, [toast])
  const [page, ...rest] = route.parts
  let view: ReactNode
  if (page === 'scenarios') view = <ScenariosPage />
  else if (page === 'runs') view = <RunsPage />
  else if (page === 'run' && rest[0]) view = <RunPage num={Number(rest[0])} section={rest[1] ?? 'overview'} />
  else if (page === 'compare') view = <ComparePage sweep={route.query.get('sweep')} runs={route.query.get('runs')} />
  else if (page === 'data') view = <DataPage />
  else view = <CasePage />
  return (
    <Ctx.Provider value={{ toast: (t) => setToast(typeof t === 'string' ? { text: t } : t) }}>
      {view}
      {toast && <div className="toast" role="status">{toast.text}{toast.link && <a href={toast.link.href}>{toast.link.label}</a>}</div>}
    </Ctx.Provider>
  )
}
