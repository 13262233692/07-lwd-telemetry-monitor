import type { MptFrame } from '../types/MptFrame'
import type { LithologyAlert } from '../types/LithologyAlert'
import { MptFrameParser } from './MptFrameParser'

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

export interface TelemetryClientOptions {
  url: string
  onFrame: (frame: MptFrame) => void
  onAlert: (alert: LithologyAlert) => void
  onStatusChange: (status: ConnectionStatus) => void
  baseInterval?: number
  maxInterval?: number
  maxRetries?: number
  jitterFactor?: number
}

export class TelemetryClient {
  private ws: WebSocket | null = null
  private url: string
  private onFrame: (frame: MptFrame) => void
  private onAlert: (alert: LithologyAlert) => void
  private onStatusChange: (status: ConnectionStatus) => void

  private baseInterval: number
  private maxInterval: number
  private maxRetries: number
  private jitterFactor: number

  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private intentionallyClosed = false
  private status: ConnectionStatus = 'disconnected'

  private retryCount = 0
  private currentBackoff = 0

  constructor(options: TelemetryClientOptions) {
    this.url = options.url
    this.onFrame = options.onFrame
    this.onAlert = options.onAlert
    this.onStatusChange = options.onStatusChange
    this.baseInterval = options.baseInterval ?? 1000
    this.maxInterval = options.maxInterval ?? 30000
    this.maxRetries = options.maxRetries ?? Infinity
    this.jitterFactor = options.jitterFactor ?? 0.3
  }

  connect() {
    this.intentionallyClosed = false
    this.setStatus('connecting')

    try {
      this.ws = new WebSocket(this.url)
      this.ws.binaryType = 'arraybuffer'

      this.ws.onopen = () => {
        this.retryCount = 0
        this.currentBackoff = 0
        this.setStatus('connected')
      }

      this.ws.onmessage = (event) => {
        if (event.data instanceof ArrayBuffer) {
          const parsed = MptFrameParser.parse(event.data)
          if (parsed) {
            if (parsed.type === 'frame') {
              this.onFrame(parsed.data)
            } else if (parsed.type === 'alert') {
              this.onAlert(parsed.data)
            }
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
    this.clearReconnectTimer()
    if (this.ws) {
      this.ws.onclose = null
      this.ws.onerror = null
      this.ws.onopen = null
      this.ws.onmessage = null
      this.ws.close()
      this.ws = null
    }
    this.retryCount = 0
    this.currentBackoff = 0
    this.setStatus('disconnected')
  }

  getStatus(): ConnectionStatus {
    return this.status
  }

  getRetryCount(): number {
    return this.retryCount
  }

  private setStatus(status: ConnectionStatus) {
    if (this.status !== status) {
      this.status = status
      this.onStatusChange(status)
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return

    if (this.retryCount >= this.maxRetries) {
      return
    }

    const backoff = this.calculateBackoff()
    this.currentBackoff = backoff

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.retryCount++
      this.connect()
    }, backoff)
  }

  private calculateBackoff(): number {
    const exponentialDelay = this.baseInterval * Math.pow(2, this.retryCount)
    const clampedDelay = Math.min(exponentialDelay, this.maxInterval)
    const jitter = clampedDelay * this.jitterFactor * Math.random()
    const delay = clampedDelay + jitter - (clampedDelay * this.jitterFactor / 2)
    return Math.max(this.baseInterval, Math.round(delay))
  }

  private clearReconnectTimer() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }
}
