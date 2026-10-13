import { describe, expect, it } from 'vitest'
import {
  CATEGORIES,
  SHORTCUTS,
  bindingsConflict,
  describeShortcut,
  formatBinding,
  getShortcut,
  hintFor,
  titleFor,
} from './shortcuts'

describe('shortcut registry', () => {
  it('has unique ids and known categories', () => {
    const ids = SHORTCUTS.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const s of SHORTCUTS) expect(CATEGORIES).toContain(s.category)
  })

  it('has no conflicting key bindings', () => {
    const all = SHORTCUTS.flatMap((s) => s.keys.map((b) => ({ id: s.id, b })))
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        const clash = bindingsConflict(all[i].b, all[j].b)
        expect(clash, `${all[i].id} vs ${all[j].id}`).toBe(false)
      }
    }
  })

  it('detects conflicts', () => {
    expect(bindingsConflict({ key: 'a', mod: true }, { key: 'a', mod: true, shift: true })).toBe(true)
    expect(bindingsConflict({ key: 'z', mod: true, shift: false }, { key: 'z', mod: true, shift: true })).toBe(false)
    expect(bindingsConflict({ key: 'd' }, { key: 'd', mod: true })).toBe(false)
  })

  it('formats per platform and derives hints and titles', () => {
    expect(formatBinding({ key: 'z', mod: true, shift: true }, 'other')).toBe('Ctrl+Mayús+Z')
    expect(formatBinding({ key: 'z', mod: true, shift: true }, 'mac')).toBe('⌘⇧Z')
    expect(hintFor('tool.rectangle')).toBe('R')
    expect(titleFor('tool.rectangle', 'other')).toBe('Rectángulo (R)')
    expect(titleFor('file.save', 'other')).toBe('Guardar (Ctrl+S)')
    expect(describeShortcut(getShortcut('edit.undo'), 'other')).toEqual(['Ctrl+Z'])
  })

  it('every tool and file action is runnable', () => {
    for (const s of SHORTCUTS.filter((x) => x.id.startsWith('tool.') || x.id.startsWith('file.'))) {
      expect(s.run).toBeTypeOf('function')
    }
  })
})
