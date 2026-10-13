import { describe, expect, it } from 'vitest'
import { createShape } from './factory'
import { reorderElements } from './zorder'

const make = (n: number) => Array.from({ length: n }, () => createShape('rectangle', 0, 0))
const ids = (els: readonly { id: string }[]) => els.map((e) => e.id)

describe('z-order', () => {
  it('brings to front and sends to back keeping relative order', () => {
    const [a, b, c, d] = make(4)
    expect(ids(reorderElements([a, b, c, d], [a.id, c.id], 'front'))).toEqual(ids([b, d, a, c]))
    expect(ids(reorderElements([a, b, c, d], [b.id, d.id], 'back'))).toEqual(ids([b, d, a, c]))
  })

  it('moves a multi-selection one step forward and backward', () => {
    const [a, b, c, d] = make(4)
    expect(ids(reorderElements([a, b, c, d], [a.id, b.id], 'forward'))).toEqual(ids([c, a, b, d]))
    expect(ids(reorderElements([a, b, c, d], [c.id, d.id], 'backward'))).toEqual(ids([a, c, d, b]))
    expect(ids(reorderElements([a, b, c, d], [a.id, c.id], 'forward'))).toEqual(ids([b, a, d, c]))
  })

  it('returns the same array when nothing changes', () => {
    const els = make(3)
    expect(reorderElements(els, [els[2].id], 'front')).toBe(els)
    expect(reorderElements(els, [els[0].id], 'back')).toBe(els)
    expect(reorderElements(els, [els[2].id], 'forward')).toBe(els)
  })

  it('skips deleted elements and leaves them in place', () => {
    const [a, b, c] = make(3)
    const del = { ...b, isDeleted: true }
    const out = reorderElements([a, del, c], [a.id], 'forward')
    expect(ids(out)).toEqual(ids([c, del, a]))
  })
})

describe('z-order with non-rendered elements', () => {
  it('steps over elements that are not drawn', () => {
    const [a, c] = make(2)
    const hidden = { ...createShape('rectangle', 0, 0), type: 'embeddable' }
    const out = reorderElements([a, hidden, c], [a.id], 'forward')
    expect(ids(out)).toEqual(ids([c, hidden, a]))
  })
})
