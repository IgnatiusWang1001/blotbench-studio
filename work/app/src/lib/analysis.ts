import type {
  AnalysisMode,
  DecodedGrayImage,
  LaneConfig,
  LaneDraft,
  PanelAsset,
  Rect,
  ResizeHandle,
  StatisticalSettings,
  SelectedRegion,
} from '../types'
import { buildStatisticalSummary } from './statistics'
import type { StatisticalSummary } from './statistics'

export interface AnalysisSettings {
  mode: AnalysisMode
  laneCount: number
  laneInset: number
  laneGap: number
  laneHeight: number
  laneWidthScale: number
  bandWidthScale: number
  primaryY: number
  referenceY: number
  bandHeight: number
  backgroundOffset: number
  backgroundHeight: number
  brightness: number
  contrast: number
  invert: boolean
}

export interface LaneGeometry {
  id: string
  lane: Rect
  primary: Rect
  primaryBackgroundTop: Rect
  primaryBackgroundBottom: Rect
  reference: Rect | null
  referenceBackgroundTop: Rect | null
  referenceBackgroundBottom: Rect | null
  confidence: number
}

export interface LaneResult {
  id: string
  label: string
  group: string
  enabled: boolean
  primaryDensity: number
  primaryBackgroundMean: number
  referenceDensity: number | null
  referenceBackgroundMean: number | null
  displayValue: number
  saturationRisk: boolean
  lowSignalRisk: boolean
  confidence: number
  primaryCropUrl: string
  referenceCropUrl: string | null
}

export interface GroupSummary {
  group: string
  values: number[]
  mean: number
  sd: number
  sem: number
}

export interface AnalysisOverview {
  meanDisplay: number
  dynamicRange: number
  saturationCount: number
  lowSignalCount: number
}

export interface AnalysisResult {
  processedUrl: string
  width: number
  height: number
  laneGeometries: LaneGeometry[]
  laneResults: LaneResult[]
  groupSummaries: GroupSummary[]
  statistics: StatisticalSummary
  overview: AnalysisOverview
  warnings: string[]
}

export interface GrayImage {
  width: number
  height: number
  signal: Float32Array
  display: Uint8ClampedArray
}

interface PreparedPanel {
  width: number
  height: number
  gray: GrayImage
  processedUrl: string
  canvas: HTMLCanvasElement
}

export const defaultSettings: AnalysisSettings = {
  mode: 'western',
  laneCount: 6,
  laneInset: 0.08,
  laneGap: 0.018,
  laneHeight: 0.42,
  laneWidthScale: 0.72,
  bandWidthScale: 1,
  primaryY: 0.31,
  referenceY: 0.69,
  bandHeight: 0.11,
  backgroundOffset: 0.045,
  backgroundHeight: 0.07,
  brightness: 8,
  contrast: 1.18,
  invert: false,
}

export function syncLaneConfigs(
  current: LaneConfig[],
  laneCount: number,
  groups?: string[],
): LaneConfig[] {
  return Array.from({ length: laneCount }, (_, index) => {
    const existing = current[index]
    const defaultGroup =
      groups?.[index] ??
      (index < Math.ceil(laneCount / 2) ? 'Control' : 'Treatment')

    if (existing) {
      return existing
    }

    return {
      id: crypto.randomUUID(),
      label: `S${index + 1}`,
      group: defaultGroup,
      enabled: true,
    }
  })
}

export function buildDefaultDrafts({
  width,
  height,
  settings,
}: {
  width: number
  height: number
  settings: AnalysisSettings
}): LaneDraft[] {
  const laneInsetPx = width * settings.laneInset
  const laneGapPx = width * settings.laneGap
  const usableWidth = width - laneInsetPx * 2 - laneGapPx * (settings.laneCount - 1)
  const baseLaneWidth = usableWidth / settings.laneCount
  const laneWidth = baseLaneWidth * settings.laneWidthScale
  const laneHeight = height * settings.laneHeight
  const laneTop = clamp(height * 0.5 - laneHeight / 2, height * 0.04, height - laneHeight - height * 0.04)
  const bandHeightPx = height * settings.bandHeight
  const bandWidthFactor = settings.mode === 'dot' ? 0.66 : 0.82

  return Array.from({ length: settings.laneCount }, (_, index) => {
    const slotX = laneInsetPx + index * (baseLaneWidth + laneGapPx)
    const laneX = slotX + (baseLaneWidth - laneWidth) / 2
    const lane: Rect = { x: laneX, y: laneTop, width: laneWidth, height: laneHeight }
    const bandWidth = clamp(
      laneWidth * bandWidthFactor * settings.bandWidthScale,
      Math.max(8, laneWidth * 0.28),
      laneWidth * 0.98,
    )
    const bandX = laneX + (laneWidth - bandWidth) / 2
    const primaryY = clamp(
      height * settings.primaryY - bandHeightPx / 2,
      laneTop,
      laneTop + laneHeight - bandHeightPx,
    )
    const referenceY = clamp(
      height * settings.referenceY - bandHeightPx / 2,
      laneTop,
      laneTop + laneHeight - bandHeightPx,
    )

    return {
      id: `lane-${index + 1}`,
      lane,
      primary: { x: bandX, y: primaryY, width: bandWidth, height: bandHeightPx },
      reference:
        settings.mode === 'gel'
          ? null
          : { x: bandX, y: referenceY, width: bandWidth, height: bandHeightPx },
      confidence: 0.45,
    }
  })
}

export function buildLaneGeometries({
  width,
  height,
  settings,
  drafts,
}: {
  width: number
  height: number
  settings: AnalysisSettings
  drafts: LaneDraft[]
}): LaneGeometry[] {
  const bounds: Rect = { x: 0, y: 0, width, height }
  const backgroundHeight = height * settings.backgroundHeight
  const backgroundOffset = height * settings.backgroundOffset

  return drafts.map((draft) => {
    const primaryBackgrounds = buildBackgroundRects(
      draft.primary,
      draft.lane,
      bounds,
      backgroundOffset,
      backgroundHeight,
    )
    const referenceBackgrounds =
      draft.reference && settings.mode !== 'gel'
        ? buildBackgroundRects(
            draft.reference,
            draft.lane,
            bounds,
            backgroundOffset,
            backgroundHeight,
          )
        : null

    return {
      id: draft.id,
      lane: draft.lane,
      primary: draft.primary,
      primaryBackgroundTop: primaryBackgrounds.top,
      primaryBackgroundBottom: primaryBackgrounds.bottom,
      reference: draft.reference,
      referenceBackgroundTop: referenceBackgrounds?.top ?? null,
      referenceBackgroundBottom: referenceBackgrounds?.bottom ?? null,
      confidence: draft.confidence,
    }
  })
}

export async function draftLaneLayout(
  panel: PanelAsset,
  settings: AnalysisSettings,
): Promise<{
  width: number
  height: number
  processedUrl: string
  drafts: LaneDraft[]
  warnings: string[]
}> {
  const prepared = await preparePanel(panel, settings)
  const bounds = detectSignalBounds(prepared.gray)
  const drafts = autoDraftFromSignal(prepared.gray, bounds, settings)
  const warnings: string[] = []

  if (bounds.width < prepared.width * 0.35 || bounds.height < prepared.height * 0.18) {
    warnings.push('Signal region is narrow. Check exposure or refine lane draft manually.')
  }

  if (drafts.some((draft) => draft.confidence < 0.4)) {
    warnings.push('At least one lane was drafted with low confidence. Inspect band placement before export.')
  }

  return {
    width: prepared.width,
    height: prepared.height,
    processedUrl: prepared.processedUrl,
    drafts,
    warnings,
  }
}

export async function createAnalysis(
  panel: PanelAsset,
  settings: AnalysisSettings,
  lanes: LaneConfig[],
  drafts: LaneDraft[],
  statisticalSettings: StatisticalSettings,
): Promise<AnalysisResult> {
  const prepared = await preparePanel(panel, settings)
  const laneGeometries = buildLaneGeometries({
    width: prepared.width,
    height: prepared.height,
    settings,
    drafts,
  })

  const laneResults = laneGeometries.map((geometry, index) => {
    const lane = lanes[index]
    const primarySample = sampleDensity(prepared.gray, geometry.primary)
    const primaryBackground = meanBackground(
      prepared.gray,
      geometry.primaryBackgroundTop,
      geometry.primaryBackgroundBottom,
    )
    const primaryDensity = Math.max(0, primarySample.mean - primaryBackground) * primarySample.area
    const primarySaturation = primarySample.saturatedFraction > 0.06
    const primaryLowSignal = primarySample.mean < 12

    let referenceDensity: number | null = null
    let referenceCropUrl: string | null = null
    let referenceBackgroundMean: number | null = null
    let saturationRisk = primarySaturation
    let lowSignalRisk = primaryLowSignal

    if (
      geometry.reference &&
      geometry.referenceBackgroundTop &&
      geometry.referenceBackgroundBottom
    ) {
      const referenceSample = sampleDensity(prepared.gray, geometry.reference)
      const referenceBackground = meanBackground(
        prepared.gray,
        geometry.referenceBackgroundTop,
        geometry.referenceBackgroundBottom,
      )
      referenceDensity =
        Math.max(0, referenceSample.mean - referenceBackground) * referenceSample.area
      referenceBackgroundMean = referenceBackground
      referenceCropUrl = cropRect(prepared.canvas, geometry.reference)
      saturationRisk = saturationRisk || referenceSample.saturatedFraction > 0.06
      lowSignalRisk = lowSignalRisk || referenceSample.mean < 12
    }

    const displayValue =
      referenceDensity && referenceDensity > 0 ? primaryDensity / referenceDensity : primaryDensity

    return {
      id: lane?.id ?? geometry.id,
      label: lane?.label ?? `S${index + 1}`,
      group: lane?.group ?? 'Group',
      enabled: lane?.enabled ?? true,
      primaryDensity,
      primaryBackgroundMean: primaryBackground,
      referenceDensity,
      referenceBackgroundMean,
      displayValue,
      saturationRisk,
      lowSignalRisk,
      confidence: geometry.confidence,
      primaryCropUrl: cropRect(prepared.canvas, geometry.primary),
      referenceCropUrl,
    }
  })

  const activeResults = laneResults.filter((lane) => lane.enabled)
  const groupSummaries = summarizeGroups(activeResults)
  const statistics = buildStatisticalSummary(activeResults, statisticalSettings)
  const values = activeResults.map((lane) => lane.displayValue).filter((value) => value > 0)
  const minValue = values.length ? Math.min(...values) : 0
  const maxValue = values.length ? Math.max(...values) : 0
  const warnings = buildWarnings(activeResults, settings.mode, statistics.warnings)

  return {
    processedUrl: prepared.processedUrl,
    width: prepared.width,
    height: prepared.height,
    laneGeometries,
    laneResults,
    groupSummaries,
    statistics,
    overview: {
      meanDisplay: mean(values),
      dynamicRange: minValue > 0 ? maxValue / minValue : maxValue,
      saturationCount: activeResults.filter((lane) => lane.saturationRisk).length,
      lowSignalCount: activeResults.filter((lane) => lane.lowSignalRisk).length,
    },
    warnings,
  }
}

export function applyRegionDelta(
  draft: LaneDraft,
  selected: SelectedRegion,
  deltaX: number,
  deltaY: number,
  bounds: Rect,
): LaneDraft {
  if (selected.target === 'lane') {
    const movedLane = moveRect(draft.lane, deltaX, deltaY, bounds)
    const actualDx = movedLane.x - draft.lane.x
    const actualDy = movedLane.y - draft.lane.y

    return {
      ...draft,
      lane: movedLane,
      primary: moveRect(draft.primary, actualDx, actualDy, movedLane),
      reference: draft.reference
        ? moveRect(draft.reference, actualDx, actualDy, movedLane)
        : null,
    }
  }

  if (selected.target === 'primary') {
    return {
      ...draft,
      primary: moveRect(draft.primary, deltaX, deltaY, draft.lane),
      confidence: Math.max(draft.confidence, 0.55),
    }
  }

  if (draft.reference) {
    return {
      ...draft,
      reference: moveRect(draft.reference, deltaX, deltaY, draft.lane),
      confidence: Math.max(draft.confidence, 0.55),
    }
  }

  return draft
}

export function resizeSelectedRegion(
  draft: LaneDraft,
  selected: SelectedRegion,
  deltaWidth: number,
  deltaHeight: number,
  bounds: Rect,
): LaneDraft {
  if (selected.target === 'lane') {
    const resizedLane = resizeRect(draft.lane, deltaWidth, deltaHeight, bounds)
    return {
      ...draft,
      lane: resizedLane,
      primary: fitRectInside(draft.primary, resizedLane),
      reference: draft.reference ? fitRectInside(draft.reference, resizedLane) : null,
    }
  }

  if (selected.target === 'primary') {
    return {
      ...draft,
      primary: resizeRect(draft.primary, deltaWidth, deltaHeight, draft.lane),
      confidence: Math.max(draft.confidence, 0.55),
    }
  }

  if (draft.reference) {
    return {
      ...draft,
      reference: resizeRect(draft.reference, deltaWidth, deltaHeight, draft.lane),
      confidence: Math.max(draft.confidence, 0.55),
    }
  }

  return draft
}

export function resizeRegionFromHandle(
  draft: LaneDraft,
  selected: SelectedRegion,
  handle: ResizeHandle,
  deltaX: number,
  deltaY: number,
  bounds: Rect,
): LaneDraft {
  const targetRect =
    selected.target === 'lane'
      ? draft.lane
      : selected.target === 'primary'
        ? draft.primary
        : draft.reference

  if (!targetRect) {
    return draft
  }

  const resized = resizeRectFromHandle(targetRect, handle, deltaX, deltaY, bounds)

  if (selected.target === 'lane') {
    return {
      ...draft,
      lane: resized,
      primary: fitRectInside(draft.primary, resized),
      reference: draft.reference ? fitRectInside(draft.reference, resized) : null,
    }
  }

  if (selected.target === 'primary') {
    return {
      ...draft,
      primary: fitRectInside(resized, draft.lane),
      confidence: Math.max(draft.confidence, 0.55),
    }
  }

  return {
    ...draft,
    reference: fitRectInside(resized, draft.lane),
    confidence: Math.max(draft.confidence, 0.55),
  }
}

export function retuneDraftsForSettings({
  drafts,
  previous,
  next,
  bounds,
}: {
  drafts: LaneDraft[]
  previous: AnalysisSettings
  next: AnalysisSettings
  bounds: Rect
}) {
  const laneWidthRatio = safeRatio(next.laneWidthScale, previous.laneWidthScale)
  const laneHeightRatio = safeRatio(next.laneHeight, previous.laneHeight)
  const bandWidthRatio = safeRatio(next.bandWidthScale, previous.bandWidthScale)
  const bandHeightRatio = safeRatio(next.bandHeight, previous.bandHeight)
  const primaryShiftY = (next.primaryY - previous.primaryY) * bounds.height
  const referenceShiftY = (next.referenceY - previous.referenceY) * bounds.height

  return drafts.map((draft) => {
    let lane = draft.lane
    let primary = draft.primary
    let reference = draft.reference

    if (laneWidthRatio !== 1 || laneHeightRatio !== 1) {
      const resizedLane = scaleRectFromCenter(
        lane,
        laneWidthRatio,
        laneHeightRatio,
        bounds,
      )
      primary = remapRectBetweenParents(primary, lane, resizedLane)
      reference = reference ? remapRectBetweenParents(reference, lane, resizedLane) : null
      lane = resizedLane
    }

    if (primaryShiftY !== 0) {
      primary = moveRect(primary, 0, primaryShiftY, lane)
    }

    if (reference && referenceShiftY !== 0) {
      reference = moveRect(reference, 0, referenceShiftY, lane)
    }

    if (bandWidthRatio !== 1 || bandHeightRatio !== 1) {
      primary = scaleRectFromCenter(primary, bandWidthRatio, bandHeightRatio, lane)
      reference = reference
        ? scaleRectFromCenter(reference, bandWidthRatio, bandHeightRatio, lane)
        : null
    }

    return {
      ...draft,
      lane,
      primary,
      reference,
      confidence: Math.max(draft.confidence, 0.55),
    }
  })
}

export function exportDraftSnapshot(drafts: LaneDraft[]) {
  return drafts.map((draft) => ({
    ...draft,
    lane: roundRect(draft.lane),
    primary: roundRect(draft.primary),
    reference: draft.reference ? roundRect(draft.reference) : null,
    confidence: roundValue(draft.confidence),
  }))
}

export function summarizeGroups(lanes: LaneResult[]): GroupSummary[] {
  const groups = new Map<string, number[]>()

  lanes.forEach((lane) => {
    const list = groups.get(lane.group) ?? []
    list.push(lane.displayValue)
    groups.set(lane.group, list)
  })

  return Array.from(groups.entries()).map(([group, values]) => {
    const average = mean(values)
    const sd = Math.sqrt(mean(values.map((value) => (value - average) ** 2)))
    return {
      group,
      values,
      mean: average,
      sd,
      sem: values.length > 0 ? sd / Math.sqrt(values.length) : 0,
    }
  })
}

export function detectSignalBounds(gray: GrayImage): Rect {
  const rowProfile = buildRowProfile(gray)
  const rowBand = outerBandAboveThreshold(
    rowProfile,
    0.18,
    Math.max(2, Math.round(gray.height * 0.01)),
  )
  const colProfile = buildColumnProfile(gray, rowBand.start, rowBand.end)
  const colBand = outerBandAboveThreshold(
    colProfile,
    0.12,
    Math.max(3, Math.round(gray.width * 0.008)),
  )
  const padX = gray.width * 0.02
  const padY = gray.height * 0.02

  return {
    x: clamp(colBand.start - padX, 0, gray.width - 1),
    y: clamp(rowBand.start - padY, 0, gray.height - 1),
    width: clamp(colBand.end - colBand.start + padX * 2, gray.width * 0.25, gray.width),
    height: clamp(rowBand.end - rowBand.start + padY * 2, gray.height * 0.08, gray.height),
  }
}

export function autoDraftFromSignal(
  gray: GrayImage,
  signalBounds: Rect,
  settings: AnalysisSettings,
): LaneDraft[] {
  const centerProfile = buildColumnProfile(
    gray,
    signalBounds.y,
    signalBounds.y + signalBounds.height,
  )
  const segmentWidth = signalBounds.width / settings.laneCount
  const profileMean = mean(Array.from(centerProfile))
  const profilePeak = Math.max(...Array.from(centerProfile), profileMean)
  const floorThreshold = profileMean + (profilePeak - profileMean) * 0.08
  const rawCenters = Array.from({ length: settings.laneCount }, (_, index) => {
    const expected = signalBounds.x + segmentWidth * (index + 0.5)
    const searchRadius = segmentWidth * 0.45
    const start = Math.round(expected - searchRadius)
    const end = Math.round(expected + searchRadius)
    const peak = findPeakCenter(centerProfile, start, end)
    const peakValue = centerProfile[Math.max(0, Math.min(centerProfile.length - 1, peak))]
    return peakValue >= floorThreshold ? peak : Math.round(expected)
  })
  const laneCenters = enforceLaneCenterOrdering(
    rawCenters,
    signalBounds.x,
    signalBounds.x + signalBounds.width,
    segmentWidth,
  )
  const centerDiffs = laneCenters
    .slice(1)
    .map((center, index) => center - laneCenters[index])
    .filter((value) => value > segmentWidth * 0.35)
  const estimatedSpacing = median(centerDiffs) || segmentWidth
  const laneWidth = Math.max(segmentWidth * 0.5, estimatedSpacing * settings.laneWidthScale)
  const laneHeight = Math.max(gray.height * 0.12, signalBounds.height * settings.laneHeight)
  const laneTop = clamp(
    signalBounds.y + signalBounds.height * 0.5 - laneHeight / 2,
    gray.height * 0.04,
    gray.height - laneHeight - gray.height * 0.04,
  )
  const bandHeight = Math.max(signalBounds.height * settings.bandHeight, gray.height * 0.04)

  return laneCenters.map((center, index) => {
    const laneX = clamp(center - laneWidth / 2, signalBounds.x, signalBounds.x + signalBounds.width - laneWidth)
    const lane: Rect = {
      x: laneX,
      y: laneTop,
      width: laneWidth,
      height: laneHeight,
    }
    const primaryCenter = detectBandCenterY(
      gray,
      lane,
      {
        start: signalBounds.y + signalBounds.height * 0.08,
        end: signalBounds.y + signalBounds.height * 0.56,
      },
      bandHeight,
    )
    const referenceCenter =
      settings.mode === 'gel'
        ? null
        : detectBandCenterY(
            gray,
            lane,
            {
              start: signalBounds.y + signalBounds.height * 0.48,
              end: signalBounds.y + signalBounds.height * 0.92,
            },
            bandHeight,
          )

    const primaryBand = estimateBandRect(gray, lane, primaryCenter, bandHeight, settings)
    const referenceBand =
      referenceCenter === null
        ? null
        : estimateBandRect(gray, lane, referenceCenter, bandHeight, settings)

    const primary: Rect = {
      x: primaryBand.x,
      y: clamp(primaryCenter - bandHeight / 2, lane.y, lane.y + lane.height - bandHeight),
      width: primaryBand.width,
      height: bandHeight,
    }
    const reference =
      referenceBand === null || referenceCenter === null
        ? null
        : {
            x: referenceBand.x,
            y: clamp(referenceCenter - bandHeight / 2, lane.y, lane.y + lane.height - bandHeight),
            width: referenceBand.width,
            height: bandHeight,
          }

    const prominence = sampleDensity(gray, primary).mean / Math.max(sampleDensity(gray, lane).mean, 1)

    return {
      id: `lane-${index + 1}`,
      lane,
      primary,
      reference,
      confidence: clamp(prominence, 0.25, 0.98),
    }
  })
}

export function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error(`Unable to read file: ${file.name}`))
    reader.readAsDataURL(file)
  })
}

async function preparePanel(panel: PanelAsset, settings: AnalysisSettings): Promise<PreparedPanel> {
  if (panel.decodedGray) {
    return prepareDecodedPanel(panel.decodedGray, settings)
  }

  const image = await loadImage(panel.url)
  const canvas = document.createElement('canvas')
  canvas.width = image.naturalWidth
  canvas.height = image.naturalHeight
  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('Canvas 2D context is unavailable.')
  }

  context.drawImage(image, 0, 0)
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height)
  const signal = new Float32Array(canvas.width * canvas.height)
  const display = new Uint8ClampedArray(canvas.width * canvas.height)

  for (let index = 0; index < imageData.data.length; index += 4) {
    const rawGray =
      imageData.data[index] * 0.299 +
      imageData.data[index + 1] * 0.587 +
      imageData.data[index + 2] * 0.114
    const transformed = clampByte((rawGray - 128) * settings.contrast + 128 + settings.brightness)
    const displayGray = settings.invert ? 255 - transformed : transformed
    imageData.data[index] = displayGray
    imageData.data[index + 1] = displayGray
    imageData.data[index + 2] = displayGray
    imageData.data[index + 3] = 255
    const signalIndex = index / 4
    display[signalIndex] = displayGray
    signal[signalIndex] = settings.invert ? displayGray : 255 - displayGray
  }

  context.putImageData(imageData, 0, 0)

  return {
    width: canvas.width,
    height: canvas.height,
    gray: {
      width: canvas.width,
      height: canvas.height,
      signal,
      display,
    },
    processedUrl: canvas.toDataURL('image/png'),
    canvas,
  }
}

function prepareDecodedPanel(
  decoded: DecodedGrayImage,
  settings: AnalysisSettings,
): PreparedPanel {
  const canvas = document.createElement('canvas')
  canvas.width = decoded.width
  canvas.height = decoded.height
  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('Canvas 2D context is unavailable.')
  }

  const imageData = context.createImageData(decoded.width, decoded.height)
  const signal = new Float32Array(decoded.width * decoded.height)
  const display = new Uint8ClampedArray(decoded.width * decoded.height)
  const maxValue = decoded.bitDepth === 16 ? 65535 : 255

  for (let index = 0; index < decoded.width * decoded.height; index += 1) {
    const rawValue = decoded.pixels[index]
    const normalized = (rawValue / maxValue) * 255
    const transformed = clampByte((normalized - 128) * settings.contrast + 128 + settings.brightness)
    const displayGray = settings.invert ? 255 - transformed : transformed
    const rgbaIndex = index * 4
    imageData.data[rgbaIndex] = displayGray
    imageData.data[rgbaIndex + 1] = displayGray
    imageData.data[rgbaIndex + 2] = displayGray
    imageData.data[rgbaIndex + 3] = 255
    display[index] = displayGray
    signal[index] = settings.invert ? displayGray : 255 - displayGray
  }

  context.putImageData(imageData, 0, 0)

  return {
    width: decoded.width,
    height: decoded.height,
    gray: {
      width: decoded.width,
      height: decoded.height,
      signal,
      display,
    },
    processedUrl: canvas.toDataURL('image/png'),
    canvas,
  }
}

function buildRowProfile(gray: GrayImage) {
  const profile = new Float32Array(gray.height)
  for (let y = 0; y < gray.height; y += 1) {
    let total = 0
    for (let x = 0; x < gray.width; x += 1) {
      total += gray.signal[y * gray.width + x]
    }
    profile[y] = total / gray.width
  }
  return smoothProfile(profile, 18)
}

function buildColumnProfile(gray: GrayImage, startY: number, endY: number) {
  const y0 = Math.max(0, Math.floor(startY))
  const y1 = Math.min(gray.height, Math.ceil(endY))
  const profile = new Float32Array(gray.width)

  for (let x = 0; x < gray.width; x += 1) {
    let total = 0
    let count = 0
    for (let y = y0; y < y1; y += 1) {
      total += gray.signal[y * gray.width + x]
      count += 1
    }
    profile[x] = count ? total / count : 0
  }

  return smoothProfile(profile, 12)
}

function longestBandAboveThreshold(profile: Float32Array) {
  const average = mean(Array.from(profile))
  const peak = Math.max(...Array.from(profile), average)
  const threshold = average + (peak - average) * 0.24
  let bestStart = 0
  let bestEnd = profile.length - 1
  let currentStart = -1
  let bestLength = 0

  for (let index = 0; index < profile.length; index += 1) {
    if (profile[index] >= threshold) {
      if (currentStart === -1) {
        currentStart = index
      }
    } else if (currentStart !== -1) {
      const length = index - currentStart
      if (length > bestLength) {
        bestLength = length
        bestStart = currentStart
        bestEnd = index
      }
      currentStart = -1
    }
  }

  if (currentStart !== -1) {
    bestStart = currentStart
    bestEnd = profile.length - 1
  }

  return { start: bestStart, end: bestEnd }
}

function outerBandAboveThreshold(
  profile: Float32Array,
  thresholdRatio: number,
  minRunLength: number,
) {
  const average = mean(Array.from(profile))
  const peak = Math.max(...Array.from(profile), average)
  const threshold = average + (peak - average) * thresholdRatio
  const runs: Array<{ start: number; end: number }> = []
  let currentStart = -1

  for (let index = 0; index < profile.length; index += 1) {
    if (profile[index] >= threshold) {
      if (currentStart === -1) {
        currentStart = index
      }
      continue
    }

    if (currentStart !== -1) {
      if (index - currentStart >= minRunLength) {
        runs.push({ start: currentStart, end: index })
      }
      currentStart = -1
    }
  }

  if (currentStart !== -1 && profile.length - currentStart >= minRunLength) {
    runs.push({ start: currentStart, end: profile.length - 1 })
  }

  if (!runs.length) {
    return longestBandAboveThreshold(profile)
  }

  return {
    start: runs[0].start,
    end: runs[runs.length - 1].end,
  }
}

function enforceLaneCenterOrdering(
  centers: number[],
  minX: number,
  maxX: number,
  segmentWidth: number,
) {
  if (!centers.length) {
    return centers
  }

  const minSpacing = Math.max(6, segmentWidth * 0.42)
  const left = Math.round(minX + segmentWidth * 0.28)
  const right = Math.round(maxX - segmentWidth * 0.28)
  const ordered = [...centers]

  ordered[0] = clamp(ordered[0], left, right)

  for (let index = 1; index < ordered.length; index += 1) {
    const minAllowed = ordered[index - 1] + minSpacing
    const maxAllowed = right - minSpacing * (ordered.length - 1 - index)
    ordered[index] = clamp(ordered[index], minAllowed, maxAllowed)
  }

  for (let index = ordered.length - 2; index >= 0; index -= 1) {
    const maxAllowed = ordered[index + 1] - minSpacing
    const minAllowed = left + minSpacing * index
    ordered[index] = clamp(ordered[index], minAllowed, maxAllowed)
  }

  return ordered
}

function detectBandCenterY(
  gray: GrayImage,
  lane: Rect,
  range: { start: number; end: number },
  bandHeight: number,
) {
  const x0 = Math.max(0, Math.floor(lane.x))
  const x1 = Math.min(gray.width, Math.ceil(lane.x + lane.width))
  const y0 = Math.max(0, Math.floor(range.start))
  const y1 = Math.min(gray.height, Math.ceil(range.end))
  const profile = new Float32Array(Math.max(1, y1 - y0))

  for (let y = y0; y < y1; y += 1) {
    let total = 0
    let count = 0
    for (let x = x0; x < x1; x += 1) {
      total += gray.signal[y * gray.width + x]
      count += 1
    }
    profile[y - y0] = count ? total / count : 0
  }

  const smoothed = smoothProfile(profile, Math.max(3, Math.round(bandHeight / 4)))
  const peakY = findPeakCenter(smoothed, 0, smoothed.length - 1)
  return y0 + peakY
}

function estimateBandRect(
  gray: GrayImage,
  lane: Rect,
  centerY: number,
  bandHeight: number,
  settings: AnalysisSettings,
) {
  const x0 = Math.max(0, Math.floor(lane.x))
  const x1 = Math.min(gray.width, Math.ceil(lane.x + lane.width))
  const y0 = Math.max(0, Math.floor(centerY - bandHeight * 0.45))
  const y1 = Math.min(gray.height, Math.ceil(centerY + bandHeight * 0.45))
  const profile = new Float32Array(Math.max(1, x1 - x0))

  for (let x = x0; x < x1; x += 1) {
    let total = 0
    let count = 0
    for (let y = y0; y < y1; y += 1) {
      total += gray.signal[y * gray.width + x]
      count += 1
    }
    profile[x - x0] = count ? total / count : 0
  }

  const fallbackFactor = settings.mode === 'dot' ? 0.62 : 0.82
  const fallbackWidth = clamp(
    lane.width * fallbackFactor * settings.bandWidthScale,
    Math.max(8, lane.width * 0.28),
    lane.width * 0.98,
  )
  const baseline = mean(Array.from(profile))
  const peak = Math.max(...Array.from(profile), baseline)

  if (peak <= baseline + 1) {
    return {
      x: lane.x + (lane.width - fallbackWidth) / 2,
      width: fallbackWidth,
    }
  }

  const smoothed = smoothProfile(profile, Math.max(2, Math.round(profile.length * 0.04)))
  const centerLocal = clamp(lane.width / 2, 0, smoothed.length - 1)
  const peakIndex = findPeakCenter(
    smoothed,
    centerLocal - smoothed.length * 0.26,
    centerLocal + smoothed.length * 0.26,
  )
  const threshold =
    baseline + (peak - baseline) * (settings.mode === 'dot' ? 0.26 : 0.18)
  const gapAllowance = Math.max(1, Math.round(smoothed.length * 0.025))
  let left = peakIndex
  let right = peakIndex
  let gap = 0

  while (left > 0) {
    const nextValue = smoothed[left - 1]
    if (nextValue >= threshold) {
      left -= 1
      gap = 0
      continue
    }
    if (gap < gapAllowance) {
      left -= 1
      gap += 1
      continue
    }
    break
  }

  gap = 0
  while (right < smoothed.length - 1) {
    const nextValue = smoothed[right + 1]
    if (nextValue >= threshold) {
      right += 1
      gap = 0
      continue
    }
    if (gap < gapAllowance) {
      right += 1
      gap += 1
      continue
    }
    break
  }

  const detectedWidth = Math.max(1, right - left + 1)
  const scaledWidth = clamp(
    detectedWidth * settings.bandWidthScale,
    lane.width * (settings.mode === 'dot' ? 0.28 : 0.34),
    lane.width * 0.98,
  )
  const detectedCenter = (left + right) / 2
  const start = clamp(detectedCenter - scaledWidth / 2, 0, smoothed.length - scaledWidth)

  return {
    x: lane.x + start,
    width: scaledWidth,
  }
}

function sampleDensity(gray: GrayImage, rect: Rect) {
  const x0 = Math.max(0, Math.floor(rect.x))
  const y0 = Math.max(0, Math.floor(rect.y))
  const x1 = Math.min(gray.width, Math.ceil(rect.x + rect.width))
  const y1 = Math.min(gray.height, Math.ceil(rect.y + rect.height))
  let total = 0
  let count = 0
  let saturated = 0

  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const index = y * gray.width + x
      total += gray.signal[index]
      if (gray.display[index] < 5 || gray.display[index] > 250) {
        saturated += 1
      }
      count += 1
    }
  }

  return {
    mean: count ? total / count : 0,
    area: count,
    saturatedFraction: count ? saturated / count : 0,
  }
}

function meanBackground(gray: GrayImage, topRect: Rect, bottomRect: Rect) {
  const top = sampleDensity(gray, topRect).mean
  const bottom = sampleDensity(gray, bottomRect).mean
  return (top + bottom) / 2
}

function cropRect(canvas: HTMLCanvasElement, rect: Rect) {
  const cropCanvas = document.createElement('canvas')
  cropCanvas.width = Math.max(1, Math.round(rect.width))
  cropCanvas.height = Math.max(1, Math.round(rect.height))
  const context = cropCanvas.getContext('2d')
  if (!context) {
    throw new Error('Canvas 2D context is unavailable for crop export.')
  }

  context.drawImage(
    canvas,
    rect.x,
    rect.y,
    rect.width,
    rect.height,
    0,
    0,
    cropCanvas.width,
    cropCanvas.height,
  )

  return cropCanvas.toDataURL('image/png')
}

function buildBackgroundRects(
  band: Rect,
  lane: Rect,
  bounds: Rect,
  offset: number,
  backgroundHeight: number,
) {
  const topY = clamp(
    band.y - offset - backgroundHeight,
    Math.max(lane.y, bounds.y),
    Math.min(lane.y + lane.height, bounds.y + bounds.height) - backgroundHeight,
  )
  const bottomY = clamp(
    band.y + band.height + offset,
    Math.max(lane.y, bounds.y),
    Math.min(lane.y + lane.height, bounds.y + bounds.height) - backgroundHeight,
  )

  return {
    top: { x: band.x, y: topY, width: band.width, height: backgroundHeight },
    bottom: { x: band.x, y: bottomY, width: band.width, height: backgroundHeight },
  }
}

function buildWarnings(lanes: LaneResult[], mode: AnalysisMode, extraWarnings: string[] = []) {
  const warnings: string[] = [...extraWarnings]
  const saturated = lanes.filter((lane) => lane.saturationRisk)
  const lowSignal = lanes.filter((lane) => lane.lowSignalRisk)
  const lowConfidence = lanes.filter((lane) => lane.confidence < 0.45)

  if (saturated.length) {
    warnings.push(`${saturated.length} active lane(s) show saturation risk. Re-check exposure before trusting ratios.`)
  }
  if (lowSignal.length) {
    warnings.push(`${lowSignal.length} active lane(s) show low signal intensity. Background subtraction may dominate the result.`)
  }
  if (lowConfidence.length) {
    warnings.push(`${lowConfidence.length} lane draft(s) have low auto-detection confidence. Manual correction is recommended.`)
  }
  if (mode !== 'gel' && lanes.some((lane) => !lane.referenceDensity)) {
    warnings.push('At least one lane has no reference signal. That lane is reported as direct corrected density.')
  }

  return warnings
}

function moveRect(rect: Rect, deltaX: number, deltaY: number, bounds: Rect): Rect {
  const x = clamp(rect.x + deltaX, bounds.x, bounds.x + bounds.width - rect.width)
  const y = clamp(rect.y + deltaY, bounds.y, bounds.y + bounds.height - rect.height)
  return { ...rect, x, y }
}

function resizeRect(rect: Rect, deltaWidth: number, deltaHeight: number, bounds: Rect): Rect {
  const width = clamp(rect.width + deltaWidth, 8, bounds.width)
  const height = clamp(rect.height + deltaHeight, 8, bounds.height)
  const x = clamp(rect.x - deltaWidth / 2, bounds.x, bounds.x + bounds.width - width)
  const y = clamp(rect.y - deltaHeight / 2, bounds.y, bounds.y + bounds.height - height)
  return { x, y, width, height }
}

function resizeRectFromHandle(
  rect: Rect,
  handle: ResizeHandle,
  deltaX: number,
  deltaY: number,
  bounds: Rect,
): Rect {
  const next = { ...rect }

  if (handle.includes('e')) {
    next.width = clamp(rect.width + deltaX, 8, bounds.x + bounds.width - rect.x)
  }
  if (handle.includes('s')) {
    next.height = clamp(rect.height + deltaY, 8, bounds.y + bounds.height - rect.y)
  }
  if (handle.includes('w')) {
    const nextX = clamp(rect.x + deltaX, bounds.x, rect.x + rect.width - 8)
    next.width = rect.width + (rect.x - nextX)
    next.x = nextX
  }
  if (handle.includes('n')) {
    const nextY = clamp(rect.y + deltaY, bounds.y, rect.y + rect.height - 8)
    next.height = rect.height + (rect.y - nextY)
    next.y = nextY
  }

  return fitRectInside(next, bounds)
}

function fitRectInside(rect: Rect, bounds: Rect): Rect {
  const width = clamp(rect.width, 8, bounds.width)
  const height = clamp(rect.height, 8, bounds.height)
  return {
    x: clamp(rect.x, bounds.x, bounds.x + bounds.width - width),
    y: clamp(rect.y, bounds.y, bounds.y + bounds.height - height),
    width,
    height,
  }
}

function scaleRectFromCenter(
  rect: Rect,
  widthRatio: number,
  heightRatio: number,
  bounds: Rect,
): Rect {
  const width = clamp(rect.width * widthRatio, 8, bounds.width)
  const height = clamp(rect.height * heightRatio, 8, bounds.height)
  const x = clamp(rect.x + rect.width / 2 - width / 2, bounds.x, bounds.x + bounds.width - width)
  const y = clamp(rect.y + rect.height / 2 - height / 2, bounds.y, bounds.y + bounds.height - height)
  return { x, y, width, height }
}

function remapRectBetweenParents(rect: Rect, from: Rect, to: Rect) {
  const relX = from.width > 0 ? (rect.x - from.x) / from.width : 0
  const relY = from.height > 0 ? (rect.y - from.y) / from.height : 0
  const relWidth = from.width > 0 ? rect.width / from.width : 1
  const relHeight = from.height > 0 ? rect.height / from.height : 1

  return fitRectInside(
    {
      x: to.x + relX * to.width,
      y: to.y + relY * to.height,
      width: to.width * relWidth,
      height: to.height * relHeight,
    },
    to,
  )
}

function safeRatio(next: number, previous: number) {
  if (!Number.isFinite(next) || !Number.isFinite(previous) || previous === 0) {
    return 1
  }
  return next / previous
}

function smoothProfile(profile: Float32Array, radius: number) {
  const smoothed = new Float32Array(profile.length)

  for (let index = 0; index < profile.length; index += 1) {
    let total = 0
    let count = 0
    for (let offset = -radius; offset <= radius; offset += 1) {
      const sampleIndex = index + offset
      if (sampleIndex >= 0 && sampleIndex < profile.length) {
        total += profile[sampleIndex]
        count += 1
      }
    }
    smoothed[index] = count ? total / count : profile[index]
  }

  return smoothed
}

function findPeakCenter(profile: Float32Array, start: number, end: number) {
  const from = Math.max(0, Math.floor(start))
  const to = Math.min(profile.length - 1, Math.ceil(end))
  let bestIndex = from
  let bestValue = -Infinity

  for (let index = from; index <= to; index += 1) {
    if (profile[index] > bestValue) {
      bestValue = profile[index]
      bestIndex = index
    }
  }

  return bestIndex
}

function median(values: number[]) {
  if (!values.length) {
    return 0
  }
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle]
}

function roundRect(rect: Rect): Rect {
  return {
    x: roundValue(rect.x),
    y: roundValue(rect.y),
    width: roundValue(rect.width),
    height: roundValue(rect.height),
  }
}

function roundValue(value: number) {
  return Number(value.toFixed(3))
}

function mean(values: number[]) {
  if (!values.length) {
    return 0
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function clampByte(value: number) {
  return clamp(Math.round(value), 0, 255)
}

function loadImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Unable to load the selected assay image.'))
    image.src = url
  })
}
