import { createLinear, createShape, createText } from '../element/factory'
import type { StyleProps } from '../element/factory'
import { connectNodes } from '../element/flowchart'
import { withAbsolutePoints } from '../element/geometry'
import { createLabel } from '../element/label'
import { attachLabel } from '../element/relations'
import { DEFAULT_STYLE_DEFAULTS } from '../element/style'
import { measureText } from '../element/text'
import type { Roundness, SceneElement, ShapeElement } from '../element/types'

export interface Template {
  id: string
  name: string
  description: string
  /** Creates a fresh set of elements (new ids and seeds) on every call. */
  build(): SceneElement[]
}

type Style = Partial<StyleProps> & { roundness?: Roundness }

// Colors come from the style panel palette.
const INK = '#1e1e1e'
const RED = '#e03131'
const GREEN = '#2f9e44'
const BLUE = '#1971c2'
const ORANGE = '#f08c00'
const VIOLET = '#6741d9'
const PINK_BG = '#ffc9c9'
const GREEN_BG = '#b2f2bb'
const BLUE_BG = '#a5d8ff'
const YELLOW_BG = '#ffec99'
const VIOLET_BG = '#d0bfff'

const ROUND: Roundness = { type: 3 }

/** Collects elements for one template; positions are centers so layouts read as grids. */
class Sketch {
  els: SceneElement[] = []

  /** Shape centered at (cx, cy) with an optional bound, centered label. */
  box(type: ShapeElement['type'], cx: number, cy: number, w: number, h: number, label = '', style: Style = {}, fontSize = 20): string {
    const base = createShape(type, cx - w / 2, cy - h / 2, { roundness: type === 'rectangle' ? ROUND : null, ...style })
    const shape: ShapeElement = { ...base, width: w, height: h }
    if (!label) {
      this.els.push(shape)
      return shape.id
    }
    const { container, label: text } = createLabel(shape, label, { fontSize })
    this.els = [...attachLabel([...this.els, container], container, text)]
    return container.id
  }

  /** Free text whose top edge is at `y`, horizontally centered on `cx` (or starting at `cx` when left-aligned). */
  text(cx: number, y: number, value: string, opts: { size?: number; color?: string; align?: 'left' | 'center' } = {}): string {
    const fontSize = opts.size ?? 20
    const align = opts.align ?? 'center'
    const size = measureText(value, fontSize, 2, 1.25)
    const x = align === 'center' ? cx - size.width / 2 : cx
    const el = createText(x, y, value, size, { fontSize, strokeColor: opts.color ?? INK, textAlign: align })
    this.els.push(el)
    return el.id
  }

  line(x1: number, y1: number, x2: number, y2: number, style: Style = {}, kind: 'line' | 'arrow' = 'line'): string {
    const base = createLinear(kind, x1, y1, { roundness: null, ...style })
    const el = {
      ...withAbsolutePoints(base, [
        [x1, y1],
        [x2, y2],
      ]),
      ...(kind === 'arrow' ? { endArrowhead: 'arrow' } : {}),
    }
    this.els.push(el)
    return el.id
  }

  /** Arrow bound at both ends to the shapes `a` and `b`, with an optional label. */
  link(a: string, b: string, label = ''): void {
    const made = connectNodes(this.els, a, b, DEFAULT_STYLE_DEFAULTS)
    if (!made) throw new Error('template: shapes overlap or are not nodes')
    this.els = [...made.elements]
    if (!label) return
    const arrow = this.els.find((e) => e.id === made.arrowId) as SceneElement
    const { container, label: text } = createLabel(arrow, label, { fontSize: 16 })
    this.els = [...attachLabel(this.els, container, text)]
  }
}

function make(fn: (s: Sketch) => void): SceneElement[] {
  const s = new Sketch()
  fn(s)
  return s.els
}

function flowchart(): SceneElement[] {
  return make((s) => {
    const start = s.box('ellipse', 0, 0, 180, 70, 'Inicio', { backgroundColor: GREEN_BG, strokeColor: GREEN })
    const step = s.box('rectangle', 0, 140, 220, 80, 'Proceso', { backgroundColor: BLUE_BG, strokeColor: BLUE })
    const check = s.box('diamond', 0, 310, 240, 140, 'Decisión', { backgroundColor: YELLOW_BG, strokeColor: ORANGE })
    const fix = s.box('rectangle', 340, 310, 220, 80, 'Revisar', { backgroundColor: PINK_BG, strokeColor: RED })
    const end = s.box('ellipse', 0, 500, 180, 70, 'Fin', { backgroundColor: GREEN_BG, strokeColor: GREEN })
    s.link(start, step)
    s.link(step, check)
    s.link(check, end, 'Sí')
    s.link(check, fix, 'No')
    s.link(fix, step)
  })
}

function mindmap(): SceneElement[] {
  return make((s) => {
    const root = s.box('ellipse', 0, 0, 240, 110, 'Idea central', { backgroundColor: YELLOW_BG, strokeColor: ORANGE }, 24)
    const branches: { x: number; y: number; label: string; bg: string; stroke: string }[] = [
      { x: 360, y: -150, label: 'Tema 1', bg: BLUE_BG, stroke: BLUE },
      { x: 360, y: 150, label: 'Tema 2', bg: GREEN_BG, stroke: GREEN },
      { x: -360, y: -150, label: 'Tema 3', bg: PINK_BG, stroke: RED },
      { x: -360, y: 150, label: 'Tema 4', bg: VIOLET_BG, stroke: VIOLET },
    ]
    const ids = branches.map((b) => s.box('rectangle', b.x, b.y, 180, 64, b.label, { backgroundColor: b.bg, strokeColor: b.stroke }))
    ids.forEach((id) => s.link(root, id))
    const sub = (from: string, x: number, y: number, label: string, stroke: string) =>
      s.link(from, s.box('rectangle', x, y, 150, 50, label, { strokeColor: stroke }, 16))
    sub(ids[0], 660, -210, 'Detalle 1.1', BLUE)
    sub(ids[0], 660, -90, 'Detalle 1.2', BLUE)
    sub(ids[3], -660, 90, 'Detalle 4.1', VIOLET)
    sub(ids[3], -660, 210, 'Detalle 4.2', VIOLET)
  })
}

function orgChart(): SceneElement[] {
  return make((s) => {
    const root = s.box('rectangle', 0, 0, 240, 80, 'Dirección general', { backgroundColor: VIOLET_BG, strokeColor: VIOLET })
    const mid = [-360, 0, 360].map((x, i) =>
      s.box('rectangle', x, 170, 200, 70, ['Operaciones', 'Finanzas', 'Tecnología'][i], { backgroundColor: BLUE_BG, strokeColor: BLUE }),
    )
    mid.forEach((id) => s.link(root, id))
    const leaves: [number, number, string][] = [
      [-460, 0, 'Logística'],
      [-260, 0, 'Calidad'],
      [0, 1, 'Contabilidad'],
      [260, 2, 'Desarrollo'],
      [460, 2, 'Soporte'],
    ]
    for (const [x, parent, label] of leaves) {
      s.link(mid[parent], s.box('rectangle', x, 340, 170, 60, label, { backgroundColor: GREEN_BG, strokeColor: GREEN }, 18))
    }
  })
}

function kanban(): SceneElement[] {
  return make((s) => {
    const cols: { title: string; color: string; bg: string; cards: string[] }[] = [
      { title: 'Por hacer', color: RED, bg: PINK_BG, cards: ['Definir alcance', 'Diseñar pantallas', 'Preparar datos'] },
      { title: 'En curso', color: ORANGE, bg: YELLOW_BG, cards: ['Desarrollar módulo', 'Revisar propuesta'] },
      { title: 'Hecho', color: GREEN, bg: GREEN_BG, cards: ['Reunión de inicio', 'Plan de trabajo'] },
    ]
    cols.forEach((col, i) => {
      const cx = i * 320
      s.box('rectangle', cx, 260, 290, 560, '', { strokeColor: col.color })
      s.text(cx, 10, col.title, { size: 24, color: col.color })
      col.cards.forEach((card, j) => {
        s.box('rectangle', cx, 120 + j * 100, 250, 72, card, { backgroundColor: col.bg, strokeColor: col.color }, 18)
      })
    })
  })
}

function swot(): SceneElement[] {
  return make((s) => {
    s.text(330, -70, 'Matriz DAFO', { size: 32 })
    const quads: { x: number; y: number; title: string; color: string; bg: string }[] = [
      { x: 0, y: 0, title: 'Fortalezas', color: GREEN, bg: GREEN_BG },
      { x: 1, y: 0, title: 'Debilidades', color: RED, bg: PINK_BG },
      { x: 0, y: 1, title: 'Oportunidades', color: BLUE, bg: BLUE_BG },
      { x: 1, y: 1, title: 'Amenazas', color: ORANGE, bg: YELLOW_BG },
    ]
    for (const q of quads) {
      const left = q.x * 340
      const top = q.y * 260
      s.box('rectangle', left + 160, top + 120, 320, 240, '', { backgroundColor: q.bg, strokeColor: q.color })
      s.text(left + 20, top + 20, q.title, { size: 24, color: q.color, align: 'left' })
      s.text(left + 20, top + 70, '- Punto 1\n- Punto 2\n- Punto 3', { size: 18, align: 'left' })
    }
  })
}

function timeline(): SceneElement[] {
  return make((s) => {
    s.line(-60, 0, 1160, 0, { strokeWidth: 3 }, 'arrow')
    const colors = [BLUE, GREEN, ORANGE, RED, VIOLET]
    const fills = [BLUE_BG, GREEN_BG, YELLOW_BG, PINK_BG, VIOLET_BG]
    colors.forEach((color, i) => {
      const x = 80 + i * 240
      const up = i % 2 === 0
      s.box('ellipse', x, 0, 24, 24, '', { backgroundColor: color, strokeColor: color })
      s.line(x, up ? -12 : 12, x, up ? -90 : 90, { strokeColor: color })
      s.box('rectangle', x, up ? -140 : 140, 190, 100, `Fase ${i + 1}\nDescripción breve`, { backgroundColor: fills[i], strokeColor: color }, 18)
    })
  })
}

function wireframe(): SceneElement[] {
  return make((s) => {
    const flat = { roughness: 0 }
    s.box('rectangle', 400, 35, 800, 70, '', flat)
    s.text(30, 20, 'Logo', { size: 24, align: 'left' })
    s.text(500, 25, 'Inicio      Servicios      Contacto', { size: 18, align: 'left' })
    s.box('rectangle', 400, 230, 800, 260, '', { ...flat, backgroundColor: BLUE_BG, strokeColor: BLUE })
    s.text(400, 150, 'Título principal', { size: 36 })
    s.text(400, 210, 'Una frase breve que explica la propuesta de valor', { size: 18 })
    s.box('rectangle', 400, 310, 220, 56, 'Llamada a la acción', { ...flat, backgroundColor: YELLOW_BG, strokeColor: INK, roundness: ROUND }, 18)
    ;[0, 1, 2].forEach((i) => {
      const cx = 125 + i * 275
      s.box('rectangle', cx, 490, 250, 220, '', flat)
      s.box('rectangle', cx, 450, 220, 100, 'Imagen', { ...flat, strokeStyle: 'dashed', strokeColor: INK }, 18)
      s.text(cx, 520, `Tarjeta ${i + 1}`, { size: 20 })
      s.text(cx, 556, 'Texto descriptivo breve', { size: 16 })
    })
    s.box('rectangle', 400, 660, 800, 60, 'Pie de página', { ...flat, backgroundColor: PINK_BG, strokeColor: INK }, 18)
  })
}

function brainstorm(): SceneElement[] {
  return make((s) => {
    s.text(430, -70, 'Lluvia de ideas', { size: 32 })
    const fills = [YELLOW_BG, PINK_BG, GREEN_BG, BLUE_BG, VIOLET_BG]
    const strokes = [ORANGE, RED, GREEN, BLUE, VIOLET]
    for (let i = 0; i < 12; i++) {
      const c = i % 4
      const r = Math.floor(i / 4)
      const k = (c + r * 2) % fills.length
      s.box('rectangle', c * 220 + 100, r * 180 + 80, 190, 150, `Idea ${i + 1}`, { backgroundColor: fills[k], strokeColor: strokes[k], roundness: null }, 22)
    }
  })
}

function venn(): SceneElement[] {
  return make((s) => {
    const sets = [
      { x: 0, y: 0, bg: PINK_BG, stroke: RED },
      { x: 180, y: 0, bg: BLUE_BG, stroke: BLUE },
      { x: 90, y: 156, bg: GREEN_BG, stroke: GREEN },
    ]
    for (const c of sets) s.box('ellipse', c.x, c.y, 300, 300, '', { backgroundColor: c.bg, strokeColor: c.stroke, opacity: 60 })
    s.text(-40, -90, 'Conjunto A', { size: 20 })
    s.text(220, -90, 'Conjunto B', { size: 20 })
    s.text(90, 230, 'Conjunto C', { size: 20 })
    s.text(90, 40, 'Común', { size: 18 })
  })
}

function eisenhower(): SceneElement[] {
  return make((s) => {
    const cols = ['Urgente', 'No urgente']
    const rows = ['Importante', 'No importante']
    cols.forEach((c, i) => s.text(i * 340 + 160, -44, c, { size: 22 }))
    rows.forEach((r, j) => s.text(-90, j * 240 + 100, r, { size: 22 }))
    const quads = [
      { x: 0, y: 0, title: 'Hacer', hint: 'Hazlo ahora', color: RED, bg: PINK_BG },
      { x: 1, y: 0, title: 'Planificar', hint: 'Agenda una fecha', color: GREEN, bg: GREEN_BG },
      { x: 0, y: 1, title: 'Delegar', hint: 'Asígnalo a otra persona', color: ORANGE, bg: YELLOW_BG },
      { x: 1, y: 1, title: 'Eliminar', hint: 'Descártalo', color: VIOLET, bg: VIOLET_BG },
    ]
    for (const q of quads) {
      const left = q.x * 340
      const top = q.y * 240
      s.box('rectangle', left + 160, top + 110, 320, 220, '', { backgroundColor: q.bg, strokeColor: q.color })
      s.text(left + 20, top + 20, q.title, { size: 26, color: q.color, align: 'left' })
      s.text(left + 20, top + 62, q.hint, { size: 16, align: 'left' })
      s.text(left + 20, top + 100, '- Tarea 1\n- Tarea 2\n- Tarea 3', { size: 18, align: 'left' })
    }
  })
}

function businessCanvas(): SceneElement[] {
  return make((s) => {
    const block = (col: number, row: number, w: number, h: number, title: string, bg: string, stroke: string) => {
      const left = col * 250
      const top = row * 210
      s.box('rectangle', left + w / 2, top + h / 2, w, h, '', { backgroundColor: bg, strokeColor: stroke, roundness: null })
      s.text(left + 14, top + 12, title, { size: 18, align: 'left' })
      s.text(left + 14, top + 48, '- Nota', { size: 16, align: 'left' })
    }
    block(0, 0, 240, 410, 'Socios clave', 'transparent', INK)
    block(1, 0, 240, 200, 'Actividades clave', 'transparent', INK)
    block(1, 1, 240, 200, 'Recursos clave', 'transparent', INK)
    block(2, 0, 240, 410, 'Propuesta de valor', YELLOW_BG, ORANGE)
    block(3, 0, 240, 200, 'Relación con clientes', 'transparent', INK)
    block(3, 1, 240, 200, 'Canales', 'transparent', INK)
    block(4, 0, 240, 410, 'Segmentos de clientes', BLUE_BG, BLUE)
    block(0, 2, 740, 180, 'Estructura de costes', PINK_BG, RED)
    block(3, 2, 490, 180, 'Fuentes de ingresos', GREEN_BG, GREEN)
  })
}

function funnel(): SceneElement[] {
  return make((s) => {
    const stages = [
      { label: 'Visitantes\n10.000', w: 700, bg: BLUE_BG, stroke: BLUE },
      { label: 'Interesados\n2.500', w: 560, bg: VIOLET_BG, stroke: VIOLET },
      { label: 'Oportunidades\n600', w: 420, bg: YELLOW_BG, stroke: ORANGE },
      { label: 'Clientes\n150', w: 280, bg: GREEN_BG, stroke: GREEN },
    ]
    stages.forEach((st, i) => s.box('rectangle', 0, i * 110, st.w, 96, st.label, { backgroundColor: st.bg, strokeColor: st.stroke }))
  })
}

function ishikawa(): SceneElement[] {
  return make((s) => {
    s.line(-40, 0, 800, 0, { strokeWidth: 3 }, 'arrow')
    s.box('rectangle', 930, 0, 260, 110, 'Problema', { backgroundColor: PINK_BG, strokeColor: RED }, 24)
    const cats = ['Personas', 'Métodos', 'Máquinas', 'Materiales', 'Medición', 'Entorno']
    cats.forEach((cat, i) => {
      const up = i < 3
      const sx = 240 + (i % 3) * 230
      const bx = sx - 130
      const by = up ? -260 : 260
      const color = [BLUE, GREEN, ORANGE][i % 3]
      s.box('rectangle', bx, by, 170, 50, cat, { backgroundColor: [BLUE_BG, GREEN_BG, YELLOW_BG][i % 3], strokeColor: color }, 18)
      const y0 = up ? by + 25 : by - 25
      s.line(bx, y0, sx, 0, { strokeColor: color })
      for (const t of [0.35, 0.7]) {
        const px = bx + (sx - bx) * t
        const py = y0 - y0 * t
        s.line(px - 80, py, px, py, { strokeColor: color, strokeWidth: 1 })
        s.text(px - 42, py - 24, 'Causa', { size: 16 })
      }
    })
  })
}

function entityRelation(): SceneElement[] {
  return make((s) => {
    const entity = (x: number, y: number, name: string, attrs: string[], bg: string, stroke: string) =>
      s.box('rectangle', x, y, 240, 150, `${name}\n${attrs.map((a) => `- ${a}`).join('\n')}`, { backgroundColor: bg, strokeColor: stroke, roundness: null }, 18)
    const customer = entity(0, 0, 'Cliente', ['id', 'nombre', 'correo'], BLUE_BG, BLUE)
    const order = entity(440, 0, 'Pedido', ['id', 'fecha', 'total'], YELLOW_BG, ORANGE)
    const product = entity(880, 0, 'Producto', ['id', 'nombre', 'precio'], GREEN_BG, GREEN)
    const category = entity(880, 280, 'Categoría', ['id', 'nombre'], VIOLET_BG, VIOLET)
    s.link(customer, order, 'realiza (1:N)')
    s.link(order, product, 'contiene (N:M)')
    s.link(product, category, 'pertenece a (N:1)')
  })
}

function architecture(): SceneElement[] {
  return make((s) => {
    const layers = [
      { x: 0, label: 'Cliente\nNavegador o app', bg: BLUE_BG, stroke: BLUE },
      { x: 340, label: 'API\nREST / GraphQL', bg: VIOLET_BG, stroke: VIOLET },
      { x: 680, label: 'Servicios\nLógica de negocio', bg: YELLOW_BG, stroke: ORANGE },
      { x: 1020, label: 'Base de datos\nPersistencia', bg: GREEN_BG, stroke: GREEN },
    ]
    const ids = layers.map((l) => s.box('rectangle', l.x, 0, 220, 100, l.label, { backgroundColor: l.bg, strokeColor: l.stroke }, 18))
    ids.slice(1).forEach((id, i) => s.link(ids[i], id))
    const external = s.box('rectangle', 680, 220, 220, 90, 'Servicio externo\nPagos, correo', { backgroundColor: PINK_BG, strokeColor: RED, strokeStyle: 'dashed' }, 18)
    s.link(ids[2], external, 'HTTPS')
  })
}

function retrospective(): SceneElement[] {
  return make((s) => {
    const cols = [
      { title: 'Qué salió bien', color: GREEN, bg: GREEN_BG },
      { title: 'Qué mejorar', color: RED, bg: PINK_BG },
      { title: 'Acciones', color: BLUE, bg: BLUE_BG },
    ]
    cols.forEach((col, i) => {
      const cx = i * 340
      s.box('rectangle', cx, 270, 310, 560, '', { strokeColor: col.color })
      s.text(cx, 10, col.title, { size: 24, color: col.color })
      for (let j = 0; j < 4; j++) {
        s.box('rectangle', cx, 130 + j * 120, 260, 96, 'Comentario', { backgroundColor: col.bg, strokeColor: col.color, roundness: null }, 18)
      }
    })
  })
}

function gantt(): SceneElement[] {
  return make((s) => {
    const X0 = 240
    const COL = 90
    const ROW = 50
    const weeks = 8
    const tasks: [string, number, number, string][] = [
      ['Planificación', 0, 2, BLUE],
      ['Diseño', 1, 3, VIOLET],
      ['Desarrollo', 3, 4, GREEN],
      ['Pruebas', 5, 2, ORANGE],
      ['Despliegue', 6, 1, RED],
      ['Cierre', 7, 1, INK],
    ]
    const bottom = 60 + tasks.length * ROW
    const faint = { opacity: 30, strokeWidth: 1 }
    for (let k = 0; k <= weeks; k++) s.line(X0 + k * COL, 0, X0 + k * COL, bottom, faint)
    for (let r = 0; r <= tasks.length; r++) s.line(0, 60 + r * ROW, X0 + weeks * COL, 60 + r * ROW, faint)
    s.line(0, 0, X0 + weeks * COL, 0, faint)
    s.line(0, 0, 0, bottom, faint)
    s.text(16, 16, 'Tarea', { size: 20, align: 'left' })
    for (let k = 0; k < weeks; k++) s.text(X0 + k * COL + COL / 2, 18, `Sem ${k + 1}`, { size: 16 })
    tasks.forEach(([name, start, len, color], i) => {
      const cy = 60 + i * ROW + ROW / 2
      s.text(16, cy - 11, name, { size: 18, align: 'left' })
      const w = len * COL - 12
      s.box('rectangle', X0 + start * COL + 6 + w / 2, cy, w, 26, '', { backgroundColor: color, strokeColor: color })
    })
  })
}

function mobileWireframe(): SceneElement[] {
  return make((s) => {
    const flat = { roughness: 0 }
    s.box('rectangle', 0, 0, 360, 720, '', { ...flat, strokeWidth: 3, roundness: { type: 3, value: 32 } })
    s.text(-150, -344, '9:41', { size: 14, align: 'left' })
    s.text(105, -344, '100%', { size: 14, align: 'left' })
    s.box('rectangle', 0, -290, 330, 56, 'Título', { ...flat, backgroundColor: BLUE_BG, strokeColor: INK })
    for (let i = 0; i < 5; i++) {
      const cy = -190 + i * 100
      s.box('rectangle', 0, cy, 330, 84, '', flat)
      s.box('ellipse', -120, cy, 48, 48, '', { ...flat, backgroundColor: VIOLET_BG, strokeColor: VIOLET })
      s.text(-80, cy - 26, `Elemento ${i + 1}`, { size: 18, align: 'left' })
      s.text(-80, cy + 4, 'Descripción breve', { size: 14, align: 'left' })
    }
    s.box('rectangle', 0, 320, 340, 70, '', { ...flat, backgroundColor: YELLOW_BG, strokeColor: INK, roundness: null })
    ;['Inicio', 'Buscar', 'Avisos', 'Perfil'].forEach((tab, i) => s.text(-127 + i * 85, 308, tab, { size: 16 }))
  })
}

export const TEMPLATES: Template[] = [
  { id: 'flowchart', name: 'Diagrama de flujo', description: 'Inicio, proceso, decisión y fin', build: flowchart },
  { id: 'mindmap', name: 'Mapa mental', description: 'Idea central con ramas y subramas', build: mindmap },
  { id: 'orgchart', name: 'Organigrama', description: 'Estructura jerárquica de tres niveles', build: orgChart },
  { id: 'kanban', name: 'Tablero Kanban', description: 'Por hacer, en curso y hecho', build: kanban },
  { id: 'swot', name: 'Matriz DAFO', description: 'Fortalezas, debilidades, oportunidades y amenazas', build: swot },
  { id: 'timeline', name: 'Línea de tiempo', description: 'Eje horizontal con cinco hitos', build: timeline },
  { id: 'wireframe', name: 'Wireframe web', description: 'Encabezado, portada, tarjetas y pie', build: wireframe },
  { id: 'brainstorm', name: 'Lluvia de ideas', description: 'Notas de colores bajo un título', build: brainstorm },
  { id: 'venn', name: 'Diagrama de Venn', description: 'Tres conjuntos que se solapan con una zona común', build: venn },
  { id: 'eisenhower', name: 'Matriz de Eisenhower', description: 'Prioriza tareas por urgencia e importancia', build: eisenhower },
  { id: 'bmc', name: 'Lienzo de modelo de negocio', description: 'Los nueve bloques del Business Model Canvas', build: businessCanvas },
  { id: 'funnel', name: 'Embudo de ventas', description: 'Cuatro etapas desde visitantes hasta clientes', build: funnel },
  { id: 'ishikawa', name: 'Diagrama de Ishikawa', description: 'Espina de pescado con seis categorías de causas', build: ishikawa },
  { id: 'er', name: 'Diagrama entidad-relación', description: 'Entidades con atributos y relaciones', build: entityRelation },
  { id: 'architecture', name: 'Arquitectura de sistema', description: 'Cliente, API, servicios, base de datos y un servicio externo', build: architecture },
  { id: 'retro', name: 'Retrospectiva', description: 'Qué salió bien, qué mejorar y acciones', build: retrospective },
  { id: 'gantt', name: 'Diagrama de Gantt', description: 'Tareas y barras de tiempo a lo largo de ocho semanas', build: gantt },
  { id: 'mobile', name: 'Wireframe móvil', description: 'Pantalla de teléfono con cabecera, lista y barra de pestañas', build: mobileWireframe },
]
