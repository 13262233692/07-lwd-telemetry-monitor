export interface MptFrame {
  syncWord: number
  frameLength: number
  frameSequence: number
  frameType: number
  statusCode: number
  bitDepth: number
  temperature: number
  mudPressure: number
  channelMask: number
  sampleCount: number
  waveformData: Float32Array[]
}
