import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.tsx'
import { ToastProvider } from './ui/toast.tsx'
import { ErrorBoundary } from './ui/ErrorBoundary.tsx'
import { Tooltips } from './ui/Tooltips.tsx'
import { reloadOnMissingChunk } from './ui/updates.ts'
import './styles.css'

reloadOnMissingChunk()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ToastProvider>
      <ErrorBoundary
        fallback={
          <main className="crashed">
            <h1>Something went wrong</h1>
            <p>chibot could not display this page. Your chats are safe.</p>
            <button
              type="button"
              className="button primary"
              onClick={() => location.reload()}
            >
              Reload
            </button>
          </main>
        }
      >
        <App />
      </ErrorBoundary>
      <Tooltips />
    </ToastProvider>
  </StrictMode>,
)
