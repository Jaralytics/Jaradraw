import { nanoid } from 'nanoid'
import type {
  ElementBase,
  FillStyle,
  LinearElement,
  Point,
  Roundness,
  SceneElement,
  ShapeElement,
  StrokeStyle,
  TextElement,
} from './types'

export interface StyleProps {
  strokeColor: string
  backgroundColor: string
  fillStyle: FillStyle
  strokeWidth: number
  strokeStyle: StrokeStyle
  roughness: number
  opacity: number
}

export const DEFAULT_STYLE: StyleProps = {
  strokeColor: '#1e1e1e',
  backgroundColor: 'transparent',
  fillStyle: 'solid',
  strokeWidth: 2,
  strokeStyle: 'solid',
  roughness: 1,
  opacity: 100,
}

export const randomInt = (): number => Math.floor(Math.random() * 2 ** 31)

/** Defaults for the fields every element has (excluding id and type). */
export function baseDefaults(): Omit<ElementBase, 'id' | 'type'> {
  return {
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    angle: 0,
    ...DEFAULT_STYLE,
    groupIds: [],
    frameId: null,
    roundness: null,
    seed: randomInt(),
    version: 1,
    versionNonce: randomInt(),
    isDeleted: false,
    boundElements: null,
    updated: Date.now(),
    link: null,
    locked: false,
    index: null,
  }
}

export function linearDefaults(type: 'line' | 'arrow') {
  return {
    points: [
      [0, 0],
      [0, 0],
    ] as Point[],
    lastCommittedPoint: null,
    startBinding: null,
    endBinding: null,
    startArrowhead: null,
    endArrowhead: type === 'arrow' ? 'arrow' : null,
    ...(type === 'arrow' ? { elbowed: false } : {}),
  }
}

export function textDefaults() {
  return {
    text: '',
    originalText: '',
    fontSize: 20,
    fontFamily: 2,
    textAlign: 'left' as const,
    verticalAlign: 'top' as const,
    containerId: null,
    autoResize: true,
    lineHeight: 1.25,
  }
}

export function createShape(
  type: ShapeElement['type'],
  x: number,
  y: number,
  style: Partial<StyleProps> & { roundness?: Roundness } = {},
): ShapeElement {
  return { ...baseDefaults(), ...style, id: nanoid(), type, x, y }
}

export function createLinear(
  type: LinearElement['type'],
  x: number,
  y: number,
  style: Partial<StyleProps> & { roundness?: Roundness } = {},
): LinearElement {
  return { ...baseDefaults(), ...linearDefaults(type), ...style, id: nanoid(), type, x, y }
}

export function createText(
  x: number,
  y: number,
  text: string,
  size: { width: number; height: number },
  style: Partial<StyleProps> & { fontSize?: number; fontFamily?: number; textAlign?: 'left' | 'center' | 'right' } = {},
  id: string = nanoid(),
): TextElement {
  return {
    ...baseDefaults(),
    ...textDefaults(),
    ...style,
    id,
    type: 'text',
    x,
    y,
    text,
    originalText: text,
    width: size.width,
    height: size.height,
  }
}

/** Immutable update: returns a new object and bumps version bookkeeping. */
export function updateElement<T extends SceneElement>(el: T, patch: Partial<T>): T {
  return {
    ...el,
    ...patch,
    version: el.version + 1,
    versionNonce: randomInt(),
    updated: Date.now(),
  }
}
