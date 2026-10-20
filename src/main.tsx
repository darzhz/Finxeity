import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from '@/components/ui/sonner'
import App from './App.tsx'
import { queryClient } from '@/lib/query'
import './index.css'

function applySystemTheme() {
  const query = window.matchMedia('(prefers-color-scheme: dark)')
  const update = () => {
    document.documentElement.classList.toggle('dark', query.matches)
  }
  update()
  query.addEventListener('change', update)
}

applySystemTheme()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
      <Toaster position="top-center" />
    </QueryClientProvider>
  </StrictMode>,
)
