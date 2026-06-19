import { describe, expect, it } from 'vitest'
import { createProjectSnapshot, parseProjectSnapshot } from './project'
import { defaultSettings } from './analysis'
import { defaultStatisticalSettings } from './statistics'

describe('project snapshot', () => {
  it('restores modern panel snapshots with serialized decoded TIFF pixels', () => {
    const snapshot = createProjectSnapshot({
      activePanelId: 'panel-1',
      panels: [
        {
          id: 'panel-1',
          name: 'wb-16bit.tif',
          url: 'blob:temp',
          dataUrl: 'data:image/tiff;base64,abc',
          mimeType: 'image/tiff',
          bitDepth: 16,
          decodedGray: {
            width: 2,
            height: 2,
            bitDepth: 16,
            pixels: new Uint16Array([120, 240, 360, 480]),
          },
          source: 'upload',
        },
      ],
      figureBoardSettings: {
        title: 'Board',
        columns: 1,
        selectedPanelIds: ['panel-1'],
      },
      settingsByPanelId: { 'panel-1': defaultSettings },
      statisticalSettingsByPanelId: { 'panel-1': defaultStatisticalSettings },
      lanesByPanelId: { 'panel-1': [] },
      draftsByPanelId: {},
      analysisSummary: null,
    })

    const restored = parseProjectSnapshot(JSON.stringify(snapshot))
    const pixels = restored.panels[0].decodedGray?.pixels

    expect(pixels).toBeInstanceOf(Uint16Array)
    expect(Array.from(pixels ?? [])).toEqual([120, 240, 360, 480])
  })

  it('accepts legacy project snapshots that only store global settings and lanes', () => {
    const legacy = {
      version: 1,
      exportedAt: '2026-06-19T12:00:00.000Z',
      activePanelId: 'legacy-panel',
      panels: [
        {
          id: 'legacy-panel',
          name: 'legacy.png',
          url: 'data:image/png;base64,abc',
          dataUrl: 'data:image/png;base64,abc',
          mimeType: 'image/png',
          bitDepth: 8,
          source: 'project',
        },
      ],
      settings: defaultSettings,
      statisticalSettings: defaultStatisticalSettings,
      lanes: [],
      figureBoardSettings: {
        title: 'Legacy board',
        columns: 1,
        selectedPanelIds: ['legacy-panel'],
      },
      settingsByPanelId: {},
      statisticalSettingsByPanelId: {},
      lanesByPanelId: {},
      draftsByPanelId: {},
      analysisSummary: null,
    }

    const restored = parseProjectSnapshot(JSON.stringify(legacy))

    expect(restored.panels).toHaveLength(1)
    expect(restored.activePanelId).toBe('legacy-panel')
    expect(restored.settingsByPanelId['legacy-panel'].bandWidthScale).toBe(1)
    expect(restored.statisticalSettingsByPanelId['legacy-panel'].method).toBe(
      defaultStatisticalSettings.method,
    )
  })
})
