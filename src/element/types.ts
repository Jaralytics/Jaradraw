export type Point = readonly [number, number]

export type FillStyle = 'solid' | 'hachure' | 'cross-hatch' | 'zigzag'
export type StrokeStyle = 'solid' | 'dashed' | 'dotted'
export type Roundness = { readonly type: number; readonly value?: number } | null

export interface ElementBase {
  readonly id: string
  readonly type: string
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly angle: number
  readonly strokeColor: string
  readonly backgroundColor: string
  readonly fillStyle: FillStyle
  readonly strokeWidth: number
  readonly strokeStyle: StrokeStyle
  readonly roughness: number
  readonly opacity: number
  readonly groupIds: readonly string[]
  readonly frameId: string | null
  readonly roundness: Roundness
  readonly seed: number
  readonly version: number
  readonly versionNonce: number
  readonly isDeleted: boolean
  readonly boundElements: readonly unknown[] | null
  readonly updated: number
  readonly link: string | null
  readonly locked: boolean
  readonly index: string | null
  /** Free-form data preserved across save and load; elbow arrows keep their waypoints here. */
  readonly customData?: Record<string, unknown>
}

export interface ShapeElement extends ElementBase {
  readonly type: 'rectangle' | 'ellipse' | 'diamond'
}

/** Shape of an arrow binding when read; extra fields written by other tools are kept untouched. */
export interface Binding {
  readonly elementId: string
  readonly focus?: number
  readonly gap?: number
  readonly fixedPoint?: readonly [number, number] | null
  readonly [key: string]: unknown
}

export interface LinearElement extends ElementBase {
  readonly type: 'line' | 'arrow'
  readonly points: readonly Point[]
  readonly lastCommittedPoint: Point | null
  readonly startBinding: unknown
  readonly endBinding: unknown
  readonly startArrowhead: string | null
  readonly endArrowhead: string | null
  readonly elbowed?: boolean
  readonly fixedSegments?: unknown
  readonly startIsSpecial?: boolean | null
  readonly endIsSpecial?: boolean | null
}

export interface TextElement extends ElementBase {
  readonly type: 'text'
  readonly text: string
  readonly originalText: string
  readonly fontSize: number
  readonly fontFamily: number
  readonly textAlign: 'left' | 'center' | 'right'
  readonly verticalAlign: 'top' | 'middle' | 'bottom'
  readonly containerId: string | null
  readonly autoResize: boolean
  readonly lineHeight: number
}

export interface FreedrawElement extends ElementBase {
  readonly type: 'freedraw'
  readonly points: readonly Point[]
  readonly pressures: readonly number[]
  readonly simulatePressure: boolean
  readonly lastCommittedPoint: Point | null
}

export interface ImageCrop {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly naturalWidth: number
  readonly naturalHeight: number
}

export interface ImageElement extends ElementBase {
  readonly type: 'image'
  readonly fileId: string | null
  readonly status: string
  /** A negative component means the image is flipped on that axis. */
  readonly scale: readonly [number, number]
  /** Visible region in pixels of the stored binary; null or absent means the whole image. */
  readonly crop: ImageCrop | null
}

export interface FrameElement extends ElementBase {
  readonly type: 'frame'
  readonly name: string | null
}

/** Any element type that is preserved but not rendered (embeddable...). */
export interface OtherElement extends ElementBase {
  readonly type: string
}

export type SceneElement = ShapeElement | LinearElement | TextElement | FreedrawElement | OtherElement

export interface Box {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export function isShape(el: SceneElement): el is ShapeElement {
  return el.type === 'rectangle' || el.type === 'ellipse' || el.type === 'diamond'
}
export function isLinear(el: SceneElement): el is LinearElement {
  return el.type === 'line' || el.type === 'arrow'
}
export function isText(el: SceneElement): el is TextElement {
  return el.type === 'text'
}
export function isFreedraw(el: SceneElement): el is FreedrawElement {
  return el.type === 'freedraw'
}
export function isRenderable(el: SceneElement): boolean {
  return isShape(el) || isLinear(el) || isText(el) || isFreedraw(el) || isImage(el) || isFrame(el)
}
export function isImage(el: SceneElement): el is ImageElement {
  return el.type === 'image'
}
export function isFrame(el: SceneElement): el is FrameElement {
  return el.type === 'frame'
}

/** A text element attached to a shape or arrow (its label). */
export function isBoundText(el: SceneElement): boolean {
  return el.type === 'text' && (el as TextElement).containerId != null
}
/** Elements that can carry a label. */
export function isLabelable(el: SceneElement): boolean {
  return isShape(el) || el.type === 'arrow'
}

export function containerIdOf(el: SceneElement): string | null {
  return (el as { containerId?: string | null }).containerId ?? null
}
