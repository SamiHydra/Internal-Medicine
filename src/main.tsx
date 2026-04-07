import { createRoot } from 'react-dom/client'

import { AppProviders } from '@/app/providers'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <AppProviders>
    <App />
  </AppProviders>,
)
