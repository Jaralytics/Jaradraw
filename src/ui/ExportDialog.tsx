import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../scene/store'
import { Dialog } from './Dialog'
import { CloseIcon } from './icons'
import { effectiveScale, exportBounds, exportCrop, selectExportElements } from '../render/bounds'
import { guardMissingFiles } from '../scene/actions'
import { downloadBlob, renderPngBlob, renderSvgText, renderToCanvas } from '../render/export'
import type { ExportRequest } from '../render/export'

type Format = 'png' | 'svg'

const canCopy = () => typeof ClipboardItem !== 'undefined' && !!navigator.clipboard?.write

export function ExportModal() {
  const close = useStore((s) => s.closeModal)
  const notify = useStore((s) => s.notify)
  const selectedIds = useStore((s) => s.selectedIds)
  const [format, setFormat] = useState<Format>('png')
  const [background, setBackground] = useState(true)
  const [onlySelection, setOnlySelection] = useState(false)
  const [scale, setScale] = useState(2)
  const [embed, setEmbed] = useState(true)
  const [preview, setPreview] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const hasSelection = selectedIds.length > 0
  const sel = onlySelection && hasSelection

  const request = useMemo(() => {
    const { elements, files, appState } = useStore.getState()
    const list = selectExportElements(elements, sel ? selectedIds : [])
    const crop = sel ? exportCrop(elements, selectedIds) : null
    const req: ExportRequest = {
      background: background ? appState.viewBackgroundColor : null,
      scale: format === 'png' ? scale : 1,
      files,
      crop,
      embed,
      appState,
    }
    return { list, req }
  }, [sel, selectedIds, background, scale, embed, format])

  // The preview only depends on what is exported, not on format, scale or embedding.
  const previewReq = useMemo(() => {
    const { elements, files, appState } = useStore.getState()
    return {
      list: selectExportElements(elements, sel ? selectedIds : []),
      opts: {
        background: background ? appState.viewBackgroundColor : null,
        scale: 1,
        maxSide: 800,
        files,
        crop: sel ? exportCrop(elements, selectedIds) : null,
      },
    }
  }, [sel, selectedIds, background])

  useEffect(() => {
    let cancelled = false
    const timer = setTimeout(() => {
      void renderToCanvas(previewReq.list, previewReq.opts)
        .then((canvas) => {
          if (!cancelled) setPreview(canvas ? canvas.toDataURL('image/png') : null)
        })
        .catch(() => {
          if (!cancelled) setPreview(null)
        })
    }, 150)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [previewReq])

  const bounds = exportBounds(request.list, request.req.crop ?? null)
  const usedScale = bounds ? effectiveScale(bounds.width, bounds.height, request.req.scale) : request.req.scale
  const reduced = format === 'png' && usedScale < request.req.scale - 1e-6

  const doDownload = async () => {
    setBusy(true)
    try {
      if (format === 'png') {
        const blob = await renderPngBlob(request.list, request.req)
        if (!blob) throw new Error('empty')
        downloadBlob(blob, 'jaradraw.png')
      } else {
        const svg = await renderSvgText(request.list, request.req)
        if (!svg) throw new Error('empty')
        downloadBlob(new Blob([svg], { type: 'image/svg+xml' }), 'jaradraw.svg')
      }
      close()
    } catch {
      notify('No se pudo exportar la imagen')
      setBusy(false)
    }
  }

  const doCopy = async () => {
    setBusy(true)
    try {
      const blob = renderPngBlob(request.list, { ...request.req, scale: format === 'png' ? scale : 2 })
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob.then((b) => b ?? Promise.reject(new Error('empty'))) })])
      notify('Imagen copiada al portapapeles')
      close()
    } catch {
      notify('No se pudo copiar la imagen')
      setBusy(false)
    }
  }

  const download = () => guardMissingFiles(request.list, () => void doDownload())
  const copy = () => guardMissingFiles(request.list, () => void doCopy())

  return (
    <Dialog title="Exportar imagen" titleId="export-title" onClose={close}>
      <button type="button" className="icon-btn dialog-close" aria-label="Cerrar" onClick={close}>
        <CloseIcon />
      </button>
      <div className="export-layout">
        <div className="export-preview" aria-label="Vista previa">
          {preview ? <img src={preview} alt="Vista previa de la exportación" /> : <span>Sin vista previa</span>}
        </div>
        <div className="export-options">
          <div className="export-field" role="radiogroup" aria-label="Formato">
            <span className="style-label">Formato</span>
            <div className="segmented">
              {(['png', 'svg'] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  role="radio"
                  aria-checked={format === f}
                  aria-pressed={format === f}
                  className="icon-btn small wide"
                  onClick={() => setFormat(f)}
                >
                  {f.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
          {format === 'png' && (
            <div className="export-field" role="radiogroup" aria-label="Escala">
              <span className="style-label">Escala</span>
              <div className="segmented">
                {[1, 2, 3].map((s) => (
                  <button
                    key={s}
                    type="button"
                    role="radio"
                    aria-checked={scale === s}
                    aria-pressed={scale === s}
                    className="icon-btn small wide"
                    onClick={() => setScale(s)}
                  >
                    {s}x
                  </button>
                ))}
              </div>
            </div>
          )}
          <label className="check">
            <input type="checkbox" checked={background} onChange={(e) => setBackground(e.target.checked)} />
            <span>Incluir fondo</span>
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={sel}
              disabled={!hasSelection}
              onChange={(e) => setOnlySelection(e.target.checked)}
            />
            <span>Solo la selección</span>
          </label>
          <label className="check">
            <input type="checkbox" checked={embed} onChange={(e) => setEmbed(e.target.checked)} />
            <span>Incluir escena para poder reabrirla</span>
          </label>
          {reduced && (
            <p className="export-note" role="status">
              La escala se redujo a {usedScale.toFixed(2)}x por el tamaño de la imagen.
            </p>
          )}
        </div>
      </div>
      <div className="dialog-actions">
        {canCopy() && (
          <button type="button" className="btn" disabled={busy} onClick={copy}>
            Copiar al portapapeles
          </button>
        )}
        <button type="button" className="btn btn-primary" data-autofocus disabled={busy} onClick={download}>
          Descargar
        </button>
      </div>
    </Dialog>
  )
}

export function RenameFrameModal({ id }: { id: string }) {
  const close = useStore((s) => s.closeModal)
  const rename = useStore((s) => s.renameFrame)
  const frame = useStore((s) => s.elements.find((e) => e.id === id))
  const [name, setName] = useState((frame as { name?: string | null } | undefined)?.name ?? '')
  const submit = () => {
    rename(id, name)
    close()
  }
  return (
    <Dialog title="Renombrar marco" titleId="rename-title" onClose={close}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <input
          className="text-input"
          data-autofocus
          aria-label="Nombre del marco"
          value={name}
          placeholder="Marco"
          maxLength={80}
          onChange={(e) => setName(e.target.value)}
          onFocus={(e) => e.target.select()}
        />
        <div className="dialog-actions" style={{ marginTop: 16 }}>
          <button type="button" className="btn" onClick={close}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary">
            Guardar
          </button>
        </div>
      </form>
    </Dialog>
  )
}
