import type { LinearElement, SceneElement } from '../element/types'
import { containerIdOf, isFreedraw, isImage, isLinear, isShape, isText } from '../element/types'
import { flattenElementPath } from '../element/path'
import type { Vec2 } from '../element/path'

/** One loop of every animation; shared so an exported GIF loops seamlessly. */
export const ANIMATION_PERIOD_MS = 2000
/** Largest scale reached by a pulse (halfway through the period). */
export const PULSE_MAX_SCALE = 1.06

export type AnimationKind = 'flow' | 'pulse'

const KEY = 'animation'

/** Whether the element can carry the given animation. Bound labels follow their container instead. */
export function canAnimate(el: SceneElement, kind: AnimationKind): boolean {
  if (kind === 'flow') return isLinear(el)
  return (isShape(el) || isImage(el) || isFreedraw(el) || (isText(el) && containerIdOf(el) == null))
}

/** The stored animation, ignoring unknown values and kinds the element cannot use. */
export function animationOf(el: SceneElement): AnimationKind | null {
  const v = el.customData?.[KEY]
  return (v === 'flow' || v === 'pulse') && canAnimate(el, v) ? v : null
}

/** `customData` with the animation set or cleared; other keys are kept. undefined when nothing is left. */
export function customDataWithAnimation(el: SceneElement, kind: AnimationKind | null): Record<string, unknown> | undefined {
  const { [KEY]: _drop, ...rest } = el.customData ?? {}
  const next = kind ? { ...rest, [KEY]: kind } : rest
  return Object.keys(next).length > 0 ? next : undefined
}

export function hasAnimations(elements: readonly SceneElement[]): boolean {
  return elements.some((e) => !e.isDeleted && animationOf(e) !== null)
}

/** Position within the loop, 0 (inclusive) to 1 (exclusive), for any time including negatives. */
export function loopPhase(t: number): number {
  const p = (((t % ANIMATION_PERIOD_MS) + ANIMATION_PERIOD_MS) % ANIMATION_PERIOD_MS) / ANIMATION_PERIOD_MS
  return p
}

/** Pulse scale: 1 at the start of the loop, PULSE_MAX_SCALE halfway, back to 1 (smooth sine). */
export function pulseScale(t: number): number {
  return 1 + (PULSE_MAX_SCALE - 1) * ((1 - Math.cos(2 * Math.PI * loopPhase(t))) / 2)
}

/** Fraction (0 to 1) of the path the flow dot has covered; one trip per loop. */
export function flowProgress(t: number): number {
  return loopPhase(t)
}

export function pathLength(path: readonly Vec2[]): number {
  let len = 0
  for (let i = 1; i < path.length; i++) len += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y)
  return len
}

/** Point at a fraction of the path's arc length. */
export function pointAlong(path: readonly Vec2[], fraction: number): Vec2 {
  if (path.length === 0) return { x: 0, y: 0 }
  const f = Math.max(0, Math.min(1, fraction))
  const target = pathLength(path) * f
  let walked = 0
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]
    const b = path[i]
    const seg = Math.hypot(b.x - a.x, b.y - a.y)
    if (walked + seg >= target && seg > 0) {
      const k = (target - walked) / seg
      return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k }
    }
    walked += seg
  }
  return path[path.length - 1]
}

/** Dot position at time `t`, relative to the element origin (the same space as its points). */
export function flowDotPosition(el: LinearElement, t: number): Vec2 {
  return pointAlong(flattenElementPath(el), flowProgress(t))
}

export function flowDotRadius(el: SceneElement): number {
  return Math.max(3, el.strokeWidth * 1.6)
}
