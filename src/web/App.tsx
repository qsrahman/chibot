import { useEffect, useState } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router'
import type { Health } from '../shared/types.ts'
import { getHealth } from './settings/api.ts'
import { ChatPage } from './chat/ChatPage.tsx'
import { Sidebar } from './Sidebar.tsx'
import { MemoriesDialog } from './settings/MemoriesDialog.tsx'
import { useConversations } from './conversations/useConversations.ts'
import { NARROW, useMediaQuery } from './ui/useMediaQuery.ts'
import { useProjects } from './projects/useProjects.ts'
import { readStored, writeStored } from './ui/storage.ts'
import { useUpdateNotice } from './ui/updates.ts'
import { useSettings } from './settings/useSettings.ts'
import { HEALTH_CHECK_MS } from './ui/connection.ts'
import { useReconnect } from './ui/useReconnect.ts'

const COLLAPSED_KEY = 'chibot.sidebarCollapsed'

const loadCollapsed = () => readStored(COLLAPSED_KEY) === '1'
const saveCollapsed = (collapsed: boolean) =>
  writeStored(COLLAPSED_KEY, collapsed ? '1' : '0')

export function App() {
  const [health, setHealth] = useState<Health>()
  const [collapsed, setCollapsed] = useState(loadCollapsed)
  const narrow = useMediaQuery(NARROW)
  // Not remembered: a phone starts on the chat.
  const [drawerOpen, setDrawerOpen] = useState(false)
  // Counts the times chibot came back, for the open chat to load again.
  const [recovered, setRecovered] = useState(0)
  // Opened from Settings and from the chip over an answer.
  const [memoriesOpen, setMemoriesOpen] = useState(false)
  const conversations = useConversations()
  const settings = useSettings()
  const projects = useProjects()

  useEffect(() => {
    getHealth().then(setHealth, () => setHealth(undefined))
    // A page left open while chibot was updated or restarted: look again when
    // it comes back to the front (a failed look leaves what it knew).
    const look = () => void getHealth().then(setHealth, () => {})
    const onShow = () => document.visibilityState === 'visible' && look()
    document.addEventListener('visibilitychange', onShow)
    window.addEventListener('focus', look)
    // A page left open and in front makes no requests of its own, so chibot
    // going away would go unnoticed until the next click.
    const timer = setInterval(
      () => document.visibilityState === 'visible' && look(),
      HEALTH_CHECK_MS,
    )
    return () => {
      document.removeEventListener('visibilitychange', onShow)
      window.removeEventListener('focus', look)
      clearInterval(timer)
    }
  }, [])
  useUpdateNotice(health)
  // Back after chibot was unreachable: load again what failed to load.
  const connection = useReconnect(getHealth, () => {
    void getHealth().then(setHealth, () => {})
    void conversations.refresh()
    void projects.refresh()
    settings.reload()
    setRecovered((n) => n + 1)
  })

  function toggleSidebar() {
    setCollapsed((c) => {
      saveCollapsed(!c)
      return !c
    })
  }

  const page = (
    <ChatPage
      health={health}
      connection={connection}
      recovered={recovered}
      settings={settings}
      projects={projects}
      onListChanged={conversations.refresh}
      conversations={conversations.conversations}
      conversationsLoaded={conversations.loaded}
      // Stays while the drawer is open (behind it, inert), so focus has
      // somewhere to return to.
      onOpenSidebar={narrow ? () => setDrawerOpen(true) : undefined}
      inert={narrow && drawerOpen}
      onShowMemories={() => setMemoriesOpen(true)}
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
          onShowMemories={() => setMemoriesOpen(true)}
        />
        {/* All routes render ChatPage at the same tree position, so moving
            from / (or a project) to /c/:id after the first message keeps
            its state. */}
        <Routes>
          <Route path="/" element={page} />
          <Route path="/c/:id" element={page} />
          <Route path="/projects/:projectId" element={page} />
        </Routes>
        <MemoriesDialog
          open={memoriesOpen}
          onClose={() => setMemoriesOpen(false)}
        />
      </div>
    </BrowserRouter>
  )
}
