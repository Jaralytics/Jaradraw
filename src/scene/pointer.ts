import type { Vec } from '../element/geometry'

let lastScene: Vec | null = null

export function setLastPointerScene(p: Vec): void {
  lastScene = p
}

export function getLastPointerScene(): Vec | null {
  return lastScene
}
