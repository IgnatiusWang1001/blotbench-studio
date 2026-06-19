import { describe, expect, it } from 'vitest'
import {
  autoDraftFromSignal,
  buildDefaultDrafts,
  detectSignalBounds,
  resizeRegionFromHandle,
  summarizeGroups,
  type AnalysisSettings,
} from './analysis'

const settings: AnalysisSettings = {
  mode: 'western',
  laneCount: 4,
  laneInset: 0.08,
  laneGap: 0.02,
  primaryY: 0.3,
  referenceY: 0.65,
  bandHeight: 0.1,
  backgroundOffset: 0.04,
  backgroundHeight: 0.05,
  brightness: 0,
  contrast: 1,
  invert: false,
}

describe('analysis helpers', () => {
  it('creates default drafts for each requested lane', () => {
    const drafts = buildDefaultDrafts({ width: 1200, height: 800, settings })
    expect(drafts).toHaveLength(4)
    expect(drafts[0].primary.width).toBeGreaterThan(0)
    expect(drafts[0].reference).not.toBeNull()
  })

  it('detects signal bounds and lane drafts from a synthetic panel', () => {
    const width = 400
    const height = 220
    const signal = new Float32Array(width * height)
    const display = new Uint8ClampedArray(width * height)
    display.fill(220)

    for (let lane = 0; lane < 4; lane += 1) {
      const laneX = 54 + lane * 78
      for (let y = 50; y < 90; y += 1) {
        for (let x = laneX; x < laneX + 38; x += 1) {
          signal[y * width + x] = 180
          display[y * width + x] = 52
        }
      }
      for (let y = 136; y < 166; y += 1) {
        for (let x = laneX; x < laneX + 38; x += 1) {
          signal[y * width + x] = 140
          display[y * width + x] = 84
        }
      }
    }

    const gray = { width, height, signal, display }
    const bounds = detectSignalBounds(gray)
    const drafts = autoDraftFromSignal(gray, bounds, settings)

    expect(bounds.width).toBeGreaterThan(150)
    expect(drafts).toHaveLength(4)
    expect(drafts[0].primary.y).toBeLessThan(drafts[0].reference?.y ?? 999)
  })

  it('summarizes group means and sem', () => {
    const summary = summarizeGroups([
      {
        id: 'a',
        label: 'A1',
        group: 'Control',
        enabled: true,
        primaryDensity: 12,
        primaryBackgroundMean: 1,
        referenceDensity: 6,
        referenceBackgroundMean: 0.6,
        displayValue: 2,
        saturationRisk: false,
        lowSignalRisk: false,
        confidence: 0.8,
        primaryCropUrl: '',
        referenceCropUrl: '',
      },
      {
        id: 'b',
        label: 'A2',
        group: 'Control',
        enabled: true,
        primaryDensity: 18,
        primaryBackgroundMean: 1,
        referenceDensity: 6,
        referenceBackgroundMean: 0.6,
        displayValue: 3,
        saturationRisk: false,
        lowSignalRisk: false,
        confidence: 0.8,
        primaryCropUrl: '',
        referenceCropUrl: '',
      },
    ])

    expect(summary).toHaveLength(1)
    expect(summary[0].mean).toBe(2.5)
    expect(summary[0].sem).toBeGreaterThan(0)
  })

  it('resizes a selected primary ROI from the northwest handle within lane bounds', () => {
    const draft = buildDefaultDrafts({
      width: 1000,
      height: 600,
      settings: { ...settings, laneCount: 1 },
    })[0]

    const resized = resizeRegionFromHandle(
      draft,
      { laneId: draft.id, target: 'primary' },
      'nw',
      -20,
      -12,
      draft.lane,
    )

    expect(resized.primary.x).toBeLessThan(draft.primary.x)
    expect(resized.primary.y).toBeLessThan(draft.primary.y)
    expect(resized.primary.width).toBeGreaterThan(draft.primary.width)
    expect(resized.primary.height).toBeGreaterThan(draft.primary.height)
    expect(resized.primary.x).toBeGreaterThanOrEqual(draft.lane.x)
    expect(resized.primary.y).toBeGreaterThanOrEqual(draft.lane.y)
  })
})
