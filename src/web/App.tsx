import { useEffect, useState } from 'react'

type Health = { status: string; model: string }

export function App() {
  const [health, setHealth] = useState<Health>()
  const [error, setError] = useState<string>()

  useEffect(() => {
    fetch('/api/health')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json() as Promise<Health>
      })
      .then(setHealth, (err: Error) => setError(err.message))
  }, [])

  return (
    <main className="shell">
      <h1>chibot</h1>
      {health && <p>Connected · model {health.model}</p>}
      {error && <p className="error">Server unreachable: {error}</p>}
    </main>
  )
}
