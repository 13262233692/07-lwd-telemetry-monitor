export interface LithologyAlert {
  frameSequence: number
  bitDepth: number
  alertLevel: 'NORMAL' | 'WARNING' | 'CRITICAL'
  lithologyType: 'SANDSTONE' | 'SHALE' | 'GAS_ZONE' | 'WATER_ZONE' | 'UNKNOWN'
  transitTimeFiltered: number
  attenuationFiltered: number
  gammaRayFiltered: number
  porosity: number
  porosityDelta: number
  message: string
}
