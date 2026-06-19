import type { AnalysisResult, LaneResult } from './analysis'
import type { StatisticalComparison } from './statistics'
import type { AnalysisMode, FigureBoardSettings } from '../types'

export interface FigureDocument {
  svg: string
  width: number
  height: number
}

export interface FigurePanel {
  id: string
  panelName: string
  analysis: AnalysisResult
  mode: AnalysisMode
}

export function serializeCsv(lanes: LaneResult[]) {
  const rows = [
    [
      'lane_id',
      'label',
      'group',
      'enabled',
      'primary_density',
      'primary_background_mean',
      'reference_density',
      'reference_background_mean',
      'display_value',
      'saturation_risk',
      'low_signal_risk',
      'confidence',
    ],
    ...lanes.map((lane) => [
      lane.id,
      lane.label,
      lane.group,
      String(lane.enabled),
      lane.primaryDensity.toFixed(4),
      lane.primaryBackgroundMean.toFixed(4),
      lane.referenceDensity?.toFixed(4) ?? '',
      lane.referenceBackgroundMean?.toFixed(4) ?? '',
      lane.displayValue.toFixed(4),
      String(lane.saturationRisk),
      String(lane.lowSignalRisk),
      lane.confidence.toFixed(3),
    ]),
  ]

  return rows.map((row) => row.map(escapeCsv).join(',')).join('\n')
}

export function buildFigureDocument({
  analysis,
  panelName,
  mode,
}: {
  analysis: AnalysisResult
  panelName: string
  mode: AnalysisMode
}): FigureDocument {
  return buildFigureBoardDocument({
    panels: [{ id: 'panel-a', panelName, analysis, mode }],
    boardSettings: {
      title: panelName,
      columns: 1,
      selectedPanelIds: ['panel-a'],
    },
  })
}

export function buildFigureBoardDocument({
  panels,
  boardSettings,
}: {
  panels: FigurePanel[]
  boardSettings: FigureBoardSettings
}): FigureDocument {
  if (!panels.length) {
    return {
      width: 900,
      height: 520,
      svg: `
        <svg xmlns="http://www.w3.org/2000/svg" width="900" height="520" viewBox="0 0 900 520">
          <rect width="900" height="520" fill="#f5efe4" />
          <rect x="36" y="36" width="828" height="448" rx="28" fill="#fffdf8" stroke="#d8cec1" stroke-width="2" />
          <text x="72" y="116" font-size="28" fill="#211b14" font-family="Georgia, Times New Roman, serif">No panels selected</text>
          <text x="72" y="154" font-size="15" fill="#6d6257" font-family="Aptos, Segoe UI, sans-serif">
            Add one or more analyzed panels to compose a publication board.
          </text>
        </svg>
      `.trim(),
    }
  }

  const columns = boardSettings.columns
  const boardWidth = columns === 2 ? 1500 : 980
  const outerPadding = 42
  const headerHeight = 118
  const gap = 24
  const panelWidth =
    columns === 2
      ? (boardWidth - outerPadding * 2 - gap) / 2
      : boardWidth - outerPadding * 2

  const rows = chunkPanels(panels, columns)
  const rowHeights = rows.map((row) =>
    Math.max(...row.map((panel) => estimatePanelHeight(panel.mode))),
  )
  const boardHeight =
    outerPadding + headerHeight + rowHeights.reduce((sum, value) => sum + value, 0) + gap * (rows.length - 1) + outerPadding

  let currentY = outerPadding + headerHeight
  const rowGroups = rows
    .map((row, rowIndex) => {
      const rowHeight = rowHeights[rowIndex]
      const rendered = row
        .map((panel, columnIndex) => {
          const x = outerPadding + columnIndex * (panelWidth + gap)
          const letter = String.fromCharCode(65 + rowIndex * columns + columnIndex)
          return renderFigurePanel({
            panel,
            letter,
            x,
            y: currentY,
            width: panelWidth,
            height: rowHeight,
          })
        })
        .join('')
      currentY += rowHeight + gap
      return rendered
    })
    .join('')

  return {
    width: boardWidth,
    height: boardHeight,
    svg: `
      <svg xmlns="http://www.w3.org/2000/svg" width="${boardWidth}" height="${boardHeight}" viewBox="0 0 ${boardWidth} ${boardHeight}">
        <rect width="${boardWidth}" height="${boardHeight}" fill="#f5efe4" />
        <rect x="${outerPadding - 8}" y="${outerPadding - 8}" width="${boardWidth - (outerPadding - 8) * 2}" height="${boardHeight - (outerPadding - 8) * 2}" rx="30" fill="#fffdf8" stroke="#d8cec1" stroke-width="2" />
        <text x="${outerPadding}" y="${outerPadding + 18}" font-size="15" fill="#8e6c46" font-family="Aptos, Segoe UI, sans-serif">BlotBench figure board</text>
        <text x="${outerPadding}" y="${outerPadding + 56}" font-size="30" fill="#211b14" font-family="Georgia, Times New Roman, serif">${escapeXml(boardSettings.title || 'Composed blot figure')}</text>
        <text x="${outerPadding}" y="${outerPadding + 82}" font-size="14" fill="#6d6257" font-family="Aptos, Segoe UI, sans-serif">
          Local-first assay layout with synchronized crops, semi-quantification, and in-board significance annotations.
        </text>
        ${rowGroups}
      </svg>
    `.trim(),
  }
}

export async function exportFigurePdf(document: FigureDocument, filename: string) {
  const [{ jsPDF }, { svg2pdf }] = await Promise.all([
    import('jspdf'),
    import('svg2pdf.js'),
  ])
  const parser = new DOMParser()
  const svgNode = parser.parseFromString(document.svg, 'image/svg+xml').documentElement
  const pdf = new jsPDF({
    unit: 'pt',
    format: [document.width, document.height],
    orientation: document.width > document.height ? 'landscape' : 'portrait',
  })

  await svg2pdf(svgNode as unknown as SVGElement, pdf, {
    x: 0,
    y: 0,
    width: document.width,
    height: document.height,
  })
  pdf.save(filename)
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

function renderFigurePanel({
  panel,
  letter,
  x,
  y,
  width,
  height,
}: {
  panel: FigurePanel
  letter: string
  x: number
  y: number
  width: number
  height: number
}) {
  const topLabel = panel.mode === 'gel' ? 'Band' : panel.mode === 'dot' ? 'Target spot' : 'Target'
  const bottomLabel =
    panel.mode === 'gel' ? null : panel.mode === 'dot' ? 'Reference spot' : 'Loading control'
  const innerX = x + 28
  const innerY = y + 26
  const innerWidth = width - 56
  const cropLabelWidth = 108
  const cropLaneWidth = Math.max(
    48,
    (innerWidth - cropLabelWidth - 10 * Math.max(panel.analysis.laneResults.length - 1, 0)) /
      Math.max(panel.analysis.laneResults.length, 1),
  )
  const cropHeight = panel.mode === 'dot' ? 54 : 58
  const referenceHeight = panel.mode === 'gel' ? 0 : 52
  const cropStartX = innerX + cropLabelWidth
  const titleY = innerY + 8
  const warningLines = panel.analysis.warnings.slice(0, 2)

  const chartFrame = renderChart({
    analysis: panel.analysis,
    mode: panel.mode,
    x: innerX,
    y: innerY + (bottomLabel ? 158 : 108),
    width: innerWidth,
    height: height - (bottomLabel ? 232 : 184),
  })

  const targetImages = panel.analysis.laneResults
    .map((lane, index) => {
      const laneX = cropStartX + index * (cropLaneWidth + 10)
      return `
        <g opacity="${lane.enabled ? '1' : '0.34'}">
          <image x="${laneX}" y="${innerY + 44}" width="${cropLaneWidth}" height="${cropHeight}" href="${lane.primaryCropUrl}" preserveAspectRatio="none" />
          <text x="${laneX + cropLaneWidth / 2}" y="${innerY + 118}" text-anchor="middle" font-size="11" fill="#342c22" font-family="Aptos, Segoe UI, sans-serif">${escapeXml(lane.label)}</text>
        </g>
      `
    })
    .join('')

  const referenceImages = bottomLabel
    ? panel.analysis.laneResults
        .map((lane, index) => {
          const laneX = cropStartX + index * (cropLaneWidth + 10)
          return `
            <g opacity="${lane.enabled ? '1' : '0.34'}">
              ${
                lane.referenceCropUrl
                  ? `<image x="${laneX}" y="${innerY + 132}" width="${cropLaneWidth}" height="${referenceHeight}" href="${lane.referenceCropUrl}" preserveAspectRatio="none" />`
                  : `<rect x="${laneX}" y="${innerY + 132}" width="${cropLaneWidth}" height="${referenceHeight}" rx="8" fill="#ede4d7" stroke="#d8cec1" stroke-width="1" />`
              }
              <text x="${laneX + cropLaneWidth / 2}" y="${innerY + 201}" text-anchor="middle" font-size="10.5" fill="#6d6257" font-family="Aptos, Segoe UI, sans-serif">${escapeXml(lane.group)}</text>
            </g>
          `
        })
        .join('')
    : ''

  const statTag = panel.analysis.statistics.enabled
    ? `${panel.analysis.statistics.method} p-values`
    : 'statistics off'

  return `
    <g>
      <rect x="${x}" y="${y}" width="${width}" height="${height}" rx="26" fill="#fffaf2" stroke="#d8cec1" stroke-width="1.8" />
      <text x="${innerX}" y="${titleY}" font-size="28" fill="#a24d29" font-family="Georgia, Times New Roman, serif">${letter}</text>
      <text x="${innerX + 34}" y="${titleY}" font-size="18" fill="#211b14" font-family="Georgia, Times New Roman, serif">${escapeXml(panel.panelName)}</text>
      <text x="${innerX + innerWidth}" y="${titleY}" text-anchor="end" font-size="12" fill="#7a6a58" font-family="Aptos, Segoe UI, sans-serif">${escapeXml(modeLabel(panel.mode))}</text>

      <text x="${innerX}" y="${innerY + 56}" font-size="11.5" fill="#8e6c46" font-family="Aptos, Segoe UI, sans-serif">${topLabel}</text>
      ${targetImages}
      ${
        bottomLabel
          ? `<text x="${innerX}" y="${innerY + 145}" font-size="11.5" fill="#8e6c46" font-family="Aptos, Segoe UI, sans-serif">${bottomLabel}</text>${referenceImages}`
          : ''
      }

      ${chartFrame}

      <g>
        <rect x="${innerX}" y="${y + height - 52}" width="${innerWidth}" height="30" rx="15" fill="#f3ece0" />
        <text x="${innerX + 14}" y="${y + height - 32}" font-size="11.5" fill="#5a4d40" font-family="Aptos, Segoe UI, sans-serif">${escapeXml(statTag)}</text>
        <text x="${innerX + innerWidth - 14}" y="${y + height - 32}" text-anchor="end" font-size="11.5" fill="#5a4d40" font-family="Aptos, Segoe UI, sans-serif">warnings ${warningLines.length}</text>
      </g>
      ${warningLines
        .map(
          (warning, index) => `
            <text x="${innerX}" y="${y + height - 64 - (warningLines.length - index) * 14}" font-size="10.5" fill="#8c3a1a" font-family="Aptos, Segoe UI, sans-serif">${escapeXml(warning)}</text>
          `,
        )
        .join('')}
    </g>
  `
}

function renderChart({
  analysis,
  mode,
  x,
  y,
  width,
  height,
}: {
  analysis: AnalysisResult
  mode: AnalysisMode
  x: number
  y: number
  width: number
  height: number
}) {
  const leftPad = 72
  const rightPad = 20
  const bottomPad = 54
  const plotBottom = y + height - bottomPad
  const visibleComparisons = analysis.statistics.comparisons.filter((comparison) => comparison.stars)
  const annotations = layoutComparisons(analysis.statistics.comparisons, analysis.groupSummaries)
  const maxLevel = annotations.length ? Math.max(...annotations.map((annotation) => annotation.level)) : -1
  const plotTop = y + 30 + Math.max(0, maxLevel + 1) * 18
  const groupCount = Math.max(analysis.groupSummaries.length, 1)
  const plotWidth = width - leftPad - rightPad
  const slotWidth = plotWidth / groupCount
  const barWidth = Math.min(82, slotWidth * 0.56)
  const maxValue = Math.max(
    ...analysis.groupSummaries.map((summary) => summary.mean + summary.sem),
    1,
  )

  const ticks = Array.from({ length: 5 }, (_, index) => {
    const value = (maxValue / 4) * index
    const tickY = chartY(value, maxValue, plotTop, plotBottom)
    return `
      <line x1="${x + leftPad}" y1="${tickY}" x2="${x + width - rightPad}" y2="${tickY}" stroke="#d8cdbc" stroke-width="1" />
      <text x="${x + leftPad - 10}" y="${tickY + 4}" text-anchor="end" font-size="11" fill="#6d6257" font-family="Aptos, Segoe UI, sans-serif">${value.toFixed(1)}</text>
    `
  }).join('')

  const bars = analysis.groupSummaries
    .map((summary, index) => {
      const center = x + leftPad + slotWidth * index + slotWidth / 2
      const barX = center - barWidth / 2
      const barY = chartY(summary.mean, maxValue, plotTop, plotBottom)
      const errorTop = chartY(summary.mean + summary.sem, maxValue, plotTop, plotBottom)
      const errorBottom = chartY(Math.max(summary.mean - summary.sem, 0), maxValue, plotTop, plotBottom)
      const dots = summary.values
        .map((value, valueIndex) => {
          const offsetCount = summary.values.length - 1
          const step = offsetCount > 0 ? Math.min(16, barWidth / Math.max(offsetCount, 1)) : 0
          const cx = center - (offsetCount * step) / 2 + valueIndex * step
          return `<circle cx="${cx}" cy="${chartY(value, maxValue, plotTop, plotBottom)}" r="4" fill="#fffdf8" stroke="#1f1a13" stroke-width="1.4" />`
        })
        .join('')
      const fill = index % 2 === 0 ? '#b9552f' : '#2d6b78'

      return `
        <g>
          <rect x="${barX}" y="${barY}" width="${barWidth}" height="${plotBottom - barY}" rx="11" fill="${fill}" />
          <line x1="${center}" y1="${errorTop}" x2="${center}" y2="${errorBottom}" stroke="#1f1a13" stroke-width="1.9" />
          <line x1="${center - 12}" y1="${errorTop}" x2="${center + 12}" y2="${errorTop}" stroke="#1f1a13" stroke-width="1.9" />
          <line x1="${center - 12}" y1="${errorBottom}" x2="${center + 12}" y2="${errorBottom}" stroke="#1f1a13" stroke-width="1.9" />
          ${dots}
          <text x="${center}" y="${plotBottom + 25}" text-anchor="middle" font-size="11.5" fill="#342c22" font-family="Aptos, Segoe UI, sans-serif">${escapeXml(summary.group)}</text>
          <text x="${center}" y="${plotBottom + 41}" text-anchor="middle" font-size="10.5" fill="#786b57" font-family="Aptos, Segoe UI, sans-serif">n=${summary.values.length}</text>
        </g>
      `
    })
    .join('')

  const comparisonLines = annotations
    .filter((annotation) => annotation.comparison.stars)
    .map((annotation) => {
      const left = x + leftPad + slotWidth * annotation.leftIndex + slotWidth / 2
      const right = x + leftPad + slotWidth * annotation.rightIndex + slotWidth / 2
      const top = plotTop - 12 - annotation.level * 16
      const hookBottom = top + 8
      return `
        <g>
          <line x1="${left}" y1="${hookBottom}" x2="${left}" y2="${top}" stroke="#1f1a13" stroke-width="1.6" />
          <line x1="${left}" y1="${top}" x2="${right}" y2="${top}" stroke="#1f1a13" stroke-width="1.6" />
          <line x1="${right}" y1="${hookBottom}" x2="${right}" y2="${top}" stroke="#1f1a13" stroke-width="1.6" />
          <text x="${(left + right) / 2}" y="${top - 5}" text-anchor="middle" font-size="12" fill="#1f1a13" font-family="Aptos, Segoe UI, sans-serif">${escapeXml(annotation.comparison.stars)}</text>
        </g>
      `
    })
    .join('')

  const statFootnote = analysis.statistics.enabled
    ? `${visibleComparisons.length} comparison${visibleComparisons.length === 1 ? '' : 's'}, ${analysis.statistics.correction}`
    : 'statistics disabled'

  return `
    <g>
      <text x="${x}" y="${y + 12}" font-size="12" fill="#8e6c46" font-family="Aptos, Segoe UI, sans-serif">Group summary</text>
      <line x1="${x + leftPad}" y1="${plotTop}" x2="${x + leftPad}" y2="${plotBottom}" stroke="#3f352a" stroke-width="2" />
      <line x1="${x + leftPad}" y1="${plotBottom}" x2="${x + width - rightPad}" y2="${plotBottom}" stroke="#3f352a" stroke-width="2" />
      ${ticks}
      ${bars}
      ${comparisonLines}
      <text x="${x + 12}" y="${y + 92}" transform="rotate(-90 ${x + 12} ${y + 92})" font-size="12" fill="#342c22" font-family="Aptos, Segoe UI, sans-serif">${mode === 'gel' ? 'Corrected density' : 'Normalized intensity'}</text>
      <text x="${x + width - rightPad}" y="${y + height - 8}" text-anchor="end" font-size="10.5" fill="#786b57" font-family="Aptos, Segoe UI, sans-serif">${escapeXml(statFootnote)}</text>
    </g>
  `
}

function layoutComparisons(
  comparisons: StatisticalComparison[],
  groupSummaries: AnalysisResult['groupSummaries'],
) {
  const groupIndex = new Map(groupSummaries.map((summary, index) => [summary.group, index]))
  const lines: Array<{
    comparison: StatisticalComparison
    leftIndex: number
    rightIndex: number
    level: number
  }> = []
  const occupied: Array<Array<{ left: number; right: number }>> = []

  const sorted = comparisons
    .filter((comparison) => groupIndex.has(comparison.groupA) && groupIndex.has(comparison.groupB))
    .map((comparison) => {
      const leftIndex = Math.min(groupIndex.get(comparison.groupA) ?? 0, groupIndex.get(comparison.groupB) ?? 0)
      const rightIndex = Math.max(groupIndex.get(comparison.groupA) ?? 0, groupIndex.get(comparison.groupB) ?? 0)
      return { comparison, leftIndex, rightIndex }
    })
    .sort((left, right) => left.rightIndex - left.leftIndex - (right.rightIndex - right.leftIndex))

  sorted.forEach((entry) => {
    let level = 0
    while (occupied[level]?.some((existing) => !(entry.rightIndex < existing.left || entry.leftIndex > existing.right))) {
      level += 1
    }
    occupied[level] ??= []
    occupied[level].push({ left: entry.leftIndex, right: entry.rightIndex })
    lines.push({ ...entry, level })
  })

  return lines
}

function estimatePanelHeight(mode: AnalysisMode) {
  return mode === 'gel' ? 428 : 514
}

function chartY(value: number, max: number, plotTop: number, plotBottom: number) {
  return plotBottom - (Math.min(value, max) / max) * (plotBottom - plotTop)
}

function chunkPanels(panels: FigurePanel[], columns: number) {
  const chunks: FigurePanel[][] = []
  for (let index = 0; index < panels.length; index += columns) {
    chunks.push(panels.slice(index, index + columns))
  }
  return chunks
}

function escapeCsv(value: string) {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

function escapeXml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

function modeLabel(mode: AnalysisMode) {
  if (mode === 'dot') {
    return 'Dot blot'
  }
  if (mode === 'gel') {
    return 'Gel band'
  }
  return 'Western blot'
}
