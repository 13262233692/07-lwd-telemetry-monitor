const VERT_SRC = `
attribute vec2 a_position;
varying vec2 v_texCoord;
void main() {
    v_texCoord = a_position * 0.5 + 0.5;
    gl_Position = vec4(a_position, 0.0, 1.0);
}
`

const FRAG_SRC = `
precision mediump float;
varying vec2 v_texCoord;
uniform sampler2D u_vdlTexture;
uniform sampler2D u_colormap;
uniform float u_opacity;
void main() {
    float intensity = texture2D(u_vdlTexture, v_texCoord).r;
    vec4 color = texture2D(u_colormap, vec2(intensity, 0.5));
    color.a *= u_opacity;
    gl_FragColor = color;
}
`

const COLORMAP_FRAG = `
precision mediump float;
varying vec2 v_texCoord;
uniform sampler2D u_vdlTexture;
uniform vec2 u_viewOffset;
uniform vec2 u_viewScale;
uniform float u_gain;
uniform float u_rangeMin;
uniform float u_rangeMax;
void main() {
    vec2 sampleCoord = v_texCoord * u_viewScale + u_viewOffset;
    float intensity = texture2D(u_vdlTexture, sampleCoord).r;
    intensity = clamp((intensity - u_rangeMin) / (u_rangeMax - u_rangeMin + 0.0001), 0.0, 1.0);
    intensity = pow(intensity, 1.0 / (u_gain + 0.01));
    gl_FragColor = vec4(intensity, intensity, intensity, 1.0);
}
`

export interface VDLRenderConfig {
  width: number
  height: number
  depthRange: number
  sampleRate: number
  channelIndex: number
  gain: number
  rangeMin: number
  rangeMax: number
  colormapName: string
}

export class VDLRenderer {
  private gl: WebGLRenderingContext
  private program: WebGLProgram | null = null
  private colormapProgram: WebGLProgram | null = null
  private vdlTexture: WebGLTexture | null = null
  private colormapTexture: WebGLTexture | null = null
  private quadBuffer: WebGLBuffer | null = null
  private framebuffer: WebGLFramebuffer | null = null

  private frontTexture: WebGLTexture | null = null
  private backTexture: WebGLTexture | null = null

  private textureWidth = 0
  private textureHeight = 0
  private currentRow = 0
  private totalRows = 0

  private config: VDLRenderConfig

  private viewOffsetX = 0
  private viewOffsetY = 0
  private viewScaleX = 1.0
  private viewScaleY = 1.0

  private animFrameId = 0
  private rendering = false

  constructor(canvas: HTMLCanvasElement, config: VDLRenderConfig) {
    const gl = canvas.getContext('webgl', {
      alpha: false,
      antialias: false,
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance',
    })
    if (!gl) throw new Error('WebGL not available')
    this.gl = gl
    this.config = config
    this.initGL()
  }

  private initGL() {
    const gl = this.gl
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)

    this.program = this.createProgram(VERT_SRC, FRAG_SRC)
    this.colormapProgram = this.createProgram(VERT_SRC, COLORMAP_FRAG)

    this.quadBuffer = gl.createBuffer()!
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1, -1, 1, -1, -1, 1,
      -1, 1, 1, -1, 1, 1,
    ]), gl.STATIC_DRAW)

    this.createColormapTexture()
    this.resizeTextures(this.config.width, this.config.height)
  }

  private createProgram(vertSrc: string, fragSrc: string): WebGLProgram {
    const gl = this.gl
    const vs = this.compileShader(gl.VERTEX_SHADER, vertSrc)
    const fs = this.compileShader(gl.FRAGMENT_SHADER, fragSrc)
    const prog = gl.createProgram()!
    gl.attachShader(prog, vs)
    gl.attachShader(prog, fs)
    gl.linkProgram(prog)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error('Program link failed: ' + gl.getProgramInfoLog(prog))
    }
    return prog
  }

  private compileShader(type: number, src: string): WebGLShader {
    const gl = this.gl
    const shader = gl.createShader(type)!
    gl.shaderSource(shader, src)
    gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const info = gl.getShaderInfoLog(shader)
      gl.deleteShader(shader)
      throw new Error('Shader compile failed: ' + info)
    }
    return shader
  }

  private createColormapTexture() {
    const gl = this.gl
    this.colormapTexture = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, this.colormapTexture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)

    const lut = this.buildColormapLUT(this.config.colormapName)
    const data = new Uint8Array(lut.length * 4)
    for (let i = 0; i < lut.length; i++) {
      data[i * 4] = lut[i][0]
      data[i * 4 + 1] = lut[i][1]
      data[i * 4 + 2] = lut[i][2]
      data[i * 4 + 3] = 255
    }
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, lut.length, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, data)
  }

  private buildColormapLUT(name: string): [number, number, number][] {
    const size = 256
    const lut: [number, number, number][] = []

    for (let i = 0; i < size; i++) {
      const t = i / (size - 1)
      let r: number, g: number, b: number

      if (name === 'jet') {
        r = t < 0.375 ? 0 : t < 0.625 ? (t - 0.375) / 0.25 : t < 0.875 ? 1.0 - (t - 0.625) / 0.25 : 0
        g = t < 0.125 ? 0 : t < 0.375 ? (t - 0.125) / 0.25 : t < 0.625 ? 1.0 : t < 0.875 ? 1.0 - (t - 0.625) / 0.25 : 0
        b = t < 0.375 ? 1.0 : t < 0.625 ? 1.0 - (t - 0.375) / 0.25 : 0
      } else if (name === 'hot') {
        r = t < 0.375 ? t / 0.375 : 1.0
        g = t < 0.375 ? 0 : t < 0.75 ? (t - 0.375) / 0.375 : 1.0
        b = t < 0.75 ? 0 : (t - 0.75) / 0.25
      } else if (name === 'seismic') {
        r = t < 0.5 ? 0 : (t - 0.5) * 2
        g = 1.0 - Math.abs(t - 0.5) * 2
        b = t < 0.5 ? 1.0 - t * 2 : 0
      } else {
        r = g = b = t
      }

      lut.push([
        Math.round(Math.max(0, Math.min(1, r)) * 255),
        Math.round(Math.max(0, Math.min(1, g)) * 255),
        Math.round(Math.max(0, Math.min(1, b)) * 255),
      ])
    }
    return lut
  }

  resizeTextures(width: number, height: number) {
    const gl = this.gl

    this.textureWidth = this.config.sampleRate > 0 ? Math.min(this.config.sampleRate / 40, 1024) : 512
    this.totalRows = height
    this.currentRow = 0

    if (this.frontTexture) gl.deleteTexture(this.frontTexture)
    if (this.backTexture) gl.deleteTexture(this.backTexture)
    if (this.framebuffer) gl.deleteFramebuffer(this.framebuffer)

    this.frontTexture = this.createDataTexture(this.textureWidth, this.totalRows)
    this.backTexture = this.createDataTexture(this.textureWidth, this.totalRows)

    this.framebuffer = gl.createFramebuffer()
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.backTexture, 0)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  }

  private createDataTexture(w: number, h: number): WebGLTexture {
    const gl = this.gl
    const tex = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, w, h, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, null)
    return tex
  }

  appendWaveformRow(samples: Float32Array) {
    if (!samples || samples.length === 0) return

    const gl = this.gl
    const texW = this.textureWidth
    const rowData = new Uint8Array(texW)

    const step = Math.max(1, Math.floor(samples.length / texW))
    for (let i = 0; i < texW; i++) {
      const srcIdx = Math.min(i * step, samples.length - 1)
      const val = samples[srcIdx]
      const normalized = Math.max(0, Math.min(1, (val - this.config.rangeMin) /
        (this.config.rangeMax - this.config.rangeMin + 0.0001)))
      const gamma = 1.0 / (this.config.gain + 0.01)
      rowData[i] = Math.round(Math.pow(normalized, gamma) * 255)
    }

    const targetRow = this.currentRow % this.totalRows

    gl.bindTexture(gl.TEXTURE_2D, this.frontTexture)
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, targetRow, texW, 1, gl.LUMINANCE, gl.UNSIGNED_BYTE, rowData)

    this.currentRow++
  }

  swapBuffers() {
    const temp = this.frontTexture
    this.frontTexture = this.backTexture
    this.backTexture = temp
  }

  render() {
    const gl = this.gl
    if (!this.program || !this.colormapTexture || !this.backTexture) return

    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height)
    gl.clearColor(0.04, 0.055, 0.09, 1.0)
    gl.clear(gl.COLOR_BUFFER_BIT)

    gl.useProgram(this.program)

    const posLoc = gl.getAttribLocation(this.program, 'a_position')
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer)
    gl.enableVertexAttribArray(posLoc)
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0)

    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.backTexture)
    const vdlLoc = gl.getUniformLocation(this.program, 'u_vdlTexture')
    gl.uniform1i(vdlLoc, 0)

    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, this.colormapTexture)
    const cmapLoc = gl.getUniformLocation(this.program, 'u_colormap')
    gl.uniform1i(cmapLoc, 1)

    const opacityLoc = gl.getUniformLocation(this.program, 'u_opacity')
    gl.uniform1f(opacityLoc, 1.0)

    gl.drawArrays(gl.TRIANGLES, 0, 6)
  }

  startRenderLoop() {
    if (this.rendering) return
    this.rendering = true
    const loop = () => {
      if (!this.rendering) return
      this.swapBuffers()
      this.render()
      this.animFrameId = requestAnimationFrame(loop)
    }
    loop()
  }

  stopRenderLoop() {
    this.rendering = false
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId)
      this.animFrameId = 0
    }
  }

  pan(dx: number, dy: number) {
    this.viewOffsetX += dx * this.viewScaleX
    this.viewOffsetY += dy * this.viewScaleY
  }

  setViewRange(offsetX: number, offsetY: number, scaleX: number, scaleY: number) {
    this.viewOffsetX = offsetX
    this.viewOffsetY = offsetY
    this.viewScaleX = scaleX
    this.viewScaleY = scaleY
  }

  updateConfig(config: Partial<VDLRenderConfig>) {
    const needColormapRebuild = config.colormapName && config.colormapName !== this.config.colormapName
    Object.assign(this.config, config)
    if (needColormapRebuild) {
      this.createColormapTexture()
    }
  }

  getCurrentRow(): number {
    return this.currentRow
  }

  getTotalRows(): number {
    return this.totalRows
  }

  destroy() {
    this.stopRenderLoop()
    const gl = this.gl
    if (this.frontTexture) gl.deleteTexture(this.frontTexture)
    if (this.backTexture) gl.deleteTexture(this.backTexture)
    if (this.colormapTexture) gl.deleteTexture(this.colormapTexture)
    if (this.quadBuffer) gl.deleteBuffer(this.quadBuffer)
    if (this.framebuffer) gl.deleteFramebuffer(this.framebuffer)
    if (this.program) gl.deleteProgram(this.program)
    if (this.colormapProgram) gl.deleteProgram(this.colormapProgram)
  }
}
