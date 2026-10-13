import { useStore } from '../scene/store'
import { canRedo, canUndo } from '../scene/history'
import { zoomBy, zoomIn, zoomOut } from '../scene/actions'
import { GridIcon, MinusIcon, SnapIcon, PlusIcon, RedoIcon, UndoIcon } from './icons'
import { KeyHint, tip } from './Tooltip'
import { gridSettings, smartGuidesEnabled } from '../scene/serialize'

export function ZoomControls() {
  const zoom = useStore((s) => s.viewport.zoom)
  const history = useStore((s) => s.history)
  const undo = useStore((s) => s.undo)
  const redo = useStore((s) => s.redo)
  const appState = useStore((s) => s.appState)
  const toggleGrid = useStore((s) => s.toggleGrid)
  const toggleObjectSnap = useStore((s) => s.toggleObjectSnap)

  return (
    <div className="bottom-left">
      <div className="panel group" role="group" aria-label="Zoom">
        <button
          type="button"
          className="icon-btn"
          aria-label="Alejar"
          {...tip('view.zoomOut')}
          onClick={zoomOut}
        >
          <MinusIcon />
        </button>
        <button
          type="button"
          className="zoom-value"
          {...tip('view.zoomReset')}
          aria-label={`Zoom ${Math.round(zoom * 100)}%, restablecer al 100%`}
          onClick={() => zoomBy('reset')}
        >
          {Math.round(zoom * 100)}%
        </button>
        <button
          type="button"
          className="icon-btn"
          aria-label="Acercar"
          {...tip('view.zoomIn')}
          onClick={zoomIn}
        >
          <PlusIcon />
        </button>
      </div>
      <div className="panel group" role="group" aria-label="Ajustes">
        <button
          type="button"
          className="icon-btn"
          aria-pressed={gridSettings(appState).enabled}
          aria-label="Cuadrícula"
          {...tip('view.grid', 'Cuadrícula')}
          onClick={toggleGrid}
        >
          <GridIcon />
          <KeyHint id="view.grid" />
        </button>
        <button
          type="button"
          className="icon-btn"
          aria-pressed={smartGuidesEnabled(appState)}
          aria-label="Guías inteligentes"
          {...tip('view.objectSnap', 'Guías inteligentes')}
          onClick={toggleObjectSnap}
        >
          <SnapIcon />
        </button>
      </div>
      <div className="panel group" role="group" aria-label="Historial">
        <button
          type="button"
          className="icon-btn"
          aria-label="Deshacer"
          {...tip('edit.undo')}
          disabled={!canUndo(history)}
          onClick={undo}
        >
          <UndoIcon />
        </button>
        <button
          type="button"
          className="icon-btn"
          aria-label="Rehacer"
          {...tip('edit.redo')}
          disabled={!canRedo(history)}
          onClick={redo}
        >
          <RedoIcon />
        </button>
      </div>
    </div>
  )
}
