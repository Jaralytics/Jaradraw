import { useEffect, useState } from 'react'
import { useStore } from '../scene/store'
import { exportBounds } from '../render/bounds'
import { renderToCanvas } from '../render/export'
import type { LibraryItem } from '../element/library'
import { exportLibraryFile, importLibraryFile } from '../scene/actions'
import { CloseIcon } from './icons'
import { LibraryAddIcon, TrashIcon } from './iconsExtra'

const THUMB = 76
const thumbs = new Map<string, string>()

function Thumb({ item }: { item: LibraryItem }) {
  const [url, setUrl] = useState<string | null>(thumbs.get(item.id) ?? null)
  useEffect(() => {
    if (url) return
    let cancelled = false
    const b = exportBounds(item.elements)
    if (!b) return
    const scale = Math.min(1, THUMB / Math.max(b.width, b.height))
    void renderToCanvas(item.elements, { background: null, scale, files: item.files ?? {} })
      .then((c) => {
        if (!c || cancelled) return
        const data = c.toDataURL('image/png')
        thumbs.set(item.id, data)
        setUrl(data)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [item, url])
  return url ? <img src={url} alt="" draggable={false} /> : <span className="thumb-wait" />
}

export function LibraryPanel() {
  const open = useStore((s) => s.libraryOpen)
  const items = useStore((s) => s.library)
  const toggle = useStore((s) => s.toggleLibrary)
  const insert = useStore((s) => s.insertLibraryItem)
  const remove = useStore((s) => s.deleteLibraryItem)
  const add = useStore((s) => s.addSelectionToLibrary)
  const hasSelection = useStore((s) => s.selectedIds.length > 0)
  if (!open) return null

  return (
    <aside className="panel library-panel" aria-label="Biblioteca">
      <header className="library-head">
        <h2>Biblioteca</h2>
        <button type="button" className="icon-btn small" aria-label="Cerrar biblioteca" onClick={toggle}>
          <CloseIcon />
        </button>
      </header>
      <div className="library-tools">
        <button type="button" className="btn small" disabled={!hasSelection} onClick={add}>
          <LibraryAddIcon /> Añadir selección
        </button>
        <button type="button" className="btn small" onClick={importLibraryFile}>
          Importar
        </button>
        <button type="button" className="btn small" disabled={items.length === 0} onClick={exportLibraryFile}>
          Exportar
        </button>
      </div>
      {items.length === 0 ? (
        <p className="library-empty">Selecciona elementos y usa «Añadir selección» para guardarlos aquí.</p>
      ) : (
        <ul className="library-grid">
          {items.map((item) => (
            <li key={item.id} className="library-item">
              <button
                type="button"
                className="library-thumb"
                data-tip={item.name ?? 'Insertar en el lienzo'}
                aria-label={`Insertar ${item.name ?? 'elemento de la biblioteca'}`}
                onClick={() => insert(item.id)}
              >
                <Thumb item={item} />
              </button>
              <button
                type="button"
                className="icon-btn small library-delete"
                aria-label="Eliminar de la biblioteca"
                data-tip="Eliminar de la biblioteca"
                onClick={() => {
                  thumbs.delete(item.id)
                  remove(item.id)
                }}
              >
                <TrashIcon />
              </button>
            </li>
          ))}
        </ul>
      )}
    </aside>
  )
}
