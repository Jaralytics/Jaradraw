import { useMemo } from 'react'
import type { ReactNode } from 'react'
import { useStore } from '../scene/store'
import { isLinear, isRenderable } from '../element/types'
import { selectionUnits } from '../element/group'
import { AlignIcon, DeleteNodeIcon, FlipIcon, GroupIcon, LayerIcon, LockIcon } from './icons'
import type { AlignIconKind } from './icons'
import { DuplicateIcon, LibraryAddIcon, TrashIcon } from './iconsExtra'
import { Popover } from './Popover'
import { getShortcut, runShortcut } from './shortcuts'
import { tip } from './Tooltip'

const labelOf = (id: string) => getShortcut(id).label

function ActionButton({ id, children }: { id: string; children: ReactNode }) {
  return (
    <button type="button" className="icon-btn small" aria-label={labelOf(id)} {...tip(id)} onClick={() => runShortcut(id)}>
      {children}
    </button>
  )
}

const LAYERS = [
  ['edit.front', 'front'],
  ['edit.forward', 'forward'],
  ['edit.backward', 'backward'],
  ['edit.back', 'back'],
] as const

const ALIGNS: [string, AlignIconKind][] = [
  ['edit.alignLeft', 'left'],
  ['edit.alignCenterH', 'centerH'],
  ['edit.alignRight', 'right'],
  ['edit.alignTop', 'top'],
  ['edit.alignMiddle', 'middle'],
  ['edit.alignBottom', 'bottom'],
  ['edit.distributeH', 'distH'],
  ['edit.distributeV', 'distV'],
]

/** Contextual actions for the current selection, centered under the toolbar. */
export function ActionBar() {
  const elements = useStore((s) => s.elements)
  const selectedIds = useStore((s) => s.selectedIds)
  const editing = useStore((s) => s.textEditor !== null)
  const pointEdit = useStore((s) => s.pointEdit)
  const selected = useMemo(() => {
    const ids = new Set(selectedIds)
    return elements.filter((e) => ids.has(e.id) && !e.isDeleted && isRenderable(e))
  }, [elements, selectedIds])
  const units = useMemo(() => selectionUnits(selected, selected.map((e) => e.id), null).length, [selected])

  const nodeActive = pointEdit !== null && (pointEdit.selected != null || pointEdit.waypoint !== undefined) && selected.length === 1 && selected[0].id === pointEdit.id && isLinear(selected[0])

  if (selected.length === 0 || editing) return null
  if (selected.some((e) => e.locked)) {
    return (
      <div className="panel action-bar" role="toolbar" aria-label="Acciones">
        <ActionButton id="edit.lock">
          <LockIcon open />
        </ActionButton>
      </div>
    )
  }
  const grouped = selected.some((e) => e.groupIds.length > 0)

  return (
    <div className="panel action-bar" role="toolbar" aria-label="Acciones">
      <ActionButton id="edit.duplicate">
        <DuplicateIcon />
      </ActionButton>
      <ActionButton id="edit.delete">
        <TrashIcon />
      </ActionButton>
      {nodeActive && (
        <ActionButton id="edit.deleteNode">
          <DeleteNodeIcon />
        </ActionButton>
      )}
      <span className="toolbar-sep" aria-hidden="true" />
      <Popover label="Orden de capas" trigger={<LayerIcon kind="front" />}>
        {(close) => (
          <div className="popover-list">
            {LAYERS.map(([id, kind]) => (
              <button
                key={id}
                type="button"
                className="popover-item"
                onClick={() => {
                  runShortcut(id)
                  close()
                }}
              >
                <LayerIcon kind={kind} />
                <span>{labelOf(id)}</span>
              </button>
            ))}
          </div>
        )}
      </Popover>
      {selected.length >= 2 && (
        <ActionButton id="edit.group">
          <GroupIcon />
        </ActionButton>
      )}
      {grouped && (
        <ActionButton id="edit.ungroup">
          <GroupIcon ungroup />
        </ActionButton>
      )}
      <ActionButton id="edit.flipH">
        <FlipIcon />
      </ActionButton>
      <ActionButton id="edit.flipV">
        <FlipIcon vertical />
      </ActionButton>
      {units >= 2 && (
        <Popover label="Alinear" trigger={<AlignIcon kind="left" />}>
          {(close) => (
            <div className="popover-list">
              {ALIGNS.map(([id, kind]) => (
                <button
                  key={id}
                  type="button"
                  className="popover-item"
                  disabled={kind.startsWith('dist') && units < 3}
                  onClick={() => {
                    runShortcut(id)
                    close()
                  }}
                >
                  <AlignIcon kind={kind} />
                  <span>{labelOf(id)}</span>
                </button>
              ))}
            </div>
          )}
        </Popover>
      )}
      <span className="toolbar-sep" aria-hidden="true" />
      <ActionButton id="edit.lock">
        <LockIcon />
      </ActionButton>
      <ActionButton id="edit.addToLibrary">
        <LibraryAddIcon />
      </ActionButton>
    </div>
  )
}
