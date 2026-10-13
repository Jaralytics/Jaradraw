import type { LinearElement, Point, SceneElement } from './types'
import { updateElement } from './factory'
import { bakeAngle, getAbsolutePoints, withAbsolutePoints } from './geometry'
import type { Vec } from './geometry'
import { customDataWith, readWaypoints } from './waypoints'
import { closestOnPolyline, editPolyline, elbowNodes, foldsAt } from './elbowEdit'
import { rerouteElbowArrow } from './relations'

type Lookup = (id: string) => SceneElement | undefined

/** Waypoints of an elbow arrow in scene coordinates. */
export function waypointsAbs(el: LinearElement): Vec[] {
  const base = bakeAngle(el)
  return readWaypoints(base).map(([wx, wy]) => ({ x: base.x + wx, y: base.y + wy }))
}

/** The arrow with these scene positions stored as its waypoints (none removes them); the route is not touched. */
function withNodes(el: LinearElement, nodes: readonly Vec[]): LinearElement {
  const base = bakeAngle(el)
  return updateElement(base, { customData: customDataWith(base, nodes.map((w) => [w.x - base.x, w.y - base.y] as Point)) })
}

/**
 * Pins the route to an edited polyline: its points become `poly`, every interior vertex becomes a
 * waypoint, and the arrow is re-routed through them (the ends on shapes are re-anchored).
 */
export function pinElbow(el: LinearElement, poly: readonly Vec[], lookup: Lookup): LinearElement {
  const base = bakeAngle(el)
  const moved = withAbsolutePoints(base, poly.map((v) => [v.x, v.y] as Point))
  return rerouteElbowArrow(withNodes(moved, poly.slice(1, -1)), lookup)
}

/**
 * Adds a node at the closest position of the route to (x, y) and pins the route. The points are
 * not touched, so the visible route does not change. `index` is the node's position in the node list.
 */
export function insertElbowNode(el: LinearElement, x: number, y: number): { element: LinearElement; index: number } | null {
  const poly = editPolyline(el)
  if (poly.length < 2) return null
  const hit = closestOnPolyline(poly, { x, y })
  const next = [...poly.slice(0, hit.segment + 1), hit.point, ...poly.slice(hit.segment + 1)]
  return { element: withNodes(el, next.slice(1, -1)), index: hit.segment }
}

function routeLength(el: LinearElement): number {
  const pts = getAbsolutePoints(el)
  let sum = 0
  for (let i = 1; i < pts.length; i++) sum += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])
  return sum
}

/**
 * Removes the detour around node `index` of the node list: the node and its immediate neighbours are
 * unpinned (automatic corners are pinned first) and the router joins what is left. A remaining node next
 * to the gap that only makes the route longer goes too. With no pinned node left the arrow is automatic again.
 */
export function deleteElbowNode(el: LinearElement, index: number, lookup: Lookup): LinearElement | null {
  const nodes = elbowNodes(el)
  if (!nodes[index]) return null
  const start = Math.max(0, index - 1)
  let kept = nodes.filter((_, i) => i < index - 1 || i > index + 1)
  let out = rerouteElbowArrow(withNodes(el, kept), lookup)
  let len = routeLength(out)
  // `gap` is where the removed nodes were: kept[gap - 1] and kept[gap] are the nodes beside it
  let gap = start
  for (let side = 0; side < 2; ) {
    const at = side === 0 ? gap - 1 : gap
    if (at < 0 || at >= kept.length) {
      side++
      continue
    }
    const rest = kept.filter((_, i) => i !== at)
    const trial = rerouteElbowArrow(withNodes(el, rest), lookup)
    const l = routeLength(trial)
    if (l < len - 1e-6) {
      kept = rest
      out = trial
      len = l
      if (side === 0) gap--
      continue
    }
    side++
  }
  // a pinned node left as a dead end (the route doubles back at it) goes too, until none is left
  for (let guard = kept.length; guard > 0; guard--) {
    const poly = getAbsolutePoints(out).map(([x, y]) => ({ x, y }))
    const left = waypointsAbs(out)
    const bad = left.findIndex((w) => foldsAt(poly, w))
    if (bad < 0) break
    out = rerouteElbowArrow(withNodes(out, left.filter((_, i) => i !== bad)), lookup)
  }
  // an automatic arrow whose route did not change stays fully automatic: no pins are written
  const same = JSON.stringify([out.points, out.x, out.y]) === JSON.stringify([el.points, el.x, el.y])
  if (same && readWaypoints(el).length === 0) return el
  return out
}

/** `to` (a transformed copy of `from`, which has angle 0) with the waypoints of `from` mapped through `fn` in scene space. */
export function carryWaypoints(from: LinearElement, to: LinearElement, fn: (p: Vec) => Vec): LinearElement {
  const wps = readWaypoints(from)
  if (wps.length === 0) return to
  const mapped = wps.map(([wx, wy]) => {
    const m = fn({ x: from.x + wx, y: from.y + wy })
    return [m.x - to.x, m.y - to.y] as Point
  })
  return updateElement(to, { customData: customDataWith(to, mapped) })
}
