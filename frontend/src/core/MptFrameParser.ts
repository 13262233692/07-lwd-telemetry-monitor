import type { MptFrame } from '../types/MptFrame'
import type { LithologyAlert } from '../types/LithologyAlert'

const MSG_TYPE_FRAME = 0x01
const MSG_TYPE_ALERT = 0x02

const FRAME_SYNC_WORD = 0xABCD1234
const WAVEFORM_CHANNELS = 3
const WAVEFORM_SAMPLES_PER_FRAME = 512

export type ParsedMessage =
  | { type: 'frame'; data: MptFrame }
  | { type: 'alert'; data: LithologyAlert }

export class MptFrameParser {
  static parse(buffer: ArrayBuffer): ParsedMessage | null {
    const view = new DataView(buffer)

    if (buffer.byteLength < 2) return null

    const msgType = view.getUint8(0)

    if (msgType === MSG_TYPE_ALERT) {
      return MptFrameParser.parseAlert(buffer)
    }

    if (msgType === MSG_TYPE_FRAME) {
      return MptFrameParser.parseFrame(buffer, 1)
    }

    return MptFrameParser.parseFrame(buffer, 0)
  }

  private static parseFrame(buffer: ArrayBuffer, baseOffset: number): ParsedMessage | null {
    const view = new DataView(buffer)
    let offset = baseOffset

    if (buffer.byteLength < offset + 20) return null

    const syncWord = view.getUint32(offset, false)
    offset += 4

    if (syncWord !== FRAME_SYNC_WORD) return null

    const frameLength = view.getUint32(offset, true)
    offset += 4

    const frameSequence = view.getUint32(offset, true)
    offset += 4

    const typeStatus = view.getUint16(offset, true)
    offset += 2
    const frameType = (typeStatus >> 8) & 0xFF
    const statusCode = typeStatus & 0xFF

    const bitDepth = view.getFloat32(offset, true)
    offset += 4

    const temperature = view.getFloat32(offset, true)
    offset += 4

    const mudPressure = view.getFloat32(offset, true)
    offset += 4

    const gammaRay = view.getFloat32(offset, true)
    offset += 4

    const maskSample = view.getUint16(offset, true)
    offset += 2
    const channelMask = (maskSample >> 12) & 0x0F
    const sampleCount = maskSample & 0x0FFF

    if (sampleCount <= 0 || sampleCount > WAVEFORM_SAMPLES_PER_FRAME) return null

    const waveformData: Float32Array[] = []
    for (let ch = 0; ch < WAVEFORM_CHANNELS; ch++) {
      const channel = new Float32Array(sampleCount)
      if ((channelMask & (1 << ch)) !== 0) {
        for (let s = 0; s < sampleCount; s++) {
          if (offset + 2 > buffer.byteLength) break
          const raw = view.getInt16(offset, true)
          offset += 2
          channel[s] = raw / 32768.0
        }
      }
      waveformData.push(channel)
    }

    return {
      type: 'frame',
      data: {
        syncWord,
        frameLength,
        frameSequence,
        frameType,
        statusCode,
        bitDepth,
        temperature,
        mudPressure,
        gammaRay,
        channelMask,
        sampleCount,
        waveformData,
      },
    }
  }

  private static parseAlert(buffer: ArrayBuffer): ParsedMessage | null {
    try {
      const bytes = new Uint8Array(buffer, 1)
      const json = new TextDecoder().decode(bytes)
      const alert = JSON.parse(json) as LithologyAlert
      return { type: 'alert', data: alert }
    } catch {
      return null
    }
  }
}
