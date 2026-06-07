import type { LithologyAlert } from '../types/LithologyAlert'

const SLIDING_WINDOW_SIZE = 5
const POROSITY_MUTATION_THRESHOLD = 0.08
const GAMMA_RAY_GAS_THRESHOLD = 30.0
const GAMMA_RAY_SHALE_THRESHOLD = 75.0
const POROSITY_GAS_MIN = 0.15
const POROSITY_WATER_MIN = 0.20
const ATTENUATION_WATER_MAX = 0.35
const MATRIX_TRANSIT_TIME = 55.5
const FLUID_TRANSIT_TIME = 189.0
const GAS_TRANSIT_TIME = 900.0

export interface LithologyState {
  transitTimeFiltered: number
  attenuationFiltered: number
  gammaRayFiltered: number
  porosity: number
  porosityDelta: number
  lithologyType: string
  alertLevel: 'NORMAL' | 'WARNING' | 'CRITICAL'
  alertMessage: string
}

export class LithologyEngine {
  private transitTimeWindow: number[] = []
  private attenuationWindow: number[] = []
  private gammaRayWindow: number[] = []
  private previousPorosity = NaN

  private alertBuffer: LithologyAlert[] = []
  private maxAlertBuffer = 100

  get currentState(): LithologyState {
    return this._currentState
  }

  private _currentState: LithologyState = {
    transitTimeFiltered: 0,
    attenuationFiltered: 0,
    gammaRayFiltered: 0,
    porosity: 0,
    porosityDelta: 0,
    lithologyType: 'UNKNOWN',
    alertLevel: 'NORMAL',
    alertMessage: '',
  }

  pushServerAlert(alert: LithologyAlert) {
    this.alertBuffer.push(alert)
    if (this.alertBuffer.length > this.maxAlertBuffer) {
      this.alertBuffer.shift()
    }

    this._currentState = {
      transitTimeFiltered: alert.transitTimeFiltered,
      attenuationFiltered: alert.attenuationFiltered,
      gammaRayFiltered: alert.gammaRayFiltered,
      porosity: alert.porosity,
      porosityDelta: alert.porosityDelta,
      lithologyType: alert.lithologyType,
      alertLevel: alert.alertLevel,
      alertMessage: alert.message,
    }
  }

  evaluateLocal(pWaveData: Float32Array, gammaRay: number, bitDepth: number): LithologyState {
    const transitTime = this.extractTransitTime(pWaveData)
    const attenuation = this.extractAttenuation(pWaveData)

    const transitTimeFiltered = this.slidingWindowFilter(this.transitTimeWindow, transitTime)
    const attenuationFiltered = this.slidingWindowFilter(this.attenuationWindow, attenuation)
    const gammaRayFiltered = this.slidingWindowFilter(this.gammaRayWindow, gammaRay)

    const porosity = this.computeWylliePorosity(transitTimeFiltered, gammaRayFiltered)
    const porosityDelta = isNaN(this.previousPorosity) ? 0 : Math.abs(porosity - this.previousPorosity)
    this.previousPorosity = porosity

    let lithologyType = 'SANDSTONE'
    let alertLevel: 'NORMAL' | 'WARNING' | 'CRITICAL' = 'NORMAL'
    let alertMessage = ''

    if (gammaRayFiltered < GAMMA_RAY_GAS_THRESHOLD && porosity >= POROSITY_GAS_MIN && transitTimeFiltered > MATRIX_TRANSIT_TIME * 1.5) {
      lithologyType = 'GAS_ZONE'
      alertLevel = 'CRITICAL'
      alertMessage = `⚠ 气层预警 | 孔隙度=${(porosity * 100).toFixed(1)}% GR=${gammaRayFiltered.toFixed(1)}API`
    } else if (gammaRayFiltered > GAMMA_RAY_GAS_THRESHOLD && gammaRayFiltered < GAMMA_RAY_SHALE_THRESHOLD && porosity >= POROSITY_WATER_MIN && attenuationFiltered < ATTENUATION_WATER_MAX) {
      lithologyType = 'WATER_ZONE'
      alertLevel = 'WARNING'
      alertMessage = `⚠ 水层预警 | 孔隙度=${(porosity * 100).toFixed(1)}% 衰减=${attenuationFiltered.toFixed(2)}`
    } else if (gammaRayFiltered > GAMMA_RAY_SHALE_THRESHOLD) {
      lithologyType = 'SHALE'
    } else if (porosityDelta > POROSITY_MUTATION_THRESHOLD) {
      alertLevel = 'WARNING'
      alertMessage = `孔隙度突变 | Δφ=${(porosityDelta * 100).toFixed(1)}%`
    }

    this._currentState = {
      transitTimeFiltered,
      attenuationFiltered,
      gammaRayFiltered,
      porosity,
      porosityDelta,
      lithologyType,
      alertLevel,
      alertMessage,
    }

    return this._currentState
  }

  getAlerts(): LithologyAlert[] {
    return [...this.alertBuffer]
  }

  hasActiveAlert(): boolean {
    return this._currentState.alertLevel !== 'NORMAL'
  }

  private extractTransitTime(data: Float32Array): number {
    if (!data || data.length < 10) return 0

    const rms = this.computeRms(data)
    const threshold = rms * 2.5
    let peakIdx = 0
    let peakVal = 0

    for (let i = 1; i < data.length; i++) {
      const absVal = Math.abs(data[i])
      if (absVal > threshold && absVal > peakVal) {
        peakVal = absVal
        peakIdx = i
      }
    }

    const sampleIntervalUs = 1e6 / 20000
    return peakIdx * sampleIntervalUs
  }

  private extractAttenuation(data: Float32Array): number {
    if (!data || data.length < 20) return 0

    const q = Math.floor(data.length / 4)
    let firstPeak = 0
    let lateAvg = 0

    for (let i = 0; i < q; i++) {
      firstPeak = Math.max(firstPeak, Math.abs(data[i]))
    }
    for (let i = q * 2; i < q * 3; i++) {
      lateAvg += Math.abs(data[i])
    }
    lateAvg /= q

    if (firstPeak < 1e-6) return 0
    return 1.0 - lateAvg / firstPeak
  }

  private computeRms(data: Float32Array): number {
    let sum = 0
    for (let i = 0; i < data.length; i++) {
      sum += data[i] * data[i]
    }
    return Math.sqrt(sum / data.length)
  }

  private slidingWindowFilter(window: number[], value: number): number {
    window.push(value)
    while (window.length > SLIDING_WINDOW_SIZE) {
      window.shift()
    }
    let sum = 0
    let weightSum = 0
    for (let i = 0; i < window.length; i++) {
      const weight = i + 1
      sum += window[i] * weight
      weightSum += weight
    }
    return sum / weightSum
  }

  private computeWylliePorosity(transitTime: number, gammaRay: number): number {
    const dtFluid = gammaRay < GAMMA_RAY_GAS_THRESHOLD ? GAS_TRANSIT_TIME : FLUID_TRANSIT_TIME
    if (transitTime <= MATRIX_TRANSIT_TIME) return 0
    const phi = (transitTime - MATRIX_TRANSIT_TIME) / (dtFluid - MATRIX_TRANSIT_TIME)
    return Math.max(0, Math.min(1, phi))
  }

  reset() {
    this.transitTimeWindow = []
    this.attenuationWindow = []
    this.gammaRayWindow = []
    this.previousPorosity = NaN
    this.alertBuffer = []
    this._currentState = {
      transitTimeFiltered: 0,
      attenuationFiltered: 0,
      gammaRayFiltered: 0,
      porosity: 0,
      porosityDelta: 0,
      lithologyType: 'UNKNOWN',
      alertLevel: 'NORMAL',
      alertMessage: '',
    }
  }
}
