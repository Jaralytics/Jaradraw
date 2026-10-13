import type { Point } from './types'

/** Stored waypoints are relative to the arrow's x/y, like `points`. */
type Carrier = { readonly customData?: Record<string, unknown> }

const KEY = 'waypoints'

const isPoint = (p: unknown): p is Point =>
  Array.isArray(p) && p.length >= 2 && typeof p[0] === 'number' && typeof p[1] === 'number' && Number.isFinite(p[0]) && Number.isFinite(p[1])

/** Valid waypoints of an element; missing or malformed data reads as none. */
export function readWaypoints(el: Carrier): Point[] {
  const w = el.customData?.[KEY]
  return Array.isArray(w) && w.every(isPoint) ? w.map((p) => [p[0], p[1]] as Point) : []
}

/** `customData` with the waypoints replaced (null or empty removes them); other keys are kept. undefined when nothing is left. */
export function customDataWith(el: Carrier, waypoints: readonly Point[] | null): Record<string, unknown> | undefined {
  const { [KEY]: _drop, ...rest } = el.customData ?? {}
  const next = waypoints && waypoints.length > 0 ? { ...rest, [KEY]: waypoints.map((p) => [p[0], p[1]]) } : rest
  return Object.keys(next).length > 0 ? next : undefined
}
