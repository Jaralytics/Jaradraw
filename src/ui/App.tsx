import { useEffect, useState } from 'react'
import { useStore } from '../scene/store'
import { LibraryPanel } from './LibraryPanel'
import { Canvas } from './Canvas'
import { TextEditor } from './TextEditor'
import { Toolbar } from './Toolbar'
import { StylePanel } from './StylePanel'
import { ZoomControls } from './ZoomControls'
import { FileMenu } from './FileMenu'
import { TemplateMenu } from './TemplateMenu'
import { ModalRoot } from './Modals'
import { CloseIcon, HelpIcon } from './icons'
import { ActionBar } from './ActionBar'
import { TooltipLayer, tip } from './Tooltip'

function Notice({ text, onClose }: { text: string; onClose: () => void }) {
  return (
    <div className="panel notice">
      <span>{text}</span>
      <button type="button" className="icon-btn small" aria-label="Cerrar" onClick={onClose}>
        <CloseIcon />
      </button>
    </div>
  )
}

export function App() {
  const saveError = useStore((s) => s.saveError)
  const filesError = useStore((s) => s.filesError)
  const notice = useStore((s) => s.notice)
  const showModal = useStore((s) => s.showModal)
  const dark = useStore((s) => s.dark)
  const refreshTheme = useStore((s) => s.refreshTheme)
  const dismissNotice = useStore((s) => s.dismissNotice)
  const empty = useStore((s) => s.elements.every((e) => e.isDeleted) && s.draft === null && s.textEditor === null)
  const [hidden, setHidden] = useState({ save: false, files: false })

  useEffect(() => {
    setHidden((h) => ({ save: saveError ? h.save : false, files: filesError ? h.files : false }))
  }, [saveError, filesError])

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
  }, [dark])
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    mq.addEventListener('change', refreshTheme)
    return () => mq.removeEventListener('change', refreshTheme)
  }, [refreshTheme])

  return (
    <>
      <Canvas />
      <TextEditor />
      <Toolbar />
      <StylePanel />
      <ActionBar />
      <ZoomControls />
      <LibraryPanel />
      <FileMenu />
      <TemplateMenu />
      <button
        type="button"
        className="panel icon-btn help-btn"
        aria-label="Atajos de teclado"
        {...tip('view.help')}
        onClick={() => showModal({ kind: 'shortcuts' })}
      >
        <HelpIcon />
      </button>
      {empty && <p className="empty-hint">Elige una herramienta para empezar o pulsa ? para ver los atajos. Con una forma seleccionada, mantén Ctrl y pulsa una flecha para previsualizar nodos conectados (repite para añadir en paralelo) y suelta Ctrl para insertarlos</p>}
      <TooltipLayer />
      <div className="notices" role="status">
        {saveError && !hidden.save && (
          <Notice text="No se pudo guardar el dibujo en este navegador" onClose={() => setHidden((h) => ({ ...h, save: true }))} />
        )}
        {filesError && !hidden.files && (
          <Notice text="No se pudieron guardar las imágenes en este navegador" onClose={() => setHidden((h) => ({ ...h, files: true }))} />
        )}
        {notice && <Notice text={notice} onClose={dismissNotice} />}
      </div>
      <ModalRoot />
    </>
  )
}
