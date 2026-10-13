import { describe, expect, it } from 'vitest'
import { bindingTarget, getBoundRefs } from '../element/relations'
import { containerIdOf, isLinear } from '../element/types'
import { parseScene, serializeScene } from './serialize'
import { TEMPLATES } from './templates'
import { templatePreview } from '../ui/templatePreview'

describe('templates', () => {
  it('have unique ids and names', () => {
    expect(new Set(TEMPLATES.map((t) => t.id)).size).toBe(TEMPLATES.length)
    for (const t of TEMPLATES) {
      expect(t.name.trim()).not.toBe('')
      expect(t.description.trim()).not.toBe('')
    }
  })

  for (const t of TEMPLATES) {
    describe(t.id, () => {
      it('builds elements with unique ids that differ between builds', () => {
        const a = t.build()
        const b = t.build()
        expect(a.length).toBeGreaterThan(0)
        expect(new Set(a.map((e) => e.id)).size).toBe(a.length)
        const idsA = new Set(a.map((e) => e.id))
        expect(b.some((e) => idsA.has(e.id))).toBe(false)
      })

      it('only references elements of the same build', () => {
        const els = t.build()
        const ids = new Set(els.map((e) => e.id))
        for (const e of els) {
          const container = containerIdOf(e)
          if (container) expect(ids.has(container)).toBe(true)
          for (const r of getBoundRefs(e)) expect(ids.has(r.id)).toBe(true)
          if (isLinear(e)) {
            for (const b of [e.startBinding, e.endBinding]) {
              const target = bindingTarget(b)
              if (target) {
                expect(ids.has(target)).toBe(true)
                const shape = els.find((x) => x.id === target)!
                expect(getBoundRefs(shape).some((r) => r.id === e.id)).toBe(true)
              }
            }
          }
        }
      })

      it('survives a serialize and parse round trip', () => {
        const els = t.build()
        const parsed = parseScene(JSON.parse(JSON.stringify(serializeScene(els))))
        expect(parsed).not.toBeNull()
        expect(parsed!.elements).toHaveLength(els.length)
      })
    })
  }
})

describe('template previews', () => {
  it('render a cached SVG data URL per theme', () => {
    for (const t of TEMPLATES) {
      const light = templatePreview(t.id, false)
      expect(light).toMatch(/^data:image\/svg\+xml/)
      expect(templatePreview(t.id, false)).toBe(light)
      expect(templatePreview(t.id, true)).not.toBe(light)
      expect(decodeURIComponent(light!.split(',')[1])).toContain('width="100%"')
    }
  })
})
