declare module 'utif' {
  export interface TiffIfd {
    width?: number
    height?: number
    data?: Uint8Array | Uint16Array
    t258?: unknown
    [key: string]: unknown
  }

  export function decode(buffer: ArrayBuffer): TiffIfd[]
  export function decodeImage(buffer: ArrayBuffer, ifd: TiffIfd): void
  export function toRGBA8(ifd: TiffIfd): Uint8Array
}
