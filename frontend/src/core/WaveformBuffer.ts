import type { MptFrame } from '../types/MptFrame'

export interface WaveformBufferOptions {
  maxFrames: number
  sampleRate: number
  channels: number
}

export class WaveformBuffer {
  private frameBuffer: MptFrame[] = []
  private maxFrames: number
  private sampleRate: number
  private channels: number

  private latestFrame: MptFrame | null = null

  constructor(options: WaveformBufferOptions) {
    this.maxFrames = options.maxFrames
    this.sampleRate = options.sampleRate
    this.channels = options.channels
  }

  push(frame: MptFrame) {
    this.latestFrame = frame
    this.frameBuffer.push(frame)
    if (this.frameBuffer.length > this.maxFrames) {
      this.frameBuffer.shift()
    }
  }

  getLatestFrame(): MptFrame | null {
    return this.latestFrame
  }

  getChannelData(channelIndex: number): Float32Array {
    if (!this.latestFrame || channelIndex >= this.latestFrame.waveformData.length) {
      return new Float32Array(0)
    }
    return this.latestFrame.waveformData[channelIndex]
  }

  getVDLColumn(channelIndex: number, fromRow: number, toRow: number): Float32Array[] {
    const result: Float32Array[] = []
    const start = Math.max(0, fromRow)
    const end = Math.min(this.frameBuffer.length, toRow)

    for (let i = start; i < end; i++) {
      const frame = this.frameBuffer[i]
      if (channelIndex < frame.waveformData.length) {
        result.push(frame.waveformData[channelIndex])
      }
    }
    return result
  }

  getDepthRange(): { min: number; max: number } {
    if (this.frameBuffer.length === 0) return { min: 0, max: 0 }
    return {
      min: this.frameBuffer[0].bitDepth,
      max: this.frameBuffer[this.frameBuffer.length - 1].bitDepth,
    }
  }

  getFrameCount(): number {
    return this.frameBuffer.length
  }

  getFrame(index: number): MptFrame | null {
    return this.frameBuffer[index] ?? null
  }

  clear() {
    this.frameBuffer = []
    this.latestFrame = null
  }
}
