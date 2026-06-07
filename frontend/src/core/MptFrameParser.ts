export class MptFrameParser {
  private static readonly FRAME_SYNC_WORD = 0xABCD1234
  private static readonly WAVEFORM_CHANNELS = 3
  private static readonly WAVEFORM_SAMPLES_PER_FRAME = 512
  private static readonly HEADER_SIZE = 16

  static parse(buffer: ArrayBuffer): import('../types/MptFrame').MptFrame | null {
    const view = new DataView(buffer)

    if (buffer.byteLength < this.HEADER_SIZE + 4) {
      return null
    }

    let offset = 0

    const syncWord = view.getUint32(offset, false)
    offset += 4

    if (syncWord !== this.FRAME_SYNC_WORD) {
      return null
    }

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

    const maskSample = view.getUint16(offset, true)
    offset += 2
    const channelMask = (maskSample >> 12) & 0x0F
    const sampleCount = maskSample & 0x0FFF

    if (sampleCount <= 0 || sampleCount > this.WAVEFORM_SAMPLES_PER_FRAME) {
      return null
    }

    const waveformData: Float32Array[] = []
    for (let ch = 0; ch < this.WAVEFORM_CHANNELS; ch++) {
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
      syncWord,
      frameLength,
      frameSequence,
      frameType,
      statusCode,
      bitDepth,
      temperature,
      mudPressure,
      channelMask,
      sampleCount,
      waveformData,
    }
  }
}
