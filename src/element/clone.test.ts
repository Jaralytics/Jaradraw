import { describe, expect, it } from 'vitest'
import { createLinear, createShape } from './factory'
import { cloneCentered, cloneElements } from './clone'
import { getCommonBounds } from './geometry'

describe('clone', () => {
  it('creates new ids and seeds with an offset and leaves originals untouched', () => {
    const a = { ...createShape('rectangle', 10, 20), width: 30, height: 40, groupIds: ['g1'] }
    const b = { ...createLinear('arrow', 0, 0), startBinding: { elementId: 'x' } }
    const copies = cloneElements([a, b], 10, 10)
    expect(copies).toHaveLength(2)
    expect(copies[0].id).not.toBe(a.id)
    expect(copies[0].seed).not.toBe(a.seed)
    expect(copies[0]).toMatchObject({ x: 20, y: 30, width: 30, height: 40, version: 1 })
    expect(copies[0].groupIds).not.toEqual(['g1'])
    expect(copies[1]).toMatchObject({ startBinding: null })
    expect(a.x).toBe(10)
    expect(new Set([...copies.map((c) => c.id), a.id, b.id]).size).toBe(4)
  })

  it('shares remapped group ids between copies', () => {
    const a = { ...createShape('rectangle', 0, 0), groupIds: ['g'] }
    const b = { ...createShape('ellipse', 0, 0), groupIds: ['g'] }
    const [ca, cb] = cloneElements([a, b], 0, 0)
    expect(ca.groupIds[0]).toBe(cb.groupIds[0])
  })

  it('centers the copies on a point', () => {
    const a = { ...createShape('rectangle', 0, 0), width: 20, height: 20 }
    const b = { ...createShape('rectangle', 80, 0), width: 20, height: 20 }
    const copies = cloneCentered([a, b], 500, 300)
    const bounds = getCommonBounds(copies)!
    expect((bounds[0] + bounds[2]) / 2).toBeCloseTo(500)
    expect((bounds[1] + bounds[3]) / 2).toBeCloseTo(300)
  })
})
