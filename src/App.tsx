// OPF Workbench: the case (diagram + tables + validation), scenarios and sweeps, runs, one run's results, run
// comparison, and data exchange. Every page is a top bar over an optional, foldable left panel and a main card.
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

export type Page = 'case' | 'scenarios' | 'runs' | 'compare' | 'data'

const PANEL_KEY = 'opf-workbench/panel'
const readPanel = () => { try { return localStorage.getItem(PANEL_KEY) !== 'closed' } catch { return true } }

/** The top bar: menu toggle for the side panel, the wordmark, navigation. */
function TopBar({ active, hasPanel, panelOpen, onPanel }: { active: Page; hasPanel: boolean; panelOpen: boolean; onPanel: () => void }) {
  const tab = (id: Page, path: string, label: string) => <a className={active === id ? 'on' : ''} href={href(path)}>{label}</a>
  return (
    <header className="topbar">
      <button className="burger" disabled={!hasPanel} onClick={onPanel} title={panelOpen ? 'Hide the side panel' : 'Show the side panel'} aria-label="Toggle side panel">☰</button>
      <a className="brand" href={href('/')}>
        OPF Workbench <small>a friendlier interface for optimal power flow studies</small>
      </a>
      <nav className="topnav">
        {tab('case', '/', 'Case')}
        {tab('scenarios', '/scenarios', 'Scenarios')}
        {tab('runs', '/runs', 'Runs')}
        {tab('compare', '/compare', 'Compare')}
        {tab('data', '/data', 'Data')}
      </nav>
    </header>
  )
}

const ShellCtx = createContext<{ active: Page; panelOpen: boolean; togglePanel: () => void }>({ active: 'case', panelOpen: true, togglePanel: () => {} })

/** Top bar, an optional left panel (folds away with the menu button), and the main card. */
export function Shell({ panel, children, strip }: { panel?: ReactNode; children: ReactNode; strip?: ReactNode }) {
  const { active, panelOpen, togglePanel } = useContext(ShellCtx)
  const show = !!panel && panelOpen
  return (
    <div className="app">
      <TopBar active={active} hasPanel={!!panel} panelOpen={panelOpen} onPanel={togglePanel} />
      <div className={`shell ${show ? '' : 'nopanel'}`}>
        {panel && <aside className="panel">{panel}</aside>}
        <section className="stage"><div className="frame">{strip}{children}</div></section>
      </div>
    </div>
  )
}

export default function App() {
  const route = useRoute()
  const [toast, setToast] = useState<Toast | null>(null)
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 4500); return () => clearTimeout(t) }, [toast])
  const [panelOpen, setPanelOpen] = useState(readPanel)
  const togglePanel = () => setPanelOpen((o) => { try { localStorage.setItem(PANEL_KEY, o ? 'closed' : 'open') } catch { /* private mode */ } return !o })
  const [page, ...rest] = route.parts
  const active: Page = page === 'run' ? 'runs' : (['scenarios', 'runs', 'compare', 'data'] as const).find((x) => x === page) ?? 'case'
  let view: ReactNode
  if (page === 'scenarios') view = <ScenariosPage />
  else if (page === 'runs') view = <RunsPage />
  else if (page === 'run' && rest[0]) view = <RunPage num={Number(rest[0])} section={rest[1] ?? 'overview'} />
  else if (page === 'compare') view = <ComparePage sweep={route.query.get('sweep')} runs={route.query.get('runs')} />
  else if (page === 'data') view = <DataPage />
  else view = <CasePage />
  return (
    <Ctx.Provider value={{ toast: (t) => setToast(typeof t === 'string' ? { text: t } : t) }}>
      <ShellCtx.Provider value={{ active, panelOpen, togglePanel }}>{view}</ShellCtx.Provider>
      {toast && <div className="toast" role="status">{toast.text}{toast.link && <a href={toast.link.href}>{toast.link.label}</a>}</div>}
    </Ctx.Provider>
  )
}
