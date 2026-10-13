import { describe, expect, it } from 'vitest'
import {
  canRedo,
  canUndo,
  createHistory,
  currentEntry,
  pushHistory,
  redoHistory,
  replaceCurrent,
  undoHistory,
} from './history'

describe('history', () => {
  it('pushes entries and undoes/redoes', () => {
    let h = createHistory('a')
    expect(canUndo(h)).toBe(false)
    h = pushHistory(h, 'b')
    h = pushHistory(h, 'c')
    expect(currentEntry(h)).toBe('c')
    h = undoHistory(h)
    expect(currentEntry(h)).toBe('b')
    expect(canRedo(h)).toBe(true)
    h = redoHistory(h)
    expect(currentEntry(h)).toBe('c')
    expect(canRedo(h)).toBe(false)
  })

  it('clears redo when a new action is pushed', () => {
    let h = pushHistory(pushHistory(createHistory('a'), 'b'), 'c')
    h = undoHistory(undoHistory(h))
    h = pushHistory(h, 'x')
    expect(h.stack).toEqual(['a', 'x'])
    expect(canRedo(h)).toBe(false)
  })

  it('caps the stack by dropping the oldest entries', () => {
    let h = createHistory(0)
    for (let i = 1; i <= 10; i++) h = pushHistory(h, i, 5)
    expect(h.stack).toEqual([6, 7, 8, 9, 10])
    expect(h.index).toBe(4)
  })

  it('undo/redo at the ends are no-ops and replaceCurrent keeps the index', () => {
    const h = createHistory('a')
    expect(undoHistory(h)).toBe(h)
    expect(redoHistory(h)).toBe(h)
    const p = replaceCurrent(pushHistory(h, 'b'), 'B')
    expect(p.stack).toEqual(['a', 'B'])
  })
})
