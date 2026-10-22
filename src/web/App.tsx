import { useEffect, useState } from 'react'
import { BrowserRouter, Link, Route, Routes } from 'react-router'
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
        <header>
          <Link to="/" className="new-chat">
            New chat
          </Link>
          <span className="model" title={health?.baseURL ?? 'OpenAI'}>
            {health ? health.model : 'Server unreachable'}
          </span>
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
