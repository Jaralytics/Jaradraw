import { nanoid } from 'nanoid'
import { baseDefaults, linearDefaults, textDefaults } from '../element/factory'
import type { SceneElement } from '../element/types'
import { sanitizeRelations } from '../element/relations'
import { lockWholeGroups } from '../element/group'
import { sanitizeFiles } from '../element/image'
import { releaseFrameChildren } from '../element/frame'
import { GRID_SIZE, GRID_STEP } from '../element/snap'

export interface AppStateFile {
  gridSize: number | null
  gridStep?: number
  gridModeEnabled?: boolean
  objectsSnapModeEnabled?: boolean
  viewBackgroundColor: string
  [key: string]: unknown
}

export interface SceneFile {
  type: 'excalidraw'
  version: 2
  source: string
  elements: SceneElement[]
  appState: AppStateFile
  files: Record<string, unknown>
}

export interface SceneData {
  elements: SceneElement[]
  appState: AppStateFile
  files: Record<string, unknown>
}

export const DEFAULT_APP_STATE: AppStateFile = {
  gridSize: GRID_SIZE,
  gridStep: GRID_STEP,
  gridModeEnabled: false,
  objectsSnapModeEnabled: true,
  viewBackgroundColor: '#ffffff',
}

/** Smart guides are on unless the file or autosave explicitly says false. */
export function smartGuidesEnabled(appState: AppStateFile): boolean {
  return appState.objectsSnapModeEnabled !== false
}

export interface GridSettings {
  enabled: boolean
  size: number
  step: number
}

/** Grid settings from the file's appState; older files may carry `gridSize: null`. */
export function gridSettings(appState: AppStateFile): GridSettings {
  const size = typeof appState.gridSize === 'number' && appState.gridSize > 0 ? appState.gridSize : GRID_SIZE
  const step = typeof appState.gridStep === 'number' && appState.gridStep > 0 ? appState.gridStep : GRID_STEP
  return { enabled: appState.gridModeEnabled === true, size, step }
}

export function withGrid(appState: AppStateFile, enabled: boolean): AppStateFile {
  const g = gridSettings(appState)
  return { ...appState, gridSize: g.size, gridStep: g.step, gridModeEnabled: enabled }
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** Validates every known appState field, replacing wrong-typed values with defaults; unknown fields are kept. */
export function coerceAppState(raw: unknown): AppStateFile {
  const out: Record<string, unknown> = { ...(isObject(raw) ? raw : {}) }
  const d = DEFAULT_APP_STATE
  const color = out.viewBackgroundColor
  if (typeof color !== 'string' || color.trim() === '') out.viewBackgroundColor = d.viewBackgroundColor
  const pos = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v > 0
  if (!pos(out.gridSize)) out.gridSize = d.gridSize
  if (!pos(out.gridStep)) out.gridStep = d.gridStep
  if (typeof out.gridModeEnabled !== 'boolean') out.gridModeEnabled = d.gridModeEnabled
  if (typeof out.objectsSnapModeEnabled !== 'boolean') out.objectsSnapModeEnabled = true
  return out as AppStateFile
}

function fillDefaults(raw: Record<string, unknown>, defaults: Record<string, unknown>) {
  const out: Record<string, unknown> = { ...raw }
  for (const key of Object.keys(defaults)) {
    if (out[key] === undefined) out[key] = defaults[key]
  }
  return out
}

const ENUMS: Record<string, readonly string[]> = {
  fillStyle: ['solid', 'hachure', 'cross-hatch', 'zigzag'],
  strokeStyle: ['solid', 'dashed', 'dotted'],
  textAlign: ['left', 'center', 'right'],
  verticalAlign: ['top', 'middle', 'bottom'],
}

/** Replaces known fields whose type is wrong with their defaults; other fields are untouched. */
function coerceKnownFields(out: Record<string, unknown>, defaults: Record<string, unknown>) {
  for (const key of Object.keys(defaults)) {
    const def = defaults[key]
    const v = out[key]
    let ok = true
    if (typeof def === 'number') ok = typeof v === 'number' && Number.isFinite(v)
    else if (typeof def === 'string') ok = typeof v === 'string' && (key !== 'id' || v !== '')
    else if (typeof def === 'boolean') ok = typeof v === 'boolean'
    if (ok && ENUMS[key]) ok = ENUMS[key].includes(v as string)
    if (!ok) out[key] = def
  }
  const rd = out.roundness
  if (rd !== null && !(isObject(rd) && typeof rd.type === 'number' && Number.isFinite(rd.type))) {
    out.roundness = null
  }
  if (typeof out.fontSize === 'number' && out.fontSize <= 0) out.fontSize = defaults.fontSize
  if (typeof out.lineHeight === 'number' && out.lineHeight <= 0) out.lineHeight = defaults.lineHeight
}

const isPoint = (p: unknown): p is [number, number] =>
  Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1])

/** Tolerant element parse: unknown fields are kept, missing known fields get defaults. */
export function parseElement(raw: unknown): SceneElement | null {
  if (!isObject(raw) || typeof raw.type !== 'string') return null
  let defaults: Record<string, unknown> = { ...baseDefaults(), id: nanoid() }
  if (raw.type === 'line' || raw.type === 'arrow') {
    defaults = { ...defaults, ...linearDefaults(raw.type) }
  } else if (raw.type === 'text') {
    defaults = { ...defaults, ...textDefaults() }
  } else if (raw.type === 'freedraw') {
    defaults = { ...defaults, points: [[0, 0]], pressures: [], simulatePressure: true, lastCommittedPoint: null }
  }
  if (raw.type === 'image') {
    defaults = { ...defaults, fileId: null, status: 'saved', scale: [1, 1], crop: null }
  } else if (raw.type === 'frame') {
    defaults = { ...defaults, name: null }
  }
  const out = fillDefaults(raw, defaults)
  coerceKnownFields(out, defaults)
  out.groupIds = Array.isArray(out.groupIds) ? out.groupIds.filter((g) => typeof g === 'string') : []
  if (raw.type === 'line' || raw.type === 'arrow') {
    const valid = Array.isArray(out.points) ? out.points.filter(isPoint) : []
    out.points = valid.length >= 2 ? valid : linearDefaults(raw.type).points
  }
  if (raw.type === 'image') {
    const sc = out.scale
    if (!(Array.isArray(sc) && sc.length === 2 && sc.every((n) => typeof n === 'number' && Number.isFinite(n) && n !== 0))) {
      out.scale = [1, 1]
    }
    if (typeof out.fileId !== 'string') out.fileId = null
  }
  if (raw.type === 'freedraw') {
    const valid = Array.isArray(out.points) ? out.points.filter(isPoint) : []
    out.points = valid.length >= 1 ? valid : [[0, 0]]
    if (!Array.isArray(out.pressures)) out.pressures = []
  }
  return out as unknown as SceneElement
}

export function serializeScene(
  elements: readonly SceneElement[],
  appState: AppStateFile = DEFAULT_APP_STATE,
  files: Record<string, unknown> = {},
): SceneFile {
  return {
    type: 'excalidraw',
    version: 2,
    source: 'jaradraw',
    elements: [...elements],
    appState: { ...appState },
    files: { ...files },
  }
}

export function parseScene(input: unknown): SceneData | null {
  if (!isObject(input) || !Array.isArray(input.elements)) return null
  const elements: SceneElement[] = []
  for (const raw of input.elements) {
    const el = parseElement(raw)
    if (el) elements.push(el)
  }
  const appState = coerceAppState(input.appState)
  const files: Record<string, unknown> = sanitizeFiles(input.files)
  return { elements: lockWholeGroups(releaseFrameChildren(sanitizeRelations(elements)) as SceneElement[]), appState: appState as AppStateFile, files }
}
