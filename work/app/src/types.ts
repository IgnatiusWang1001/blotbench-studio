export type AnalysisMode = 'western' | 'dot' | 'gel'
export type StatisticsComparisonMode = 'vs-baseline' | 'all-pairs' | 'anova-posthoc'
export type StatisticsCorrectionMode = 'none' | 'holm'
export type StatisticsMethod = 'permutation' | 'welch-t'

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface DecodedGrayImage {
  width: number
  height: number
  bitDepth: 8 | 16
  pixels: Uint8Array | Uint16Array
}

export interface PanelAsset {
  id: string
  name: string
  url: string
  dataUrl: string
  mimeType: string
  bitDepth: 8 | 16
  decodedGray?: DecodedGrayImage
  source: 'upload' | 'demo' | 'project'
}

export interface LaneConfig {
  id: string
  label: string
  group: string
  enabled: boolean
}

export interface LaneDraft {
  id: string
  lane: Rect
  primary: Rect
  reference: Rect | null
  confidence: number
}

export interface SelectedRegion {
  laneId: string
  target: 'lane' | 'primary' | 'reference'
}

export type ResizeHandle =
  | 'n'
  | 's'
  | 'e'
  | 'w'
  | 'ne'
  | 'nw'
  | 'se'
  | 'sw'

export interface StatisticalSettings {
  enabled: boolean
  method: StatisticsMethod
  comparisonMode: StatisticsComparisonMode
  baselineGroup: string
  correction: StatisticsCorrectionMode
  alpha: number
  showNonSignificant: boolean
}

export interface FigureBoardSettings {
  title: string
  columns: 1 | 2
  selectedPanelIds: string[]
}
