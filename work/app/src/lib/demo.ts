import { defaultSettings, readFileAsDataUrl, syncLaneConfigs } from './analysis'
import type { AnalysisSettings } from './analysis'
import type { LaneConfig, PanelAsset } from '../types'

export async function createDemoPanel(): Promise<{
  panel: PanelAsset
  settings: AnalysisSettings
  lanes: LaneConfig[]
}> {
  const canvas = document.createElement('canvas')
  canvas.width = 1800
  canvas.height = 980
  const context = canvas.getContext('2d')

  if (!context) {
    throw new Error('Canvas 2D context is unavailable for the demo panel.')
  }

  const gradient = context.createLinearGradient(0, 0, canvas.width, canvas.height)
  gradient.addColorStop(0, '#d7d1ca')
  gradient.addColorStop(1, '#bbb2a9')
  context.fillStyle = gradient
  context.fillRect(0, 0, canvas.width, canvas.height)

  context.fillStyle = 'rgba(255,255,255,0.22)'
  for (let index = 0; index < 400; index += 1) {
    const x = Math.random() * canvas.width
    const y = Math.random() * canvas.height
    const radius = Math.random() * 2.2
    context.beginPath()
    context.arc(x, y, radius, 0, Math.PI * 2)
    context.fill()
  }

  const blotX = 160
  const blotY = 110
  const blotWidth = 1480
  const blotHeight = 760
  context.fillStyle = '#f2eee8'
  context.fillRect(blotX, blotY, blotWidth, blotHeight)

  const laneCount = 6
  const laneWidth = 176
  const laneGap = 42
  const targetY = 292
  const controlY = 588

  for (let lane = 0; lane < laneCount; lane += 1) {
    const x = blotX + 82 + lane * (laneWidth + laneGap)
    const targetAlpha = lane < 3 ? 0.52 + lane * 0.03 : 0.86 - lane * 0.04
    const controlAlpha = 0.66 + (lane % 2) * 0.04

    drawBand(context, x, targetY, laneWidth, 44, targetAlpha)
    drawBand(context, x, controlY, laneWidth, 38, controlAlpha)

    if (lane === 4) {
      drawBand(context, x + 6, targetY + 3, laneWidth - 10, 18, 0.18)
    }
  }

  context.fillStyle = 'rgba(32, 27, 22, 0.16)'
  context.fillRect(154, 98, 1494, 4)
  context.fillRect(154, 872, 1494, 4)

  const file = await canvasToFile(canvas, 'demo-wb-panel.png')
  const dataUrl = await readFileAsDataUrl(file)
  const settings: AnalysisSettings = {
    ...defaultSettings,
    laneCount,
    laneInset: 0.11,
    laneGap: 0.024,
    primaryY: 0.298,
    referenceY: 0.604,
    bandHeight: 0.095,
    backgroundOffset: 0.04,
    backgroundHeight: 0.058,
    contrast: 1.24,
    brightness: 6,
    invert: false,
    mode: 'western',
  }
  const lanes = syncLaneConfigs([], laneCount, [
    'Vehicle',
    'Vehicle',
    'Vehicle',
    'Drug-X',
    'Drug-X',
    'Drug-X',
  ]).map((lane, index) => ({
    ...lane,
    label: `Rep ${index + 1}`,
  }))

  return {
    panel: {
      id: crypto.randomUUID(),
      name: file.name,
      url: dataUrl,
      dataUrl,
      mimeType: 'image/png',
      bitDepth: 8,
      source: 'demo',
    },
    settings,
    lanes,
  }
}

async function canvasToFile(canvas: HTMLCanvasElement, name: string) {
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((next) => {
      if (next) {
        resolve(next)
        return
      }
      reject(new Error('Unable to serialize the demo image.'))
    }, 'image/png')
  })

  return new File([blob], name, { type: 'image/png' })
}

function drawBand(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  alpha: number,
) {
  const band = context.createRadialGradient(
    x + width / 2,
    y + height / 2,
    width * 0.05,
    x + width / 2,
    y + height / 2,
    width * 0.7,
  )
  band.addColorStop(0, `rgba(24, 18, 16, ${alpha})`)
  band.addColorStop(0.55, `rgba(44, 35, 29, ${alpha * 0.9})`)
  band.addColorStop(1, 'rgba(58, 45, 39, 0)')

  context.fillStyle = band
  context.beginPath()
  roundRect(context, x, y, width, height, height / 2)
  context.fill()
}

function roundRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  context.moveTo(x + radius, y)
  context.lineTo(x + width - radius, y)
  context.quadraticCurveTo(x + width, y, x + width, y + radius)
  context.lineTo(x + width, y + height - radius)
  context.quadraticCurveTo(x + width, y + height, x + width - radius, y + height)
  context.lineTo(x + radius, y + height)
  context.quadraticCurveTo(x, y + height, x, y + height - radius)
  context.lineTo(x, y + radius)
  context.quadraticCurveTo(x, y, x + radius, y)
}
