import { describe, expect, it } from 'vitest'
import { FileError, parseSceneFile } from './files'
import { serializeScene } from './serialize'
import { createShape } from '../element/factory'

describe('parseSceneFile', () => {
  it('reads a valid excalidraw file', () => {
    const els = [createShape('rectangle', 1, 2)]
    const data = parseSceneFile(JSON.stringify(serializeScene(els)))
    expect(data.elements).toEqual(els)
  })

  it('throws FileError for invalid or foreign files', () => {
    expect(() => parseSceneFile('not json')).toThrow(FileError)
    expect(() => parseSceneFile('{"type":"other","elements":[]}')).toThrow(FileError)
    expect(() => parseSceneFile('[]')).toThrow(FileError)
    expect(() => parseSceneFile('{"type":"excalidraw"}')).toThrow(FileError)
  })
})
