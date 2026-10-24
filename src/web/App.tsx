import { useEffect, useState } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router'
import type { Health } from '../shared/types.ts'
import { getHealth } from './api.ts'
import { ChatPage } from './ChatPage.tsx'
import { Sidebar } from './Sidebar.tsx'
import { useConversations } from './useConversations.ts'
import { NARROW, useMediaQuery } from './useMediaQuery.ts'
import { useProjects } from './useProjects.ts'
import { useSettings } from './useSettings.ts'

const COLLAPSED_KEY = 'chibot.sidebarCollapsed'

// Storage can throw (private windows, blocked site data). The sidebar state
// is a convenience, so it just falls back to expanded.
function loadCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === '1'
  } catch {
    return false
  }
}

function saveCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(COLLAPSED_KEY, collapsed ? '1' : '0')
  } catch {
    // ignore
  }
}

export function App() {
  const [health, setHealth] = useState<Health>()
  const [collapsed, setCollapsed] = useState(loadCollapsed)
  const narrow = useMediaQuery(NARROW)
  // Not remembered: a phone starts on the chat.
  const [drawerOpen, setDrawerOpen] = useState(false)
  const conversations = useConversations()
  const settings = useSettings()
  const projects = useProjects()

  useEffect(() => {
    getHealth().then(setHealth, () => setHealth(undefined))
  }, [])

  function toggleSidebar() {
    setCollapsed((c) => {
      saveCollapsed(!c)
      return !c
    })
  }

  const page = (
    <ChatPage
      health={health}
      settings={settings}
      projects={projects}
      onListChanged={conversations.refresh}
      onOpenSidebar={
        narrow && !drawerOpen ? () => setDrawerOpen(true) : undefined
      }
    />
  )

  return (
    <BrowserRouter>
      <div className="app">
        <Sidebar
          collapsed={narrow ? !drawerOpen : collapsed}
          onToggle={narrow ? () => setDrawerOpen((o) => !o) : toggleSidebar}
          drawer={narrow}
          onDismiss={() => setDrawerOpen(false)}
          conversations={conversations}
          projects={projects}
          settings={settings}
        />
        {/* All routes render ChatPage at the same tree position, so moving
            from / (or a project) to /c/:id after the first message keeps
            its state. */}
        <Routes>
          <Route path="/" element={page} />
          <Route path="/c/:id" element={page} />
          <Route path="/projects/:projectId" element={page} />
        </Routes>
      </div>
    </BrowserRouter>
  )
}
