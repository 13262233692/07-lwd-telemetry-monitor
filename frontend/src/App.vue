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
        <span class="stat">GR: {{ currentGammaRay.toFixed(1) }}API</span>
      </div>
    </header>

    <div v-if="lithologyAlert.alertLevel !== 'NORMAL'" class="alert-banner" :class="'alert-' + lithologyAlert.alertLevel.toLowerCase()">
      <span class="alert-icon">{{ lithologyAlert.alertLevel === 'CRITICAL' ? '🔴' : '🟡' }}</span>
      <span class="alert-msg">{{ lithologyAlert.alertMessage }}</span>
      <span class="alert-detail">
        孔隙度={{ (lithologyAlert.porosity * 100).toFixed(1) }}%
        | Δt={{ lithologyAlert.transitTimeFiltered.toFixed(1) }}μs/ft
        | GR={{ lithologyAlert.gammaRayFiltered.toFixed(1) }}API
        | 岩性={{ lithologyAlert.lithologyType }}
      </span>
    </div>

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

      <aside class="lithology-panel">
        <div class="litho-title">岩性诊断</div>
        <div class="litho-item">
          <span class="litho-label">孔隙度</span>
          <span class="litho-val" :class="{ 'val-warn': lithologyAlert.porosity > 0.15 }">
            {{ (lithologyAlert.porosity * 100).toFixed(1) }}%
          </span>
        </div>
        <div class="litho-item">
          <span class="litho-label">首波Δt</span>
          <span class="litho-val">{{ lithologyAlert.transitTimeFiltered.toFixed(1) }}μs/ft</span>
        </div>
        <div class="litho-item">
          <span class="litho-label">衰减</span>
          <span class="litho-val">{{ lithologyAlert.attenuationFiltered.toFixed(3) }}</span>
        </div>
        <div class="litho-item">
          <span class="litho-label">GR</span>
          <span class="litho-val" :class="{ 'val-warn': lithologyAlert.gammaRayFiltered < 30 }">
            {{ lithologyAlert.gammaRayFiltered.toFixed(1) }}API
          </span>
        </div>
        <div class="litho-item">
          <span class="litho-label">Δφ</span>
          <span class="litho-val" :class="{ 'val-warn': lithologyAlert.porosityDelta > 0.08 }">
            {{ (lithologyAlert.porosityDelta * 100).toFixed(2) }}%
          </span>
        </div>
        <div class="litho-divider"></div>
        <div class="litho-item">
          <span class="litho-label">岩性</span>
          <span class="litho-val litho-type" :class="'type-' + lithologyAlert.lithologyType.toLowerCase()">
            {{ lithologyTypeName }}
          </span>
        </div>
        <div class="litho-item">
          <span class="litho-label">预警</span>
          <span class="litho-val" :class="'alert-level-' + lithologyAlert.alertLevel.toLowerCase()">
            {{ lithologyAlert.alertLevel }}
          </span>
        </div>
      </aside>
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
        <label>蜂鸣</label>
        <input type="checkbox" v-model="audioEnabled" />
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
import type { LithologyAlert } from './types/LithologyAlert'
import { VDLRenderer, type VDLRenderConfig, type AlertBand } from './core/VDLRenderer'
import { WaveformRenderer } from './core/WaveformRenderer'
import { WaveformBuffer } from './core/WaveformBuffer'
import { TelemetryClient, type ConnectionStatus } from './core/TelemetryClient'
import { LithologyEngine, type LithologyState } from './core/LithologyEngine'
import { AlertAudio } from './core/AlertAudio'

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
const currentGammaRay = ref(45)
const colormapName = ref('jet')
const gain = ref(1.0)
const activeChannel = ref(0)
const connectionStatus = ref<ConnectionStatus>('disconnected')
const audioEnabled = ref(true)

const lithologyAlert = reactive<LithologyState>({
  transitTimeFiltered: 0,
  attenuationFiltered: 0,
  gammaRayFiltered: 0,
  porosity: 0,
  porosityDelta: 0,
  lithologyType: 'UNKNOWN',
  alertLevel: 'NORMAL',
  alertMessage: '',
})

const isPanning = ref(false)
const panStartX = ref(0)
const panStartY = ref(0)
const panVdlIdx = ref(0)

let vdlRenderers: (VDLRenderer | null)[] = [null, null, null]
let wfRenderers: (WaveformRenderer | null)[] = [null, null, null]
let waveBuffer: WaveformBuffer | null = null
let lithologyEngine: LithologyEngine | null = null
let alertAudio: AlertAudio | null = null
let telemetryClient: TelemetryClient | null = null
let depthCtx: CanvasRenderingContext2D | null = null

let alertBandRowStart = -1
let alertBandRowEnd = -1

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

const lithologyTypeName = computed(() => {
  const map: Record<string, string> = {
    SANDSTONE: '砂岩',
    SHALE: '泥岩',
    GAS_ZONE: '气层',
    WATER_ZONE: '水层',
    UNKNOWN: '未知',
  }
  return map[lithologyAlert.lithologyType] || lithologyAlert.lithologyType
})

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
  currentGammaRay.value = frame.gammaRay

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

  if (lithologyEngine && frame.waveformData.length > 0) {
    const state = lithologyEngine.evaluateLocal(
      frame.waveformData[0],
      frame.gammaRay,
      frame.bitDepth
    )
    Object.assign(lithologyAlert, state)

    updateAlertBands(state)
  }

  renderDepthRuler()
}

function onAlert(alert: LithologyAlert) {
  if (lithologyEngine) {
    lithologyEngine.pushServerAlert(alert)
    Object.assign(lithologyAlert, lithologyEngine.currentState)
  }

  updateAlertBands(lithologyAlert)

  if (audioEnabled.value && alert.alertLevel !== 'NORMAL' && alertAudio) {
    alertAudio.play()
  }
}

function updateAlertBands(state: LithologyState) {
  if (state.alertLevel !== 'NORMAL') {
    const currentRow = vdlRenderers[0]?.getCurrentRow() ?? 0
    alertBandRowStart = Math.max(0, currentRow - 3)
    alertBandRowEnd = currentRow + 1
  } else {
    alertBandRowStart = -1
    alertBandRowEnd = -1
  }

  for (let i = 0; i < 3; i++) {
    const vdl = vdlRenderers[i]
    if (vdl) {
      if (alertBandRowStart >= 0 && alertBandRowEnd >= 0) {
        vdl.setAlertBands([{
          rowStart: alertBandRowStart,
          rowEnd: alertBandRowEnd,
          level: state.alertLevel as 'WARNING' | 'CRITICAL',
        }])
      } else {
        vdl.setAlertBands([])
      }
    }
  }
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

  lithologyEngine = new LithologyEngine()
  alertAudio = new AlertAudio()

  initRenderers()

  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const wsUrl = `${wsProtocol}//${window.location.hostname}:8080/ws/telemetry`

  telemetryClient = new TelemetryClient({
    url: wsUrl,
    onFrame,
    onAlert,
    onStatusChange,
  })

  telemetryClient.connect()
})

onBeforeUnmount(() => {
  vdlRenderers.forEach(r => r?.destroy())
  wfRenderers.forEach(r => r?.destroy())
  alertAudio?.destroy()
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

.alert-banner {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 20px;
  font-size: 12px;
  font-weight: 600;
  flex-shrink: 0;
  animation: alertPulse 1.5s ease-in-out infinite;
}

.alert-banner.alert-warning {
  background: linear-gradient(90deg, rgba(255, 200, 0, 0.15), rgba(255, 200, 0, 0.05));
  border-bottom: 1px solid rgba(255, 200, 0, 0.3);
  color: #ffc800;
}

.alert-banner.alert-critical {
  background: linear-gradient(90deg, rgba(255, 40, 40, 0.2), rgba(255, 40, 40, 0.05));
  border-bottom: 1px solid rgba(255, 40, 40, 0.4);
  color: #ff4444;
}

.alert-icon { font-size: 14px; }
.alert-msg { font-size: 13px; }
.alert-detail { color: #8b949e; font-weight: 400; font-size: 11px; }

@keyframes alertPulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.7; }
}

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

.lithology-panel {
  width: 140px;
  flex-shrink: 0;
  background: #0d1117;
  border-left: 1px solid #1e293b;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.litho-title {
  font-size: 11px;
  font-weight: 700;
  color: #00ccff;
  text-align: center;
  padding-bottom: 4px;
  border-bottom: 1px solid #1e293b;
}

.litho-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 11px;
}

.litho-label {
  color: #8b949e;
}

.litho-val {
  color: #e0e6f0;
  font-weight: 600;
}

.val-warn {
  color: #ff6644;
}

.litho-divider {
  height: 1px;
  background: #1e293b;
  margin: 4px 0;
}

.litho-type {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 3px;
}

.type-sandstone { background: rgba(210, 180, 100, 0.2); color: #d2b464; }
.type-shale { background: rgba(128, 128, 128, 0.2); color: #999; }
.type-gas_zone { background: rgba(255, 60, 60, 0.2); color: #ff4444; }
.type-water_zone { background: rgba(60, 140, 255, 0.2); color: #4488ff; }
.type-unknown { background: rgba(128, 128, 128, 0.1); color: #666; }

.alert-level-normal { color: #00ff88; }
.alert-level-warning { color: #ffc800; }
.alert-level-critical { color: #ff4444; animation: alertPulse 1s infinite; }

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

.ctrl-group input[type="checkbox"] {
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
