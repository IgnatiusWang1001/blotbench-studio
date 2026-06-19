import type { AnalysisSettings, LaneResult } from './analysis'
import { exportDraftSnapshot } from './analysis'
import type {
  DecodedGrayImage,
  FigureBoardSettings,
  LaneConfig,
  LaneDraft,
  PanelAsset,
  StatisticalSettings,
} from '../types'

const AUTOSAVE_KEY = 'blotbench-autosave-v1'

interface SerializedDecodedGrayImage {
  width: number
  height: number
  bitDepth: 8 | 16
  pixels: number[]
}

type SerializedPanelAsset = Omit<PanelAsset, 'decodedGray'> & {
  decodedGray?: SerializedDecodedGrayImage
}

export interface ProjectSnapshot {
  version: 1
  exportedAt: string
  activePanelId: string | null
  panels: SerializedPanelAsset[]
  settings?: AnalysisSettings
  statisticalSettings?: StatisticalSettings
  figureBoardSettings: FigureBoardSettings
  lanes?: LaneConfig[]
  settingsByPanelId: Record<string, AnalysisSettings>
  statisticalSettingsByPanelId: Record<string, StatisticalSettings>
  lanesByPanelId: Record<string, LaneConfig[]>
  draftsByPanelId: Record<string, LaneDraft[]>
  analysisSummary: LaneResult[] | null
}

export interface RestoredProjectSnapshot extends Omit<ProjectSnapshot, 'panels'> {
  panels: PanelAsset[]
}

export function createProjectSnapshot({
  activePanelId,
  panels,
  figureBoardSettings,
  settingsByPanelId,
  statisticalSettingsByPanelId,
  lanesByPanelId,
  draftsByPanelId,
  analysisSummary,
}: {
  activePanelId: string | null
  panels: PanelAsset[]
  figureBoardSettings: FigureBoardSettings
  settingsByPanelId: Record<string, AnalysisSettings>
  statisticalSettingsByPanelId: Record<string, StatisticalSettings>
  lanesByPanelId: Record<string, LaneConfig[]>
  draftsByPanelId: Record<string, LaneDraft[]>
  analysisSummary: LaneResult[] | null
}): ProjectSnapshot {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    activePanelId,
    panels: panels.map((panel) => ({
      ...panel,
      url: panel.dataUrl,
      decodedGray: serializeDecodedGray(panel.decodedGray),
    })),
    figureBoardSettings,
    settingsByPanelId,
    statisticalSettingsByPanelId,
    lanesByPanelId,
    draftsByPanelId: Object.fromEntries(
      Object.entries(draftsByPanelId).map(([panelId, drafts]) => [
        panelId,
        exportDraftSnapshot(drafts),
      ]),
    ),
    analysisSummary,
  }
}

export function saveAutosave(snapshot: ProjectSnapshot) {
  localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(snapshot))
}

export function loadAutosave(): RestoredProjectSnapshot | null {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY)
    if (!raw) {
      return null
    }

    return parseProjectSnapshot(raw)
  } catch {
    clearAutosave()
    return null
  }
}

export function clearAutosave() {
  localStorage.removeItem(AUTOSAVE_KEY)
}

export function parseProjectSnapshot(raw: string): RestoredProjectSnapshot {
  const parsed = JSON.parse(raw) as ProjectSnapshot
  if (parsed.version !== 1 || !Array.isArray(parsed.panels)) {
    throw new Error('Unsupported project file.')
  }

  return {
    ...parsed,
    panels: parsed.panels.map((panel) => ({
      ...panel,
      url: panel.dataUrl,
      decodedGray: reviveDecodedGray(panel.decodedGray),
      source: panel.source ?? 'project',
    })),
    settingsByPanelId: parsed.settingsByPanelId ?? {},
    statisticalSettingsByPanelId: parsed.statisticalSettingsByPanelId ?? {},
    lanesByPanelId: parsed.lanesByPanelId ?? {},
    figureBoardSettings: parsed.figureBoardSettings,
  }
}

function serializeDecodedGray(decodedGray?: DecodedGrayImage) {
  if (!decodedGray) {
    return undefined
  }

  return {
    width: decodedGray.width,
    height: decodedGray.height,
    bitDepth: decodedGray.bitDepth,
    pixels: Array.from(decodedGray.pixels),
  } satisfies SerializedDecodedGrayImage
}

function reviveDecodedGray(decodedGray?: DecodedGrayImage | SerializedDecodedGrayImage) {
  if (!decodedGray) {
    return undefined
  }

  const pixelValues = Array.isArray(decodedGray.pixels)
    ? decodedGray.pixels
    : Array.from(decodedGray.pixels as Uint8Array | Uint16Array)

  return {
    width: decodedGray.width,
    height: decodedGray.height,
    bitDepth: decodedGray.bitDepth,
    pixels:
      decodedGray.bitDepth === 16
        ? new Uint16Array(pixelValues)
        : new Uint8Array(pixelValues),
  } satisfies DecodedGrayImage
}
