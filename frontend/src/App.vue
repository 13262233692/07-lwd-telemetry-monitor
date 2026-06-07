<template>
  <div class="monitor-root">
    <header class="top-bar">
      <div class="logo">
        <span class="logo-icon">&#9670;</span>
        <span class="logo-text">LWD 随钻测井遥测监控系统</span>
      </div>
      <div class="status-group">
        <span class="status-badge" :class="statusClass">{{ statusText }}</span>
        <span class="stat">帧: {{ frameCount }}</span>
        <span class="stat">深度: {{ currentDepth.toFixed(1) }}m</span>
        <span class="stat">温度: {{ currentTemp.toFixed(1) }}&#8451;</span>
        <span class="stat">压力: {{ currentPressure.toFixed(0) }}psi</span>
      </div>
    </header>

    <main class="main-area">
      <aside class="depth-ruler">
        <canvas ref="depthCanvas" class="depth-canvas"></canvas>
      </aside>

      <section class="vdl-section">
        <div class="vdl-container">
          <div class="vdl-panel" v-for="(ch, idx) in channels" :key="ch.key">
            <div class="vdl-label">{{ ch.label }}</div>
            <canvas
              :ref="(el) => setVdlCanvas(el, idx)"
              class="vdl-canvas"
              @mousedown="onVdlMouseDown($event, idx)"
              @mousemove="onVdlMouseMove($event, idx)"
              @mouseup="onVdlMouseUp"
              @mouseleave="onVdlMouseUp"
            ></canvas>
          </div>
        </div>
      </section>

      <section class="waveform-section">
        <div class="wf-panel" v-for="(ch, idx) in channels" :key="ch.key">
          <canvas :ref="(el) => setWfCanvas(el, idx)" class="wf-canvas"></canvas>
        </div>
      </section>
    </main>

    <footer class="control-bar">
      <div class="ctrl-group">
        <label>色标</label>
        <select v-model="colormapName">
          <option value="jet">Jet</option>
          <option value="hot">Hot</option>
          <option value="seismic">Seismic</option>
          <option value="gray">Gray</option>
        </select>
      </div>
      <div class="ctrl-group">
        <label>增益</label>
        <input type="range" min="0.1" max="5" step="0.1" v-model.number="gain" />
        <span class="ctrl-val">{{ gain.toFixed(1) }}</span>
      </div>
      <div class="ctrl-group">
        <label>显示道</label>
        <select v-model="activeChannel">
          <option :value="0">纵波 P-Wave</option>
          <option :value="1">横波 S-Wave</option>
          <option :value="2">斯通利波 Stoneley</option>
        </select>
      </div>
      <div class="ctrl-group">
        <button class="btn" @click="toggleConnection">{{ connectBtnText }}</button>
      </div>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, onBeforeUnmount, computed, nextTick } from 'vue'
import type { MptFrame } from './types/MptFrame'
import { VDLRenderer, type VDLRenderConfig } from './core/VDLRenderer'
import { WaveformRenderer } from './core/WaveformRenderer'
import { WaveformBuffer } from './core/WaveformBuffer'
import { TelemetryClient, type ConnectionStatus } from './core/TelemetryClient'

const channels = [
  { key: 'pwave', label: '纵波 P-Wave' },
  { key: 'swave', label: '横波 S-Wave' },
  { key: 'stoneley', label: '斯通利波 Stoneley' },
]

const depthCanvas = ref<HTMLCanvasElement | null>(null)
const vdlCanvases = ref<(HTMLCanvasElement | null)[]>([null, null, null])
const wfCanvases = ref<(HTMLCanvasElement | null)[]>([null, null, null])

const frameCount = ref(0)
const currentDepth = ref(2500)
const currentTemp = ref(150)
const currentPressure = ref(5000)
const colormapName = ref('jet')
const gain = ref(1.0)
const activeChannel = ref(0)
const connectionStatus = ref<ConnectionStatus>('disconnected')

const isPanning = ref(false)
const panStartX = ref(0)
const panStartY = ref(0)
const panVdlIdx = ref(0)

let vdlRenderers: (VDLRenderer | null)[] = [null, null, null]
let wfRenderers: (WaveformRenderer | null)[] = [null, null, null]
let waveBuffer: WaveformBuffer | null = null
let telemetryClient: TelemetryClient | null = null
let depthCtx: CanvasRenderingContext2D | null = null
let animId = 0

const statusClass = computed(() => {
  const map: Record<ConnectionStatus, string> = {
    connected: 'status-ok',
    connecting: 'status-warn',
    disconnected: 'status-off',
    error: 'status-err',
  }
  return map[connectionStatus.value]
})

const statusText = computed(() => {
  const map: Record<ConnectionStatus, string> = {
    connected: '已连接',
    connecting: '连接中...',
    disconnected: '未连接',
    error: '连接错误',
  }
  return map[connectionStatus.value]
})

const connectBtnText = computed(() =>
  connectionStatus.value === 'connected' ? '断开' : '连接'
)

function setVdlCanvas(el: any, idx: number) {
  vdlCanvases.value[idx] = el as HTMLCanvasElement | null
}

function setWfCanvas(el: any, idx: number) {
  wfCanvases.value[idx] = el as HTMLCanvasElement | null
}

function initRenderers() {
  for (let i = 0; i < 3; i++) {
    const vdlCanvas = vdlCanvases.value[i]
    if (vdlCanvas) {
      const config: VDLRenderConfig = {
        width: vdlCanvas.clientWidth,
        height: vdlCanvas.clientHeight,
        depthRange: 100,
        sampleRate: 20000,
        channelIndex: i,
        gain: gain.value,
        rangeMin: -1,
        rangeMax: 1,
        colormapName: colormapName.value,
      }
      if (vdlRenderers[i]) vdlRenderers[i]!.destroy()
      vdlRenderers[i] = new VDLRenderer(vdlCanvas, config)
      vdlRenderers[i]!.startRenderLoop()
    }

    const wfCanvas = wfCanvases.value[i]
    if (wfCanvas) {
      if (wfRenderers[i]) wfRenderers[i]!.destroy()
      wfRenderers[i] = new WaveformRenderer(wfCanvas)
    }
  }

  const dc = depthCanvas.value
  if (dc) {
    depthCtx = dc.getContext('2d')
  }
}

function onFrame(frame: MptFrame) {
  frameCount.value++
  currentDepth.value = frame.bitDepth
  currentTemp.value = frame.temperature
  currentPressure.value = frame.mudPressure

  if (waveBuffer) {
    waveBuffer.push(frame)
  }

  for (let i = 0; i < 3; i++) {
    const vdl = vdlRenderers[i]
    if (vdl && i < frame.waveformData.length) {
      vdl.appendWaveformRow(frame.waveformData[i])
    }

    const wf = wfRenderers[i]
    if (wf && i < frame.waveformData.length) {
      wf.render(frame.waveformData[i], channels[i].label)
    }
  }

  renderDepthRuler()
}

function renderDepthRuler() {
  const ctx = depthCtx
  const canvas = depthCanvas.value
  if (!ctx || !canvas || !waveBuffer) return

  const w = canvas.clientWidth
  const h = canvas.clientHeight
  canvas.width = w * (window.devicePixelRatio || 1)
  canvas.height = h * (window.devicePixelRatio || 1)
  ctx.scale(window.devicePixelRatio || 1, window.devicePixelRatio || 1)

  ctx.fillStyle = '#0d1117'
  ctx.fillRect(0, 0, w, h)

  const depthRange = waveBuffer.getDepthRange()
  const totalDepth = depthRange.max - depthRange.min
  if (totalDepth <= 0) return

  ctx.strokeStyle = 'rgba(0, 255, 136, 0.3)'
  ctx.fillStyle = '#8b949e'
  ctx.font = '10px Consolas, Monaco, monospace'
  ctx.textAlign = 'right'

  const step = Math.max(1, Math.ceil(totalDepth / 20))
  for (let d = Math.ceil(depthRange.min / step) * step; d <= depthRange.max; d += step) {
    const y = h - ((d - depthRange.min) / totalDepth) * h
    ctx.beginPath()
    ctx.moveTo(w - 10, y)
    ctx.lineTo(w, y)
    ctx.stroke()
    ctx.fillText(d.toFixed(0) + 'm', w - 14, y + 3)
  }
}

function onStatusChange(status: ConnectionStatus) {
  connectionStatus.value = status
}

function toggleConnection() {
  if (connectionStatus.value === 'connected') {
    telemetryClient?.disconnect()
  } else {
    telemetryClient?.connect()
  }
}

function onVdlMouseDown(e: MouseEvent, idx: number) {
  isPanning.value = true
  panStartX.value = e.clientX
  panStartY.value = e.clientY
  panVdlIdx.value = idx
}

function onVdlMouseMove(e: MouseEvent, idx: number) {
  if (!isPanning.value || panVdlIdx.value !== idx) return
  const dx = e.clientX - panStartX.value
  const dy = e.clientY - panStartY.value
  panStartX.value = e.clientX
  panStartY.value = e.clientY

  const vdl = vdlRenderers[idx]
  if (vdl) {
    vdl.pan(-dx / 500, -dy / 500)
  }
}

function onVdlMouseUp() {
  isPanning.value = false
}

onMounted(async () => {
  await nextTick()

  waveBuffer = new WaveformBuffer({
    maxFrames: 2000,
    sampleRate: 20000,
    channels: 3,
  })

  initRenderers()

  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const wsUrl = `${wsProtocol}//${window.location.hostname}:8080/ws/telemetry`

  telemetryClient = new TelemetryClient({
    url: wsUrl,
    onFrame,
    onStatusChange,
  })

  telemetryClient.connect()
})

onBeforeUnmount(() => {
  if (animId) cancelAnimationFrame(animId)
  vdlRenderers.forEach(r => r?.destroy())
  wfRenderers.forEach(r => r?.destroy())
  telemetryClient?.disconnect()
})
</script>

<style scoped>
.monitor-root {
  width: 100vw;
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: #0a0e17;
  color: #e0e6f0;
  font-family: 'Consolas', 'Monaco', monospace;
  overflow: hidden;
}

.top-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 20px;
  background: linear-gradient(180deg, #111827, #0d1117);
  border-bottom: 1px solid #1e293b;
  flex-shrink: 0;
}

.logo {
  display: flex;
  align-items: center;
  gap: 10px;
}

.logo-icon {
  color: #00ff88;
  font-size: 22px;
}

.logo-text {
  font-size: 16px;
  font-weight: 700;
  letter-spacing: 2px;
  background: linear-gradient(90deg, #00ff88, #00ccff);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

.status-group {
  display: flex;
  align-items: center;
  gap: 16px;
  font-size: 12px;
}

.status-badge {
  padding: 2px 10px;
  border-radius: 10px;
  font-weight: 600;
  font-size: 11px;
}

.status-ok { background: rgba(0, 255, 136, 0.2); color: #00ff88; }
.status-warn { background: rgba(255, 200, 0, 0.2); color: #ffc800; }
.status-off { background: rgba(128, 128, 128, 0.2); color: #888; }
.status-err { background: rgba(255, 60, 60, 0.2); color: #ff3c3c; }

.stat { color: #8b949e; }

.main-area {
  flex: 1;
  display: flex;
  overflow: hidden;
}

.depth-ruler {
  width: 60px;
  flex-shrink: 0;
  background: #0d1117;
  border-right: 1px solid #1e293b;
}

.depth-canvas {
  width: 100%;
  height: 100%;
}

.vdl-section {
  flex: 3;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.vdl-container {
  display: flex;
  flex: 1;
  gap: 2px;
}

.vdl-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  background: #0d1117;
  border: 1px solid #1e293b;
  position: relative;
}

.vdl-label {
  padding: 4px 8px;
  font-size: 11px;
  color: #8b949e;
  background: rgba(0, 0, 0, 0.4);
  text-align: center;
  flex-shrink: 0;
}

.vdl-canvas {
  width: 100%;
  flex: 1;
  cursor: grab;
}

.vdl-canvas:active {
  cursor: grabbing;
}

.waveform-section {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
  border-left: 1px solid #1e293b;
  min-width: 200px;
}

.wf-panel {
  flex: 1;
  background: #0d1117;
  border: 1px solid #1e293b;
}

.wf-canvas {
  width: 100%;
  height: 100%;
}

.control-bar {
  display: flex;
  align-items: center;
  gap: 24px;
  padding: 8px 20px;
  background: linear-gradient(0deg, #111827, #0d1117);
  border-top: 1px solid #1e293b;
  flex-shrink: 0;
}

.ctrl-group {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
}

.ctrl-group label {
  color: #8b949e;
  white-space: nowrap;
}

.ctrl-group select,
.ctrl-group input[type="range"] {
  background: #1a1f2e;
  color: #e0e6f0;
  border: 1px solid #2d3748;
  border-radius: 4px;
  padding: 2px 6px;
  font-size: 11px;
  font-family: inherit;
}

.ctrl-group input[type="range"] {
  width: 80px;
  accent-color: #00ff88;
}

.ctrl-val {
  color: #00ff88;
  min-width: 28px;
}

.btn {
  background: linear-gradient(180deg, #1a3a2a, #0d2a1a);
  color: #00ff88;
  border: 1px solid #00ff88;
  border-radius: 4px;
  padding: 4px 16px;
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
  transition: all 0.2s;
}

.btn:hover {
  background: linear-gradient(180deg, #2a5a3a, #1a4a2a);
}
</style>
