import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.tsx'
import { ToastProvider } from './ui/toast.tsx'
import { Tooltips } from './ui/Tooltips.tsx'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ToastProvider>
      <App />
      <Tooltips />
    </ToastProvider>
  </StrictMode>,
)
