import { useEffect, useState } from 'react'
import { BrowserRouter, Link, Route, Routes } from 'react-router'
import { SquarePen } from 'lucide-react'
import { getHealth, type Health } from './api.ts'
import { ChatPage } from './ChatPage.tsx'

export function App() {
  const [health, setHealth] = useState<Health>()

  useEffect(() => {
    getHealth().then(setHealth, () => setHealth(undefined))
  }, [])

  return (
    <BrowserRouter>
      <div className="app">
        <header className="topbar">
          <span className="model" title={health?.baseURL ?? 'OpenAI'}>
            chibot
            <span className="model-name">
              {health ? health.model : 'server unreachable'}
            </span>
          </span>
          <Link to="/" className="icon-button" aria-label="New chat">
            <SquarePen size={20} strokeWidth={1.5} />
          </Link>
        </header>
        {/* Both routes render ChatPage at the same tree position, so moving
            from / to /c/:id after the first message keeps its state. */}
        <Routes>
          <Route path="/" element={<ChatPage />} />
          <Route path="/c/:id" element={<ChatPage />} />
        </Routes>
      </div>
    </BrowserRouter>
  )
}
