import { useStore } from '../scene/store'
import { Dialog } from './Dialog'
import { CATEGORIES, SHORTCUTS, chipsOf, getPlatform } from './shortcuts'
import { Keys } from './Tooltip'
import { CloseIcon } from './icons'
import { ExportModal, RenameFrameModal } from './ExportDialog'

function ShortcutsModal() {
  const close = useStore((s) => s.closeModal)
  const platform = getPlatform()
  return (
    <Dialog title="Atajos de teclado" titleId="shortcuts-title" onClose={close}>
      <button type="button" className="icon-btn dialog-close" aria-label="Cerrar" data-autofocus onClick={close}>
        <CloseIcon />
      </button>
      <div className="shortcut-scroll" tabIndex={0} role="region" aria-label="Lista de atajos">
      <div className="shortcut-groups">
        {CATEGORIES.map((cat) => (
          <section key={cat} aria-label={cat}>
            <h3 className="shortcut-cat">{cat}</h3>
            <dl className="shortcut-list">
              {SHORTCUTS.filter((s) => s.category === cat).map((s) => (
                <div key={s.id} className="shortcut-row">
                  <dt>{s.label}</dt>
                  <dd>
                    {chipsOf(s, platform).length === 0 ? (
                      <span className="only-button">Solo botón</span>
                    ) : (
                      chipsOf(s, platform).map((c, i) => <Keys key={i} chips={c} />)
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
      </div>
    </Dialog>
  )
}

function ConfirmModal({ title, message, confirmLabel, onConfirm, cancelFocus }: {
  cancelFocus?: boolean
  title: string
  message: string
  confirmLabel: string
  onConfirm: () => void
}) {
  const close = useStore((s) => s.closeModal)
  return (
    <Dialog title={title} titleId="confirm-title" onClose={close}>
      <p className="dialog-text">{message}</p>
      <div className="dialog-actions">
        <button type="button" className="btn" data-autofocus={cancelFocus || undefined} onClick={close}>
          Cancelar
        </button>
        <button
          type="button"
          className="btn btn-primary"
          data-autofocus={!cancelFocus || undefined}
          onClick={() => {
            close()
            onConfirm()
          }}
        >
          {confirmLabel}
        </button>
      </div>
    </Dialog>
  )
}

export function ModalRoot() {
  const modal = useStore((s) => s.modal)
  if (!modal) return null
  if (modal.kind === 'shortcuts') return <ShortcutsModal />
  if (modal.kind === 'export') return <ExportModal />
  if (modal.kind === 'renameFrame') return <RenameFrameModal id={modal.id} />
  return <ConfirmModal {...modal} />
}
