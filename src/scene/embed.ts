// Embedded scenes in PNG (tEXt chunk) and SVG (metadata comment payload), Excalidraw scheme.

export const EXCALIDRAW_KEYWORD = 'application/vnd.excalidraw+json'
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10]

let crcTable: Uint32Array | null = null

export function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      crcTable[n] = c >>> 0
    }
  }
  let crc = 0xffffffff
  for (let i = 0; i < bytes.length; i++) crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

export interface PngChunk {
  type: string
  data: Uint8Array
}

export function isPng(bytes: Uint8Array): boolean {
  return PNG_SIGNATURE.every((b, i) => bytes[i] === b)
}

export function readPngChunks(bytes: Uint8Array): PngChunk[] {
  if (!isPng(bytes)) throw new Error('No es un PNG')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const chunks: PngChunk[] = []
  let pos = 8
  while (pos + 12 <= bytes.length) {
    const length = view.getUint32(pos)
    const type = String.fromCharCode(...bytes.subarray(pos + 4, pos + 8))
    if (pos + 12 + length > bytes.length) throw new Error('PNG truncado')
    chunks.push({ type, data: bytes.slice(pos + 8, pos + 8 + length) })
    pos += 12 + length
    if (type === 'IEND') break
  }
  return chunks
}

export function writePngChunks(chunks: readonly PngChunk[]): Uint8Array {
  const size = 8 + chunks.reduce((n, c) => n + 12 + c.data.length, 0)
  const out = new Uint8Array(size)
  const view = new DataView(out.buffer)
  out.set(PNG_SIGNATURE, 0)
  let pos = 8
  for (const c of chunks) {
    view.setUint32(pos, c.data.length)
    for (let i = 0; i < 4; i++) out[pos + 4 + i] = c.type.charCodeAt(i)
    out.set(c.data, pos + 8)
    view.setUint32(pos + 8 + c.data.length, crc32(out.subarray(pos + 4, pos + 8 + c.data.length)))
    pos += 12 + c.data.length
  }
  return out
}

const latin1 = (s: string) => Uint8Array.from(s, (ch) => ch.charCodeAt(0) & 0xff)
const fromLatin1 = (b: Uint8Array) => {
  let s = ''
  for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode(...b.subarray(i, i + 8192))
  return s
}

function textChunk(keyword: string, text: string): PngChunk {
  const k = latin1(keyword)
  const t = latin1(text)
  const data = new Uint8Array(k.length + 1 + t.length)
  data.set(k, 0)
  data.set(t, k.length + 1)
  return { type: 'tEXt', data }
}

function parseTextChunk(chunk: PngChunk): { keyword: string; text: string } | null {
  const i = chunk.data.indexOf(0)
  if (i < 0) return null
  return { keyword: fromLatin1(chunk.data.subarray(0, i)), text: fromLatin1(chunk.data.subarray(i + 1)) }
}

/** Inserts (or replaces) a tEXt chunk right before IEND. */
export function insertTextChunk(png: Uint8Array, keyword: string, text: string): Uint8Array {
  const chunks = readPngChunks(png).filter((c) => !(c.type === 'tEXt' && parseTextChunk(c)?.keyword === keyword))
  const iend = chunks.findIndex((c) => c.type === 'IEND')
  chunks.splice(iend < 0 ? chunks.length : iend, 0, textChunk(keyword, text))
  return writePngChunks(chunks)
}

export function readTextChunk(png: Uint8Array, keyword: string): string | null {
  for (const c of readPngChunks(png)) {
    if (c.type !== 'tEXt') continue
    const t = parseTextChunk(c)
    if (t && t.keyword === keyword) return t.text
  }
  return null
}

const MAX_INFLATED = 200 * 1024 * 1024

async function pipe(
  bytes: Uint8Array,
  stream: { writable: WritableStream; readable: ReadableStream },
  maxBytes = Infinity,
): Promise<Uint8Array> {
  const writer = stream.writable.getWriter()
  void writer.write(bytes as BufferSource).then(() => writer.close()).catch(() => {})
  const reader = stream.readable.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += (value as Uint8Array).length
    if (total > maxBytes) {
      await reader.cancel().catch(() => {})
      throw new Error('Carga útil demasiado grande')
    }
    chunks.push(value as Uint8Array)
  }
  const out = new Uint8Array(total)
  let pos = 0
  for (const c of chunks) {
    out.set(c, pos)
    pos += c.length
  }
  return out
}

/** zlib-wrapped deflate (what Excalidraw's pako.deflate produces). */
export const deflate = (bytes: Uint8Array) => pipe(bytes, new CompressionStream('deflate'))
export const inflate = (bytes: Uint8Array) => pipe(bytes, new DecompressionStream('deflate'), MAX_INFLATED)

function bytesToByteString(bytes: Uint8Array): string {
  return fromLatin1(bytes)
}
function byteStringToBytes(s: string): Uint8Array {
  return Uint8Array.from(s, (ch) => ch.charCodeAt(0) & 0xff)
}

/** JSON envelope with the zlib-deflated scene JSON written as a byte string. */
export async function encodeSceneEnvelope(sceneJson: string): Promise<string> {
  const deflated = await deflate(new TextEncoder().encode(sceneJson))
  return JSON.stringify({ version: '1', encoding: 'bstring', compressed: true, encoded: bytesToByteString(deflated) })
}

export async function decodeSceneEnvelope(envelope: string): Promise<string> {
  const data = JSON.parse(envelope) as { encoding?: unknown; compressed?: unknown; encoded?: unknown }
  if (data.encoding !== 'bstring' || typeof data.encoded !== 'string') throw new Error('Formato incrustado no reconocido')
  let bytes = byteStringToBytes(data.encoded)
  if (data.compressed) bytes = await inflate(bytes)
  return new TextDecoder().decode(bytes)
}

export async function embedSceneInPng(png: Uint8Array, sceneJson: string): Promise<Uint8Array> {
  return insertTextChunk(png, EXCALIDRAW_KEYWORD, await encodeSceneEnvelope(sceneJson))
}

/** Scene JSON embedded in a PNG, or null when there is none. */
export async function extractSceneFromPng(png: Uint8Array): Promise<string | null> {
  if (!isPng(png)) return null
  const envelope = readTextChunk(png, EXCALIDRAW_KEYWORD)
  return envelope === null ? null : decodeSceneEnvelope(envelope)
}

const SVG_PAYLOAD = /<!-- payload-start -->([\s\S]*?)<!-- payload-end -->/

export async function embedSceneInSvg(svg: string, sceneJson: string): Promise<string> {
  const envelope = await encodeSceneEnvelope(sceneJson)
  const meta =
    '<!-- svg-source:excalidraw --><metadata><!-- payload-type:application/vnd.excalidraw+json -->' +
    `<!-- payload-version:2 --><!-- payload-start -->${btoa(envelope)}<!-- payload-end --></metadata>`
  const open = svg.indexOf('>', svg.indexOf('<svg'))
  return open < 0 ? svg : svg.slice(0, open + 1) + meta + svg.slice(open + 1)
}

export async function extractSceneFromSvg(svg: string): Promise<string | null> {
  const m = SVG_PAYLOAD.exec(svg)
  if (!m) return null
  return decodeSceneEnvelope(atob(m[1].trim()))
}
