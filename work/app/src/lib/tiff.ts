import * as UTIF from 'utif'
import type { DecodedGrayImage } from '../types'

export async function decodeTiff(file: File): Promise<DecodedGrayImage> {
  const buffer = await file.arrayBuffer()
  const ifds = UTIF.decode(buffer)
  if (!ifds.length) {
    throw new Error(`TIFF file contains no image frames: ${file.name}`)
  }

  UTIF.decodeImage(buffer, ifds[0])
  const first = ifds[0]
  const width = first.width as number
  const height = first.height as number
  const bitsPerSample = normalizeBitDepth(first.t258)

  if (bitsPerSample === 16 && first.data instanceof Uint16Array) {
    return {
      width,
      height,
      bitDepth: 16,
      pixels: first.data,
    }
  }

  const rgba = UTIF.toRGBA8(first)
  const gray = new Uint8Array(width * height)
  for (let index = 0; index < gray.length; index += 1) {
    const rgbaIndex = index * 4
    gray[index] = Math.round(
      rgba[rgbaIndex] * 0.299 + rgba[rgbaIndex + 1] * 0.587 + rgba[rgbaIndex + 2] * 0.114,
    )
  }

  return {
    width,
    height,
    bitDepth: 8,
    pixels: gray,
  }
}

function normalizeBitDepth(raw: unknown): 8 | 16 {
  if (Array.isArray(raw) && raw[0] === 16) {
    return 16
  }
  if (raw === 16) {
    return 16
  }
  return 8
}
