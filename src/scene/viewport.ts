export interface Viewport {
  scrollX: number
  scrollY: number
  zoom: number
}

export const MIN_ZOOM = 0.1
export const MAX_ZOOM = 30

export const DEFAULT_VIEWPORT: Viewport = { scrollX: 0, scrollY: 0, zoom: 1 }

export const clampZoom = (z: number): number => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z))

export function sceneToScreen(vp: Viewport, x: number, y: number): { x: number; y: number } {
  return { x: (x + vp.scrollX) * vp.zoom, y: (y + vp.scrollY) * vp.zoom }
}

export function screenToScene(vp: Viewport, x: number, y: number): { x: number; y: number } {
  return { x: x / vp.zoom - vp.scrollX, y: y / vp.zoom - vp.scrollY }
}

/** Viewport that centers the given scene bounds on screen, zooming out if they do not fit. */
export function fitViewportToBounds(
  bounds: readonly [number, number, number, number] | null,
  width: number,
  height: number,
  padding = 64,
): Viewport {
  if (!bounds) return DEFAULT_VIEWPORT
  const [x1, y1, x2, y2] = bounds
  const bw = Math.max(x2 - x1, 1)
  const bh = Math.max(y2 - y1, 1)
  const zoom = clampZoom(Math.min(1, (width - padding * 2) / bw, (height - padding * 2) / bh))
  return { zoom, scrollX: width / (2 * zoom) - (x1 + x2) / 2, scrollY: height / (2 * zoom) - (y1 + y2) / 2 }
}

/** Changes zoom keeping the scene point under the given screen point fixed. */
export function zoomViewportAt(vp: Viewport, sx: number, sy: number, zoom: number): Viewport {
  const z = clampZoom(zoom)
  const p = screenToScene(vp, sx, sy)
  return { zoom: z, scrollX: sx / z - p.x, scrollY: sy / z - p.y }
}
