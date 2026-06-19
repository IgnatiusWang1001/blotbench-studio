import { describe, expect, it } from 'vitest'
import { buildStatisticalSummary, defaultStatisticalSettings } from './statistics'
import type { LaneResult } from './analysis'

function lane(group: string, displayValue: number, index: number): LaneResult {
  return {
    id: `${group}-${index}`,
    label: `${group}-${index}`,
    group,
    enabled: true,
    primaryDensity: 1,
    primaryBackgroundMean: 0,
    referenceDensity: 1,
    referenceBackgroundMean: 0,
    displayValue,
    saturationRisk: false,
    lowSignalRisk: false,
    confidence: 0.9,
    primaryCropUrl: '',
    referenceCropUrl: '',
  }
}

describe('statistics helpers', () => {
  it('detects a significant difference against the baseline group', () => {
    const lanes = [
      lane('Control', 1.0, 1),
      lane('Control', 1.1, 2),
      lane('Control', 0.9, 3),
      lane('Control', 1.05, 4),
      lane('Drug', 2.1, 5),
      lane('Drug', 2.25, 6),
      lane('Drug', 2.0, 7),
      lane('Drug', 2.18, 8),
    ]

    const summary = buildStatisticalSummary(lanes, defaultStatisticalSettings)

    expect(summary.comparisons).toHaveLength(1)
    expect(summary.comparisons[0].groupA).toBe('Control')
    expect(summary.comparisons[0].groupB).toBe('Drug')
    expect(summary.comparisons[0].significant).toBe(true)
    expect(summary.comparisons[0].stars).not.toBe('')
  })

  it('skips groups with insufficient replicates', () => {
    const lanes = [lane('Control', 1.0, 1), lane('Drug', 2.0, 2), lane('Drug', 2.1, 3)]

    const summary = buildStatisticalSummary(lanes, defaultStatisticalSettings)

    expect(summary.comparisons).toHaveLength(0)
    expect(summary.warnings[0]).toContain('fewer than two active replicates')
  })

  it('computes omnibus ANOVA output for three groups', () => {
    const lanes = [
      lane('Control', 1.0, 1),
      lane('Control', 1.02, 2),
      lane('Control', 0.98, 3),
      lane('DrugA', 1.6, 4),
      lane('DrugA', 1.58, 5),
      lane('DrugA', 1.62, 6),
      lane('DrugB', 2.1, 7),
      lane('DrugB', 2.08, 8),
      lane('DrugB', 2.12, 9),
    ]

    const summary = buildStatisticalSummary(lanes, {
      ...defaultStatisticalSettings,
      comparisonMode: 'anova-posthoc',
    })

    expect(summary.omnibusPValue).not.toBeNull()
    expect(summary.comparisons.length).toBeGreaterThanOrEqual(3)
  })
})
