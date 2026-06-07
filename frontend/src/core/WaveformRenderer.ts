export class WaveformRenderer {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private width = 0
  private height = 0
  private dpr = 1

  private strokeColor = '#00ff88'
  private gridColor = 'rgba(0, 255, 136, 0.15)'
  private bgColor = '#0a0e17'
  private lineWidth = 1.2

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    const ctx = canvas.getContext('2d', { alpha: false })
    if (!ctx) throw new Error('Canvas2D not available')
    this.ctx = ctx
    this.dpr = window.devicePixelRatio || 1
    this.resize()
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect()
    this.width = rect.width * this.dpr
    this.height = rect.height * this.dpr
    this.canvas.width = this.width
    this.canvas.height = this.height
    this.ctx.scale(this.dpr, this.dpr)
  }

  render(samples: Float32Array, label: string) {
    const ctx = this.ctx
    const w = this.width / this.dpr
    const h = this.height / this.dpr

    ctx.fillStyle = this.bgColor
    ctx.fillRect(0, 0, w, h)

    this.drawGrid(w, h)

    if (!samples || samples.length === 0) return

    ctx.beginPath()
    ctx.strokeStyle = this.strokeColor
    ctx.lineWidth = this.lineWidth

    const step = Math.max(1, Math.floor(samples.length / w))
    const midY = h / 2
    const amp = h * 0.4

    for (let x = 0; x < w; x++) {
      const idx = Math.min(Math.floor(x * step), samples.length - 1)
      const y = midY - samples[idx] * amp
      if (x === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()

    ctx.fillStyle = '#00ff88'
    ctx.font = '11px Consolas, Monaco, monospace'
    ctx.fillText(label, 8, 16)

    ctx.fillStyle = 'rgba(0, 255, 136, 0.5)'
    ctx.font = '10px Consolas, Monaco, monospace'
    ctx.fillText(`N=${samples.length}`, 8, 28)
  }

  private drawGrid(w: number, h: number) {
    const ctx = this.ctx
    ctx.strokeStyle = this.gridColor
    ctx.lineWidth = 0.5

    ctx.beginPath()
    ctx.moveTo(0, h / 2)
    ctx.lineTo(w, h / 2)
    ctx.stroke()

    const vLines = 10
    for (let i = 1; i < vLines; i++) {
      const x = (w / vLines) * i
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, h)
      ctx.stroke()
    }
  }

  setStrokeColor(color: string) {
    this.strokeColor = color
  }

  destroy() {
    this.ctx.clearRect(0, 0, this.width, this.height)
  }
}
