import { useStore } from '../scene/store'
import type { Tool } from '../scene/store'
import {
  deleteAction,
  duplicateSelection,
  createConnectedNode,
  cycleShapeType,
  editSelected,
  goToConnectedNode,
  hasSelectedNode,
  newFile,
  openExportDialog,
  openFile,
  pickImages,
  saveFile,
  zoomBy,
  zoomIn,
  zoomOut,
} from '../scene/actions'
import type { ZOrderOp } from '../element/zorder'
import { isCanvasFocus } from './dom'

export type Category = 'Herramientas' | 'Edición' | 'Diagramas de flujo' | 'Vista' | 'Archivo'
export type Platform = 'mac' | 'other'

export interface Binding {
  /** Compared with event.key (lowercased). */
  key?: string
  /** Compared with event.code; only for letter keys whose character changes with modifiers (never punctuation). */
  code?: string
  /** Ctrl on Windows/Linux, Cmd on macOS. */
  mod?: boolean
  /** undefined means Shift is ignored. */
  shift?: boolean
  alt?: boolean
  /** Text shown for the key when it differs from key. */
  display?: string
}

export interface Shortcut {
  id: string
  label: string
  category: Category
  keys: Binding[]
  /** Absent for shortcuts handled elsewhere (native clipboard events, canvas gestures). */
  run?: (e?: KeyboardEvent) => void
  /** When present and false, the key is left alone (no preventDefault, no run). */
  when?: (e: KeyboardEvent) => boolean
  /** Key chips when they cannot be derived from `keys`: one list of chips per alternative. */
  chips?: (platform: Platform) => string[][]
}

const MOD: Record<Platform, string> = { mac: '⌘', other: 'Ctrl' }
const SHIFT: Record<Platform, string> = { mac: '⇧', other: 'Mayús' }
const ALT: Record<Platform, string> = { mac: '⌥', other: 'Alt' }

const st = () => useStore.getState()

const tool = (id: Tool, label: string, ...keys: string[]): Shortcut => ({
  id: `tool.${id}`,
  label,
  category: 'Herramientas',
  keys: keys.map((key) => ({ key, mod: false, shift: false })),
  run: () => st().setTool(id),
})

const zorder = (id: string, label: string, op: ZOrderOp, shift: boolean, page: 'pageup' | 'pagedown'): Shortcut => ({
  id: `edit.${id}`,
  label,
  category: 'Edición',
  keys: [{ key: page, mod: false, shift, display: page === 'pageup' ? 'Re Pág' : 'Av Pág' }],
  run: () => st().reorderSelection(op),
})

const arrows = ['arrowleft', 'arrowright', 'arrowup', 'arrowdown']
function nudge(e: KeyboardEvent | undefined, step: number): void {
  const d = e ? arrowDelta[e.key.toLowerCase()] : undefined
  if (d) st().nudgeSelection(d[0] * step, d[1] * step)
}

const arrowDelta: Record<string, [number, number]> = {
  arrowleft: [-1, 0],
  arrowright: [1, 0],
  arrowup: [0, -1],
  arrowdown: [0, 1],
}

export const SHORTCUTS: Shortcut[] = [
  tool('selection', 'Selección', 'v', '1'),
  tool('hand', 'Mano', 'h'),
  tool('rectangle', 'Rectángulo', 'r', '2'),
  tool('ellipse', 'Elipse', 'o', '3'),
  tool('diamond', 'Rombo', 'd', '4'),
  tool('arrow', 'Flecha', 'a', '5'),
  tool('line', 'Línea', 'l', '6'),
  tool('text', 'Texto', 't', '7'),
  tool('freedraw', 'Lápiz', 'p', '8'),
  tool('eraser', 'Borrador', 'e', '0'),
  tool('frame', 'Marco', 'f'),
  {
    id: 'tool.image',
    label: 'Imagen',
    category: 'Herramientas',
    keys: [{ key: '9', mod: false, shift: false }],
    run: pickImages,
  },

  {
    id: 'edit.undo',
    label: 'Deshacer',
    category: 'Edición',
    keys: [{ key: 'z', mod: true, shift: false }],
    run: () => st().undo(),
  },
  {
    id: 'edit.redo',
    label: 'Rehacer',
    category: 'Edición',
    keys: [
      { key: 'z', mod: true, shift: true },
      { key: 'y', mod: true },
    ],
    run: () => st().redo(),
  },
  { id: 'edit.copy', label: 'Copiar', category: 'Edición', keys: [{ key: 'c', mod: true }] },
  { id: 'edit.cut', label: 'Cortar', category: 'Edición', keys: [{ key: 'x', mod: true }] },
  { id: 'edit.paste', label: 'Pegar', category: 'Edición', keys: [{ key: 'v', mod: true }] },
  {
    id: 'edit.duplicate',
    label: 'Duplicar',
    category: 'Edición',
    keys: [{ key: 'd', shift: true, mod: false }],
    run: duplicateSelection,
  },
  {
    id: 'edit.dragDuplicate',
    label: 'Duplicar arrastrando y conectar con una flecha',
    category: 'Edición',
    keys: [],
    chips: (p) => [[MOD[p], 'Arrastrar']],
  },
  {
    id: 'edit.dragDuplicatePlain',
    label: 'Duplicar arrastrando sin flecha',
    category: 'Edición',
    keys: [],
    chips: () => [['Alt', 'Arrastrar']],
  },
  {
    id: 'edit.selectAll',
    label: 'Seleccionar todo',
    category: 'Edición',
    keys: [{ key: 'a', mod: true }],
    run: () => st().selectAll(),
  },
  {
    id: 'edit.delete',
    label: 'Eliminar',
    category: 'Edición',
    keys: [{ key: 'delete', display: 'Supr' }, { key: 'backspace', display: 'Retroceso' }],
    run: deleteAction,
  },
  zorder('front', 'Traer al frente', 'front', true, 'pageup'),
  zorder('forward', 'Subir una capa', 'forward', false, 'pageup'),
  zorder('backward', 'Bajar una capa', 'backward', false, 'pagedown'),
  zorder('back', 'Enviar al fondo', 'back', true, 'pagedown'),
  {
    id: 'edit.editText',
    label: 'Editar texto de forma o flecha',
    category: 'Diagramas de flujo',
    keys: [{ key: 'enter', display: 'Intro' }],
    run: () => editSelected(false),
  },
  {
    id: 'flow.createNode',
    label: 'Crear nodos conectados: mantén Ctrl y pulsa una flecha; repite la flecha para añadir nodos en paralelo; suelta Ctrl para insertar',
    category: 'Diagramas de flujo',
    keys: arrows.map((key) => ({ key, mod: true, shift: false })),
    chips: (p) => [[MOD[p], '←', '↑', '↓', '→']],
    run: createConnectedNode,
  },
  {
    id: 'flow.goToNode',
    label: 'Ir al nodo conectado',
    category: 'Diagramas de flujo',
    keys: arrows.map((key) => ({ key, alt: true, mod: false, shift: true })),
    chips: (p) => [[ALT[p], SHIFT[p], '←', '↑', '↓', '→']],
    run: goToConnectedNode,
  },
  {
    id: 'flow.cycleType',
    label: 'Cambiar tipo de figura',
    category: 'Diagramas de flujo',
    keys: [
      { key: 'tab', mod: false, alt: false, shift: false, display: 'Tab' },
      { key: 'tab', mod: false, alt: false, shift: true, display: 'Tab' },
    ],
    when: (e) => isCanvasFocus(e.target) && hasSelectedNode(),
    run: cycleShapeType,
  },
  {
    id: 'edit.editPoints',
    label: 'Editar puntos de línea o flecha',
    category: 'Edición',
    keys: [{ key: 'enter', mod: true, display: 'Intro' }],
    run: () => editSelected(true),
  },
  {
    id: 'edit.nudge',
    label: 'Mover 1 px',
    category: 'Edición',
    keys: arrows.map((key) => ({ key, shift: false })),
    chips: () => [['←', '↑', '↓', '→']],
    run: (e) => nudge(e, 1),
  },
  {
    id: 'edit.nudgeBig',
    label: 'Mover 10 px',
    category: 'Edición',
    keys: arrows.map((key) => ({ key, shift: true, alt: false })),
    chips: (p) => [[SHIFT[p], '←', '↑', '↓', '→']],
    run: (e) => nudge(e, 10),
  },

  {
    id: 'edit.group',
    label: 'Agrupar',
    category: 'Edición',
    keys: [{ key: 'g', shift: true, mod: false }],
    run: () => st().groupSelection(),
  },
  {
    id: 'edit.ungroup',
    label: 'Desagrupar',
    category: 'Edición',
    keys: [{ key: 'u', shift: true, mod: false }],
    run: () => st().ungroupSelection(),
  },
  {
    id: 'edit.addToLibrary',
    label: 'Añadir a la biblioteca',
    category: 'Edición',
    keys: [{ key: 'b', shift: true, mod: false }],
    run: () => st().addSelectionToLibrary(),
  },
  {
    id: 'edit.lock',
    label: 'Bloquear o desbloquear',
    category: 'Edición',
    keys: [{ key: 'l', shift: true, mod: false }],
    run: () => st().toggleLock(),
  },
  {
    id: 'edit.flipH',
    label: 'Voltear horizontalmente',
    category: 'Edición',
    keys: [{ key: 'h', shift: true, mod: false }],
    run: () => st().flipSelection('horizontal'),
  },
  {
    id: 'edit.flipV',
    label: 'Voltear verticalmente',
    category: 'Edición',
    keys: [{ key: 'v', shift: true, mod: false }],
    run: () => st().flipSelection('vertical'),
  },
  {
    id: 'edit.alignLeft',
    label: 'Alinear a la izquierda',
    category: 'Edición',
    keys: [{ key: 'arrowleft', display: '←', mod: true, shift: true }],
    run: () => st().alignSelection('left'),
  },
  {
    id: 'edit.alignRight',
    label: 'Alinear a la derecha',
    category: 'Edición',
    keys: [{ key: 'arrowright', display: '→', mod: true, shift: true }],
    run: () => st().alignSelection('right'),
  },
  { id: 'edit.alignTop', label: 'Alinear arriba', category: 'Edición', keys: [], run: () => st().alignSelection('top') },
  { id: 'edit.alignBottom', label: 'Alinear abajo', category: 'Edición', keys: [], run: () => st().alignSelection('bottom') },
  { id: 'edit.alignCenterH', label: 'Centrar horizontalmente', category: 'Edición', keys: [], run: () => st().alignSelection('centerH') },
  { id: 'edit.alignMiddle', label: 'Centrar verticalmente', category: 'Edición', keys: [], run: () => st().alignSelection('middle') },
  {
    id: 'edit.distributeH',
    label: 'Distribuir horizontalmente',
    category: 'Edición',
    keys: [],
    run: () => st().distributeSelection('horizontal'),
  },
  {
    id: 'edit.distributeV',
    label: 'Distribuir verticalmente',
    category: 'Edición',
    keys: [],
    run: () => st().distributeSelection('vertical'),
  },
  {
    id: 'view.grid',
    label: 'Mostrar cuadrícula y ajustar a ella',
    category: 'Vista',
    keys: [
      { key: 'g', mod: false, shift: false, alt: false },
      { key: "'", display: "'", mod: true },
    ],
    run: () => st().toggleGrid(),
  },
  {
    id: 'view.objectSnap',
    label: 'Guías inteligentes',
    category: 'Vista',
    keys: [{ key: 's', shift: true, mod: false }],
    run: () => st().toggleObjectSnap(),
  },
  {
    id: 'view.snapOff',
    label: 'Suspender ajustes al arrastrar',
    category: 'Vista',
    keys: [],
    chips: (p) => [[MOD[p]]],
  },

  {
    id: 'view.zoomIn',
    label: 'Acercar',
    category: 'Vista',
    keys: [
      { key: '+', mod: true },
      { key: '=', mod: true },
    ],
    chips: (p) => [[MOD[p], '+']],
    run: zoomIn,
  },
  { id: 'view.zoomOut', label: 'Alejar', category: 'Vista', keys: [{ key: '-', mod: true }], run: zoomOut },
  {
    id: 'view.zoomReset',
    label: 'Restablecer zoom al 100%',
    category: 'Vista',
    keys: [{ key: '0', mod: true }],
    run: () => zoomBy('reset'),
  },
  {
    id: 'view.zoomWheel',
    label: 'Zoom con rueda',
    category: 'Vista',
    keys: [],
    chips: (p) => [[MOD[p], 'Rueda']],
  },
  {
    id: 'view.pan',
    label: 'Mover el lienzo',
    category: 'Vista',
    keys: [],
    chips: () => [['Espacio', 'Arrastrar'], ['Rueda']],
  },
  {
    id: 'view.help',
    label: 'Atajos de teclado',
    category: 'Vista',
    keys: [{ key: '?' }],
    run: () => st().showModal({ kind: 'shortcuts' }),
  },
  { id: 'view.cancel', label: 'Cancelar o deseleccionar', category: 'Vista', keys: [{ key: 'escape', display: 'Esc' }] },

  { id: 'file.new', label: 'Nuevo', category: 'Archivo', keys: [], run: newFile },
  {
    id: 'file.open',
    label: 'Abrir',
    category: 'Archivo',
    keys: [{ key: 'o', mod: true, shift: false }],
    run: openFile,
  },
  {
    id: 'file.save',
    label: 'Guardar',
    category: 'Archivo',
    keys: [{ key: 's', mod: true, shift: false, alt: false }],
    run: () => void saveFile(false),
  },
  {
    id: 'file.saveAs',
    label: 'Guardar como',
    category: 'Archivo',
    keys: [{ code: 'KeyS', display: 'S', mod: true, alt: true }],
    run: () => void saveFile(true),
  },
  {
    id: 'file.export',
    label: 'Exportar imagen',
    category: 'Archivo',
    keys: [{ key: 'e', shift: true, mod: false }],
    run: openExportDialog,
  },
]

/** Shortcuts that keep firing while the key is held. */
const REPEATABLE = new Set(['edit.nudge', 'edit.nudgeBig', 'edit.undo', 'edit.redo'])

export const CATEGORIES: Category[] = ['Herramientas', 'Edición', 'Diagramas de flujo', 'Vista', 'Archivo']

export function getShortcut(id: string): Shortcut {
  const s = SHORTCUTS.find((x) => x.id === id)
  if (!s) throw new Error(`Unknown shortcut: ${id}`)
  return s
}

export function getPlatform(): Platform {
  if (typeof navigator === 'undefined') return 'other'
  return /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent) ? 'mac' : 'other'
}

export function formatBinding(b: Binding, platform: Platform = getPlatform()): string {
  const mac = platform === 'mac'
  const parts: string[] = []
  if (b.mod) parts.push(mac ? '⌘' : 'Ctrl')
  if (b.alt) parts.push(mac ? '⌥' : 'Alt')
  if (b.shift) parts.push(mac ? '⇧' : 'Mayús')
  const key = b.display ?? (b.key ?? b.code ?? '').toUpperCase()
  parts.push(key)
  return mac ? parts.join('') : parts.join('+')
}

const KEY_LABELS: Record<string, string> = {
  arrowleft: '←',
  arrowright: '→',
  arrowup: '↑',
  arrowdown: '↓',
  enter: 'Intro',
  delete: 'Supr',
  backspace: 'Retroceso',
  escape: 'Esc',
  tab: 'Tab',
  pageup: 'Re Pág',
  pagedown: 'Av Pág',
  ' ': 'Espacio',
}

/** Chips for one binding, labelled as typed on a Spanish keyboard. */
export function bindingChips(b: Binding, platform: Platform = getPlatform()): string[] {
  const chips: string[] = []
  if (b.mod) chips.push(MOD[platform])
  if (b.alt) chips.push(ALT[platform])
  if (b.shift) chips.push(SHIFT[platform])
  const raw = b.key ?? b.code?.replace(/^Key/, '') ?? ''
  chips.push(KEY_LABELS[raw.toLowerCase()] ?? b.display ?? raw.toUpperCase())
  return chips
}

/** Chip lists, one per alternative binding. Empty when the action has no shortcut. */
export function chipsOf(s: Shortcut, platform: Platform = getPlatform()): string[][] {
  return s.chips ? s.chips(platform) : s.keys.map((b) => bindingChips(b, platform))
}

/** Chips of the primary shortcut, or an empty list. */
export function primaryChips(id: string, platform: Platform = getPlatform()): string[] {
  return chipsOf(getShortcut(id), platform)[0] ?? []
}

/** Display strings for a shortcut, joined like "Ctrl+Z". */
export function describeShortcut(s: Shortcut, platform: Platform = getPlatform()): string[] {
  const mac = platform === 'mac'
  return s.chips
    ? s.chips(platform).map((c) => c.join(mac ? '' : '+'))
    : s.keys.map((b) => formatBinding(b, platform))
}

/** Short hint for a button corner: the first binding's key only. */
export function hintFor(id: string): string {
  const b = getShortcut(id).keys[0]
  return b ? (b.display ?? (b.key ?? '').toUpperCase()) : ''
}

/** Tooltip text such as "Rectángulo (R)". */
export function titleFor(id: string, platform: Platform = getPlatform()): string {
  const s = getShortcut(id)
  const first = s.keys[0]
  return first ? `${s.label} (${formatBinding(first, platform)})` : s.label
}

export function bindingsConflict(a: Binding, b: Binding): boolean {
  const sameKey = a.code || b.code ? a.code === b.code : a.key === b.key
  if (!sameKey) return false
  if (!!a.mod !== !!b.mod || !!a.alt !== !!b.alt) return false
  return a.shift === undefined || b.shift === undefined || a.shift === b.shift
}

export function matchesBinding(b: Binding, e: KeyboardEvent): boolean {
  if (b.code ? e.code !== b.code : e.key.toLowerCase() !== b.key) return false
  if (!!b.mod !== (e.ctrlKey || e.metaKey)) return false
  if (!!b.alt !== e.altKey) return false
  return b.shift === undefined || b.shift === e.shiftKey
}

export function runShortcut(id: string): void {
  getShortcut(id).run?.()
}

/** Handles a keydown through the registry. Returns true when a shortcut consumed it. */
export function dispatchShortcut(e: KeyboardEvent): boolean {
  for (const s of SHORTCUTS) {
    if (!s.run) continue
    if (s.keys.some((b) => matchesBinding(b, e))) {
      if (s.when && !s.when(e)) return false
      e.preventDefault()
      if (e.repeat && !REPEATABLE.has(s.id)) return true
      s.run(e)
      return true
    }
  }
  return false
}
