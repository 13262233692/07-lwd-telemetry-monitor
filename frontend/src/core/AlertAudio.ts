export class AlertAudio {
  private audioCtx: AudioContext | null = null
  private lastPlayTime = 0
  private minIntervalMs = 2000

  play() {
    const now = Date.now()
    if (now - this.lastPlayTime < this.minIntervalMs) return
    this.lastPlayTime = now

    try {
      if (!this.audioCtx) {
        this.audioCtx = new AudioContext()
      }

      const ctx = this.audioCtx
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()

      osc.connect(gain)
      gain.connect(ctx.destination)

      osc.type = 'square'
      osc.frequency.setValueAtTime(880, ctx.currentTime)
      osc.frequency.setValueAtTime(660, ctx.currentTime + 0.1)
      osc.frequency.setValueAtTime(880, ctx.currentTime + 0.2)

      gain.gain.setValueAtTime(0.3, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.4)

      osc.start(ctx.currentTime)
      osc.stop(ctx.currentTime + 0.4)
    } catch {
      // AudioContext not available
    }
  }

  destroy() {
    if (this.audioCtx) {
      this.audioCtx.close()
      this.audioCtx = null
    }
  }
}
