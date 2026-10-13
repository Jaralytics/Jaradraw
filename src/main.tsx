import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './ui/App'
import { useStore } from './scene/store'
import { initPersistence, loadSaved, startAutosave } from './scene/persist'
import { isDark, loadThemePref } from './scene/theme'
import './styles/app.css'

// Set before the first render so dark mode does not flash light.
document.documentElement.dataset.theme = isDark(loadThemePref()) ? 'dark' : 'light'

const saved = loadSaved()
if (saved) useStore.getState().load(saved)
startAutosave()
void initPersistence()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
