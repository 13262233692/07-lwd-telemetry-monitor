import type { MptFrame } from '../types/MptFrame'
import { MptFrameParser } from './MptFrameParser'

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

export interface TelemetryClientOptions {
  url: string
  onFrame: (frame: MptFrame) => void
  onStatusChange: (status: ConnectionStatus) => void
  reconnectInterval?: number
}

export class TelemetryClient {
  private ws: WebSocket | null = null
  private url: string
  private onFrame: (frame: MptFrame) => void
  private onStatusChange: (status: ConnectionStatus) => void
  private reconnectInterval: number
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private intentionallyClosed = false
  private status: ConnectionStatus = 'disconnected'

  constructor(options: TelemetryClientOptions) {
    this.url = options.url
    this.onFrame = options.onFrame
    this.onStatusChange = options.onStatusChange
    this.reconnectInterval = options.reconnectInterval ?? 3000
  }

  connect() {
    this.intentionallyClosed = false
    this.setStatus('connecting')

    try {
      this.ws = new WebSocket(this.url)
      this.ws.binaryType = 'arraybuffer'

      this.ws.onopen = () => {
        this.setStatus('connected')
      }

      this.ws.onmessage = (event) => {
        if (event.data instanceof ArrayBuffer) {
          const frame = MptFrameParser.parse(event.data)
          if (frame) {
            this.onFrame(frame)
          }
        }
      }

      this.ws.onclose = () => {
        this.setStatus('disconnected')
        if (!this.intentionallyClosed) {
          this.scheduleReconnect()
        }
      }

      this.ws.onerror = () => {
        this.setStatus('error')
      }
    } catch (e) {
      this.setStatus('error')
      this.scheduleReconnect()
    }
  }

  disconnect() {
    this.intentionallyClosed = true
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
    this.setStatus('disconnected')
  }

  getStatus(): ConnectionStatus {
    return this.status
  }

  private setStatus(status: ConnectionStatus) {
    if (this.status !== status) {
      this.status = status
      this.onStatusChange(status)
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, this.reconnectInterval)
  }
}
