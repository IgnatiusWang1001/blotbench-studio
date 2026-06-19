import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  ChangeEvent,
  CSSProperties,
  DragEvent as ReactDragEvent,
  KeyboardEvent,
  MouseEvent as ReactMouseEvent,
} from 'react'
import './App.css'
import {
  applyRegionDelta,
  buildDefaultDrafts,
  buildLaneGeometries,
  createAnalysis,
  defaultSettings,
  draftLaneLayout,
  readFileAsDataUrl,
  resizeRegionFromHandle,
  resizeSelectedRegion,
  syncLaneConfigs,
  type AnalysisResult,
  type AnalysisSettings,
} from './lib/analysis'
import {
  buildFigureBoardDocument,
  buildFigureDocument,
  downloadBlob,
  exportFigurePdf,
  serializeCsv,
  type FigureDocument,
} from './lib/export'
import { createDemoPanel } from './lib/demo'
import {
  clearAutosave,
  createProjectSnapshot,
  loadAutosave,
  parseProjectSnapshot,
  saveAutosave,
} from './lib/project'
import { defaultStatisticalSettings } from './lib/statistics'
import { decodeTiff } from './lib/tiff'
import type {
  AnalysisMode,
  FigureBoardSettings,
  LaneConfig,
  LaneDraft,
  PanelAsset,
  Rect,
  ResizeHandle,
  SelectedRegion,
  StatisticalSettings,
} from './types'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

function App() {
  const restoredProject = loadAutosave()
  const restoredPanels = restoredProject?.panels ?? []
  const restoredSettingsByPanelId =
    restoredProject?.settingsByPanelId &&
    Object.keys(restoredProject.settingsByPanelId).length
      ? restoredProject.settingsByPanelId
      : Object.fromEntries(
          restoredPanels.map((panel) => [panel.id, restoredProject?.settings ?? defaultSettings]),
        )
  const restoredStatisticalSettingsByPanelId =
    restoredProject?.statisticalSettingsByPanelId &&
    Object.keys(restoredProject.statisticalSettingsByPanelId).length
      ? restoredProject.statisticalSettingsByPanelId
      : Object.fromEntries(
          restoredPanels.map((panel) => [
            panel.id,
            restoredProject?.statisticalSettings ?? defaultStatisticalSettings,
          ]),
        )
  const restoredLanesByPanelId =
    restoredProject?.lanesByPanelId && Object.keys(restoredProject.lanesByPanelId).length
      ? restoredProject.lanesByPanelId
      : Object.fromEntries(
          restoredPanels.map((panel) => [
            panel.id,
            restoredProject?.lanes ??
              syncLaneConfigs([], (restoredProject?.settings ?? defaultSettings).laneCount),
          ]),
        )
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const projectInputRef = useRef<HTMLInputElement | null>(null)
  const restoredBoardSettings: FigureBoardSettings = restoredProject?.figureBoardSettings ?? {
    title: 'Composed blot figure',
    columns: 1,
    selectedPanelIds: restoredProject?.activePanelId ? [restoredProject.activePanelId] : [],
  }
  const [panels, setPanels] = useState<PanelAsset[]>(restoredPanels)
  const [activePanelId, setActivePanelId] = useState<string | null>(
    restoredProject?.activePanelId ?? null,
  )
  const [figureBoardSettings, setFigureBoardSettings] = useState<FigureBoardSettings>(
    restoredBoardSettings,
  )
  const [settingsByPanelId, setSettingsByPanelId] = useState<Record<string, AnalysisSettings>>(
    restoredSettingsByPanelId,
  )
  const [statisticalSettingsByPanelId, setStatisticalSettingsByPanelId] = useState<
    Record<string, StatisticalSettings>
  >(
    restoredStatisticalSettingsByPanelId,
  )
  const [lanesByPanelId, setLanesByPanelId] = useState<Record<string, LaneConfig[]>>(
    restoredLanesByPanelId,
  )
  const [draftsByPanelId, setDraftsByPanelId] = useState<Record<string, LaneDraft[]>>(
    restoredProject?.draftsByPanelId ?? {},
  )
  const [analysisByPanelId, setAnalysisByPanelId] = useState<Record<string, AnalysisResult>>({})
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [isDrafting, setIsDrafting] = useState(false)
  const [analysisError, setAnalysisError] = useState<string | null>(null)
  const [selectedRegion, setSelectedRegion] = useState<SelectedRegion | null>(null)
  const [workspaceWarnings, setWorkspaceWarnings] = useState<string[]>([])
  const [dragState, setDragState] = useState<{
    startX: number
    startY: number
    region: SelectedRegion
    resizeHandle?: ResizeHandle
  } | null>(null)
  const [showAutosaveBanner, setShowAutosaveBanner] = useState(Boolean(restoredProject))
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [installState, setInstallState] = useState<'ready' | 'installed' | 'unavailable'>(
    window.matchMedia('(display-mode: standalone)').matches ? 'installed' : 'unavailable',
  )
  const [isOffline, setIsOffline] = useState(!navigator.onLine)
  const [isDragActive, setIsDragActive] = useState(false)

  const activePanel = useMemo(
    () => panels.find((panel) => panel.id === activePanelId) ?? null,
    [activePanelId, panels],
  )
  const settings = activePanelId ? settingsByPanelId[activePanelId] ?? defaultSettings : defaultSettings
  const statisticalSettings = activePanelId
    ? statisticalSettingsByPanelId[activePanelId] ?? defaultStatisticalSettings
    : defaultStatisticalSettings
  const lanes = activePanelId
    ? lanesByPanelId[activePanelId] ?? syncLaneConfigs([], settings.laneCount)
    : syncLaneConfigs([], defaultSettings.laneCount)
  const activeAnalysis = activePanelId ? analysisByPanelId[activePanelId] ?? null : null
  const activeDrafts = activePanelId ? draftsByPanelId[activePanelId] ?? [] : []
  const selectedPanels = useMemo(
    () => panels.filter((panel) => figureBoardSettings.selectedPanelIds.includes(panel.id)),
    [figureBoardSettings.selectedPanelIds, panels],
  )
  const selectedFigurePanels = useMemo(
    () =>
      selectedPanels
        .map((panel) => {
          const analysis = analysisByPanelId[panel.id]
          if (!analysis) {
            return null
          }
          return {
            id: panel.id,
            panelName: panel.name,
            analysis,
            mode: settingsByPanelId[panel.id]?.mode ?? defaultSettings.mode,
          }
        })
        .filter((panel): panel is NonNullable<typeof panel> => Boolean(panel)),
    [analysisByPanelId, selectedPanels, settingsByPanelId],
  )
  const boardPreview = useMemo(
    () =>
      buildFigureBoardDocument({
        panels: selectedFigurePanels,
        boardSettings: figureBoardSettings,
      }),
    [figureBoardSettings, selectedFigurePanels],
  )

  useEffect(() => {
    if (!activePanel) {
      return
    }

    const drafts = draftsByPanelId[activePanel.id]
    if (!drafts?.length) {
      return
    }

    let cancelled = false
    const panel = activePanel

    async function runAnalysis() {
      setIsAnalyzing(true)
      setAnalysisError(null)

      try {
        const next = await createAnalysis(panel, settings, lanes, drafts, statisticalSettings)
        if (!cancelled) {
          setAnalysisByPanelId((current) => ({
            ...current,
            [panel.id]: next,
          }))
          setWorkspaceWarnings(next.warnings)
        }
      } catch (error) {
        if (!cancelled) {
          setAnalysisByPanelId((current) => {
            const next = { ...current }
            delete next[panel.id]
            return next
          })
          setAnalysisError(
            error instanceof Error ? error.message : 'Failed to analyze image.',
          )
        }
      } finally {
        if (!cancelled) {
          setIsAnalyzing(false)
        }
      }
    }

    void runAnalysis()

    return () => {
      cancelled = true
    }
  }, [activePanel, draftsByPanelId, lanes, settings, statisticalSettings])

  useEffect(() => {
    if (!panels.length) {
      clearAutosave()
      return
    }

    const snapshot = createProjectSnapshot({
      activePanelId,
      panels,
      figureBoardSettings,
      settingsByPanelId,
      statisticalSettingsByPanelId,
      lanesByPanelId,
      draftsByPanelId,
      analysisSummary: activeAnalysis?.laneResults ?? null,
    })
    saveAutosave(snapshot)
  }, [
    activeAnalysis,
    activePanelId,
    draftsByPanelId,
    figureBoardSettings,
    lanesByPanelId,
    panels,
    settingsByPanelId,
    statisticalSettingsByPanelId,
  ])

  useEffect(() => {
    return () => {
      panels.forEach((panel) => {
        if (panel.source === 'upload' || panel.source === 'demo') {
          URL.revokeObjectURL(panel.url)
        }
      })
    }
  }, [panels])

  useEffect(() => {
    function handleBeforeInstallPrompt(event: Event) {
      event.preventDefault()
      setInstallPrompt(event as BeforeInstallPromptEvent)
      setInstallState('ready')
    }

    function handleInstalled() {
      setInstallPrompt(null)
      setInstallState('installed')
    }

    function handleOnlineStatusChange() {
      setIsOffline(!navigator.onLine)
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
    window.addEventListener('appinstalled', handleInstalled)
    window.addEventListener('online', handleOnlineStatusChange)
    window.addEventListener('offline', handleOnlineStatusChange)

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
      window.removeEventListener('appinstalled', handleInstalled)
      window.removeEventListener('online', handleOnlineStatusChange)
      window.removeEventListener('offline', handleOnlineStatusChange)
    }
  }, [])

  const activeGeometries =
    activePanel && activeDrafts.length
      ? buildLaneGeometries({
          width: activeAnalysis?.width ?? 1000,
          height: activeAnalysis?.height ?? 620,
          settings,
          drafts: activeDrafts,
        })
      : buildLaneGeometries({
          width: 1000,
          height: 620,
          settings,
          drafts: buildDefaultDrafts({ width: 1000, height: 620, settings }),
        })

  function updateSettings<K extends keyof AnalysisSettings>(
    key: K,
    value: AnalysisSettings[K],
  ) {
    if (!activePanelId) {
      return
    }
    setSettingsByPanelId((current) => ({
      ...current,
      [activePanelId]: { ...(current[activePanelId] ?? settings), [key]: value },
    }))
  }

  function updateStatisticalSettings<K extends keyof StatisticalSettings>(
    key: K,
    value: StatisticalSettings[K],
  ) {
    if (!activePanelId) {
      return
    }
    setStatisticalSettingsByPanelId((current) => ({
      ...current,
      [activePanelId]: {
        ...(current[activePanelId] ?? statisticalSettings),
        [key]: value,
      },
    }))
  }

  function updateFigureBoardSettings<K extends keyof FigureBoardSettings>(
    key: K,
    value: FigureBoardSettings[K],
  ) {
    setFigureBoardSettings((current) => ({ ...current, [key]: value }))
  }

  function updateLane(index: number, field: keyof LaneConfig, value: string | boolean) {
    if (!activePanelId) {
      return
    }
    setLanesByPanelId((current) => ({
      ...current,
      [activePanelId]: (current[activePanelId] ?? lanes).map((lane, laneIndex) =>
        laneIndex === index ? { ...lane, [field]: value } : lane,
      ),
    }))
  }

  async function ingestPanels(files: File[]) {
    const nextPanels = await Promise.all(
      files.map(async (file) => {
        const lowerName = file.name.toLowerCase()
        const isTiff = lowerName.endsWith('.tif') || lowerName.endsWith('.tiff')
        const dataUrl = await readFileAsDataUrl(file)
        const decodedGray = isTiff ? await decodeTiff(file) : undefined

        return {
          id: crypto.randomUUID(),
          name: file.name,
          url: dataUrl,
          dataUrl,
          mimeType: file.type || (isTiff ? 'image/tiff' : 'image/png'),
          bitDepth: decodedGray?.bitDepth ?? 8,
          decodedGray,
          source: 'upload' as const,
        }
      }),
    )

    setPanels((current) => [...nextPanels, ...current])
    setSettingsByPanelId((current) => ({
      ...current,
      ...Object.fromEntries(nextPanels.map((panel) => [panel.id, { ...defaultSettings }])),
    }))
    setStatisticalSettingsByPanelId((current) => ({
      ...current,
      ...Object.fromEntries(
        nextPanels.map((panel) => [panel.id, { ...defaultStatisticalSettings }]),
      ),
    }))
    setLanesByPanelId((current) => ({
      ...current,
      ...Object.fromEntries(
        nextPanels.map((panel) => [panel.id, syncLaneConfigs([], defaultSettings.laneCount)]),
      ),
    }))
    setActivePanelId((current) => current ?? nextPanels[0]?.id ?? null)
    setFigureBoardSettings((current) => ({
      ...current,
      selectedPanelIds: dedupeIds([...current.selectedPanelIds, ...nextPanels.map((panel) => panel.id)]),
    }))
    await Promise.all(nextPanels.map((panel) => generateDraftsForPanel(panel, defaultSettings)))
  }

  async function handleFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? [])
    if (!files.length) {
      return
    }

    await ingestPanels(files)
    event.target.value = ''
  }

  async function handleInstallApp() {
    if (!installPrompt) {
      return
    }

    await installPrompt.prompt()
    const result = await installPrompt.userChoice
    if (result.outcome === 'accepted') {
      setInstallState('installed')
      setInstallPrompt(null)
      return
    }

    setInstallState('unavailable')
  }

  async function handleLoadDemo() {
    const demo = await createDemoPanel()
    setPanels((current) => [demo.panel, ...current])
    setActivePanelId(demo.panel.id)
    setSettingsByPanelId((current) => ({ ...current, [demo.panel.id]: demo.settings }))
    setStatisticalSettingsByPanelId((current) => ({
      ...current,
      [demo.panel.id]: { ...defaultStatisticalSettings, baselineGroup: 'Vehicle' },
    }))
    setLanesByPanelId((current) => ({ ...current, [demo.panel.id]: demo.lanes }))
    setFigureBoardSettings((current) => ({
      ...current,
      selectedPanelIds: dedupeIds([demo.panel.id, ...current.selectedPanelIds]),
    }))
    await generateDraftsForPanel(demo.panel, demo.settings)
  }

  async function generateDraftsForPanel(panel: PanelAsset, nextSettings: AnalysisSettings) {
    setIsDrafting(true)
    try {
      const drafted = await draftLaneLayout(panel, nextSettings)
      setDraftsByPanelId((current) => ({
        ...current,
        [panel.id]: drafted.drafts,
      }))
      setWorkspaceWarnings((current) => dedupe([...drafted.warnings, ...current]))
    } catch (error) {
      setAnalysisError(
        error instanceof Error ? error.message : 'Unable to draft lane layout.',
      )
    } finally {
      setIsDrafting(false)
    }
  }

  function handleRemovePanel(panelId: string) {
    const match = panels.find((panel) => panel.id === panelId)
    if (match && (match.source === 'upload' || match.source === 'demo')) {
      URL.revokeObjectURL(match.url)
    }

    const remaining = panels.filter((panel) => panel.id !== panelId)
    setPanels(remaining)
    setDraftsByPanelId((current) => {
      const next = { ...current }
      delete next[panelId]
      return next
    })
    setSettingsByPanelId((current) => {
      const next = { ...current }
      delete next[panelId]
      return next
    })
    setStatisticalSettingsByPanelId((current) => {
      const next = { ...current }
      delete next[panelId]
      return next
    })
    setLanesByPanelId((current) => {
      const next = { ...current }
      delete next[panelId]
      return next
    })
    setAnalysisByPanelId((current) => {
      const next = { ...current }
      delete next[panelId]
      return next
    })
    setFigureBoardSettings((current) => ({
      ...current,
      selectedPanelIds: normalizeSelectedPanelIds(
        current.selectedPanelIds.filter((id) => id !== panelId),
        remaining.map((panel) => panel.id),
        remaining[0]?.id ?? null,
      ),
    }))
    if (panelId === activePanelId) {
      setActivePanelId(remaining[0]?.id ?? null)
      setSelectedRegion(null)
    }
    if (!remaining.length) {
      setAnalysisError(null)
      setWorkspaceWarnings([])
    }
  }

  function handleExportSvg() {
    if (!selectedFigurePanels.length) {
      return
    }

    const figure =
      selectedFigurePanels.length === 1
        ? buildFigureDocument({
            analysis: selectedFigurePanels[0].analysis,
            panelName: selectedFigurePanels[0].panelName,
            mode: selectedFigurePanels[0].mode,
          })
        : boardPreview
    downloadBlob(
      new Blob([figure.svg], { type: 'image/svg+xml;charset=utf-8' }),
      `${slugify(figureBoardSettings.title || 'blotbench-board')}.svg`,
    )
  }

  async function handleExportPdf() {
    if (!selectedFigurePanels.length) {
      return
    }

    const figure =
      selectedFigurePanels.length === 1
        ? buildFigureDocument({
            analysis: selectedFigurePanels[0].analysis,
            panelName: selectedFigurePanels[0].panelName,
            mode: selectedFigurePanels[0].mode,
          })
        : boardPreview
    await exportFigurePdf(figure, `${slugify(figureBoardSettings.title || 'blotbench-board')}.pdf`)
  }

  function handleExportCsv() {
    if (!activeAnalysis || !activePanel) {
      return
    }

    const csv = serializeCsv(activeAnalysis.laneResults)
    downloadBlob(
      new Blob([csv], { type: 'text/csv;charset=utf-8' }),
      `${slugify(activePanel.name)}-quant.csv`,
    )
  }

  function handleExportProject() {
    const snapshot = createProjectSnapshot({
      activePanelId,
      panels,
      figureBoardSettings,
      settingsByPanelId,
      statisticalSettingsByPanelId,
      lanesByPanelId,
      draftsByPanelId,
      analysisSummary: activeAnalysis?.laneResults ?? null,
    })

    const blob = new Blob([JSON.stringify(snapshot, null, 2)], {
      type: 'application/json;charset=utf-8',
    })
    downloadBlob(blob, 'blotbench-project.json')
  }

  async function handleProjectImport(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) {
      return
    }

    const text = await file.text()
    const snapshot = parseProjectSnapshot(text)
    setPanels(snapshot.panels)
    setActivePanelId(snapshot.activePanelId)
    setSettingsByPanelId(
      snapshot.settingsByPanelId && Object.keys(snapshot.settingsByPanelId).length
        ? snapshot.settingsByPanelId
        : Object.fromEntries(
            snapshot.panels.map((panel) => [panel.id, snapshot.settings ?? defaultSettings]),
          ),
    )
    setStatisticalSettingsByPanelId(
      snapshot.statisticalSettingsByPanelId &&
        Object.keys(snapshot.statisticalSettingsByPanelId).length
        ? snapshot.statisticalSettingsByPanelId
        : Object.fromEntries(
            snapshot.panels.map((panel) => [
              panel.id,
              snapshot.statisticalSettings ?? defaultStatisticalSettings,
            ]),
          ),
    )
    setLanesByPanelId(
      snapshot.lanesByPanelId && Object.keys(snapshot.lanesByPanelId).length
        ? snapshot.lanesByPanelId
        : Object.fromEntries(
            snapshot.panels.map((panel) => [
              panel.id,
              snapshot.lanes ??
                syncLaneConfigs([], (snapshot.settings ?? defaultSettings).laneCount),
            ]),
          ),
    )
    setDraftsByPanelId(snapshot.draftsByPanelId)
    setFigureBoardSettings(
      normalizeBoardSettings(
        snapshot.figureBoardSettings ?? {
          title: 'Composed blot figure',
          columns: 1,
          selectedPanelIds: snapshot.activePanelId ? [snapshot.activePanelId] : [],
        },
        snapshot.panels.map((panel) => panel.id),
        snapshot.activePanelId,
      ),
    )
    setWorkspaceWarnings([])
    setAnalysisByPanelId({})
    setShowAutosaveBanner(false)
    event.target.value = ''
  }

  function handleSelectRegion(region: SelectedRegion) {
    setSelectedRegion(region)
  }

  function handleOverlayMouseDown(
    event: ReactMouseEvent<HTMLButtonElement>,
    region: SelectedRegion,
    resizeHandle?: ResizeHandle,
  ) {
    setSelectedRegion(region)
    setDragState({
      startX: event.clientX,
      startY: event.clientY,
      region,
      resizeHandle,
    })
  }

  function handleOverlayMouseUp(event: ReactMouseEvent<HTMLDivElement>) {
    if (!dragState || !activePanelId) {
      return
    }
    event.preventDefault()

    const scaleX = (activeAnalysis?.width ?? 1000) / event.currentTarget.clientWidth
    const scaleY = (activeAnalysis?.height ?? 620) / event.currentTarget.clientHeight
    const deltaX = (event.clientX - dragState.startX) * scaleX
    const deltaY = (event.clientY - dragState.startY) * scaleY
    const bounds = {
      x: 0,
      y: 0,
      width: activeAnalysis?.width ?? 1000,
      height: activeAnalysis?.height ?? 620,
    }

    setDraftsByPanelId((current) => ({
      ...current,
      [activePanelId]: current[activePanelId].map((draft) =>
        draft.id === dragState.region.laneId
          ? dragState.resizeHandle
            ? resizeRegionFromHandle(
                draft,
                dragState.region,
                dragState.resizeHandle,
                deltaX,
                deltaY,
                bounds,
              )
            : applyRegionDelta(draft, dragState.region, deltaX, deltaY, bounds)
          : draft,
      ),
    }))
    setDragState(null)
  }

  function handleWorkbenchKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!selectedRegion || !activePanelId) {
      return
    }

    const bounds = {
      x: 0,
      y: 0,
      width: activeAnalysis?.width ?? 1000,
      height: activeAnalysis?.height ?? 620,
    }

    if (event.key === '[' || event.key === ']') {
      const delta = event.key === '[' ? -6 : 6
      setDraftsByPanelId((current) => ({
        ...current,
        [activePanelId]: current[activePanelId].map((draft) =>
          draft.id === selectedRegion.laneId
            ? resizeSelectedRegion(draft, selectedRegion, delta, delta, bounds)
            : draft,
        ),
      }))
      return
    }

    const step = event.shiftKey ? 8 : 3
    const deltaMap: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    }

    if (!deltaMap[event.key]) {
      return
    }

    event.preventDefault()
    const [deltaX, deltaY] = deltaMap[event.key]
    setDraftsByPanelId((current) => ({
      ...current,
      [activePanelId]: current[activePanelId].map((draft) =>
        draft.id === selectedRegion.laneId
          ? applyRegionDelta(draft, selectedRegion, deltaX, deltaY, bounds)
          : draft,
      ),
    }))
  }

  function handleRedraftActivePanel() {
    if (!activePanel) {
      return
    }
    void generateDraftsForPanel(activePanel, settings)
  }

  function handleRestoreAutosaveDismiss() {
    setShowAutosaveBanner(false)
  }

  function handleDropzoneDragOver(event: ReactDragEvent<HTMLDivElement>) {
    event.preventDefault()
    if (!isDragActive) {
      setIsDragActive(true)
    }
  }

  function handleDropzoneDragLeave(event: ReactDragEvent<HTMLDivElement>) {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
      return
    }
    setIsDragActive(false)
  }

  async function handleDropzoneDrop(event: ReactDragEvent<HTMLDivElement>) {
    event.preventDefault()
    setIsDragActive(false)
    const files = Array.from(event.dataTransfer.files ?? [])
    if (!files.length) {
      return
    }
    await ingestPanels(files)
  }

  function togglePanelSelection(panelId: string) {
    setFigureBoardSettings((current) => {
      const selected = current.selectedPanelIds.includes(panelId)
      if (selected) {
        return {
          ...current,
          selectedPanelIds:
            current.selectedPanelIds.length > 1
              ? current.selectedPanelIds.filter((id) => id !== panelId)
              : current.selectedPanelIds,
        }
      }
      return {
        ...current,
        selectedPanelIds: [...current.selectedPanelIds, panelId],
      }
    })
  }

  return (
    <div className="shell">
      {showAutosaveBanner ? (
        <section className="panel autosave-banner">
          <strong>Recovered the last local session.</strong>
          <span>The current workspace was restored from browser autosave.</span>
          <button type="button" className="button ghost" onClick={handleRestoreAutosaveDismiss}>
            Dismiss
          </button>
        </section>
      ) : null}

      <header className="masthead panel">
        <div>
          <p className="eyebrow">BlotBench Studio</p>
          <h1>Western Blot / Dot Blot / Gel figure line, not four disconnected apps.</h1>
          <p className="lede">
            Upload raw exposures, auto-draft lanes, correct ROIs in place,
            quantify against a loading control, and leave with a figure board that
            already looks like it belongs in a paper.
          </p>
        </div>
        <div className="masthead-meta">
          <div className="meta-card">
            <span>Mode</span>
            <strong>{modeLabel(settings.mode)}</strong>
          </div>
          <div className="meta-card">
            <span>Panel set</span>
            <strong>{panels.length || 0}</strong>
          </div>
          <div className="meta-card">
            <span>Quant state</span>
            <strong>{activeAnalysis ? 'Live' : 'Idle'}</strong>
          </div>
          <div className="meta-card meta-card-install">
            <span>Install</span>
            <strong>
              {installState === 'installed'
                ? 'Desktop-ready'
                : installState === 'ready'
                  ? 'App install available'
                  : 'Browser mode'}
            </strong>
            <small>{isOffline ? 'Offline now' : 'Offline-ready cache active'}</small>
            <div className="button-row compact">
              <button
                type="button"
                className="button ghost"
                disabled={installState !== 'ready'}
                onClick={() => void handleInstallApp()}
              >
                Install app
              </button>
            </div>
          </div>
        </div>
      </header>

      <section className="workflow-strip panel">
        <article>
          <span>01</span>
          <h2>Acquire</h2>
          <p>Bring raw TIFF/JPG/PNG into a local-first workbench.</p>
        </article>
        <article>
          <span>02</span>
          <h2>Auto draft</h2>
          <p>Find the signal region, split lanes, and propose band rows with confidence scores.</p>
        </article>
        <article>
          <span>03</span>
          <h2>Correct</h2>
          <p>Fine-tune lane, target, and reference ROIs in the same surface that runs quantification.</p>
        </article>
        <article>
          <span>04</span>
          <h2>Compose</h2>
          <p>Export a board where labels, bands, chart, and warnings already agree.</p>
        </article>
      </section>

      <main className="grid">
        <section className="panel upload-panel">
          <div className="section-head">
            <div>
              <p className="eyebrow">Source panels</p>
              <h2>Image tray</h2>
            </div>
            <div className="button-row">
              <button type="button" className="button ghost" onClick={handleLoadDemo}>
                Load demo panel
              </button>
              <button
                type="button"
                className="button ghost"
                onClick={() => projectInputRef.current?.click()}
              >
                Open project
              </button>
              <button
                type="button"
                className="button solid"
                onClick={() => fileInputRef.current?.click()}
              >
                Add raw image
              </button>
            </div>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept=".tif,.tiff,.png,.jpg,.jpeg"
            multiple
            className="hidden-input"
            onChange={handleFiles}
          />
          <input
            ref={projectInputRef}
            type="file"
            accept=".json"
            className="hidden-input"
            onChange={handleProjectImport}
          />

          <div
            className={`dropzone ${isDragActive ? 'is-active' : ''}`}
            onDragOver={handleDropzoneDragOver}
            onDragLeave={handleDropzoneDragLeave}
            onDrop={(event) => void handleDropzoneDrop(event)}
          >
            <p>Drop assay images here, or load the demo to inspect the full workflow.</p>
            <small>No upload leaves the browser in this build. TIFF, JPG, and PNG stay local.</small>
          </div>

          <div className="thumb-list">
            {panels.length ? (
              panels.map((panel) => (
                <button
                  key={panel.id}
                  type="button"
                  className={`thumb ${panel.id === activePanelId ? 'is-active' : ''}`}
                  onClick={() => setActivePanelId(panel.id)}
                >
                  <img src={panel.url} alt={panel.name} />
                  <div className="thumb-copy">
                    <strong>{panel.name}</strong>
                    <span>
                      {panel.bitDepth}-bit {panel.source === 'demo' ? 'demo assay' : panel.source === 'project' ? 'recovered panel' : 'uploaded panel'}
                    </span>
                  </div>
                  <span
                    className="thumb-remove"
                    onClick={(event) => {
                      event.stopPropagation()
                      handleRemovePanel(panel.id)
                    }}
                  >
                    remove
                  </span>
                </button>
              ))
            ) : (
              <div className="empty-state">
                <strong>No assay loaded yet.</strong>
                <p>Start with the demo if you want to inspect the quantification pipeline first.</p>
              </div>
            )}
          </div>
        </section>

        <section className="panel inspector-panel">
          <div className="section-head">
            <div>
              <p className="eyebrow">Workbench</p>
              <h2>Lane drafting</h2>
            </div>
            <div className="button-row">
              <span className={`pill ${isAnalyzing || isDrafting ? 'is-warm' : 'is-calm'}`}>
                {isDrafting
                  ? 'Drafting lanes'
                  : isAnalyzing
                    ? 'Recomputing quantification'
                    : 'Analysis synced'}
              </span>
              <button
                type="button"
                className="button ghost"
                onClick={handleRedraftActivePanel}
                disabled={!activePanel}
              >
                Re-draft active panel
              </button>
            </div>
          </div>

          <div className="workbench" onKeyDown={handleWorkbenchKeyDown} tabIndex={0}>
            <div className="canvas-stage">
              {activePanel ? (
                <>
                  <img
                    src={activeAnalysis?.processedUrl ?? activePanel.url}
                    alt={activePanel.name}
                    className="stage-image"
                  />
                  <div className="overlay" onMouseUp={handleOverlayMouseUp}>
                    {activeGeometries.map((geometry, index) => (
                      <div
                        key={geometry.id}
                        className={`lane-outline ${lanes[index]?.enabled ? '' : 'is-muted'}`}
                        style={toPercentRect(geometry.lane, activeAnalysis)}
                      >
                        <span>
                          {lanes[index]?.label ?? `Lane ${index + 1}`} | conf {geometry.confidence.toFixed(2)}
                        </span>
                        <button
                          type="button"
                          className={`overlay-hit overlay-hit-lane ${
                            isSelected(selectedRegion, geometry.id, 'lane') ? 'is-selected' : ''
                          }`}
                          style={innerPercentRect(geometry.lane, geometry.lane)}
                          onMouseDown={(event) =>
                            handleOverlayMouseDown(event, {
                              laneId: geometry.id,
                              target: 'lane',
                            })
                          }
                          onClick={() => handleSelectRegion({ laneId: geometry.id, target: 'lane' })}
                        />
                        <button
                          type="button"
                          className={`band-outline primary ${
                            isSelected(selectedRegion, geometry.id, 'primary') ? 'is-selected' : ''
                          }`}
                          style={innerPercentRect(geometry.lane, geometry.primary)}
                          onMouseDown={(event) =>
                            handleOverlayMouseDown(event, {
                              laneId: geometry.id,
                              target: 'primary',
                            })
                          }
                          onClick={() => handleSelectRegion({ laneId: geometry.id, target: 'primary' })}
                        />
                        {renderResizeHandles(
                          geometry.id,
                          'primary',
                          geometry.primary,
                          geometry.lane,
                          handleOverlayMouseDown,
                        )}
                        {geometry.reference ? (
                          <>
                            <button
                              type="button"
                              className={`band-outline reference ${
                                isSelected(selectedRegion, geometry.id, 'reference') ? 'is-selected' : ''
                              }`}
                              style={innerPercentRect(geometry.lane, geometry.reference)}
                              onMouseDown={(event) =>
                                handleOverlayMouseDown(event, {
                                  laneId: geometry.id,
                                  target: 'reference',
                                })
                              }
                              onClick={() =>
                                handleSelectRegion({ laneId: geometry.id, target: 'reference' })
                              }
                            />
                            {renderResizeHandles(
                              geometry.id,
                              'reference',
                              geometry.reference,
                              geometry.lane,
                              handleOverlayMouseDown,
                            )}
                          </>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="stage-placeholder">
                  <strong>Image workbench is waiting for a panel.</strong>
                  <p>Once an image is loaded, this view shows lane guides and band rows.</p>
                </div>
              )}
            </div>

            <aside className="rail">
              <div className="control-cluster">
                <label>
                  <span>Assay mode</span>
                  <select
                    value={settings.mode}
                    onChange={(event) =>
                      updateSettings('mode', event.target.value as AnalysisMode)
                    }
                  >
                    <option value="western">Western blot</option>
                    <option value="dot">Dot blot</option>
                    <option value="gel">Gel band</option>
                  </select>
                </label>
                <label>
                  <span>Lane count</span>
                  <input
                    type="range"
                    min="2"
                    max="12"
                    value={settings.laneCount}
                    onChange={(event) => {
                      const laneCount = Number(event.target.value)
                      const nextSettings = { ...settings, laneCount }
                      updateSettings('laneCount', laneCount)
                      if (activePanelId) {
                        setLanesByPanelId((current) => ({
                          ...current,
                          [activePanelId]: syncLaneConfigs(current[activePanelId] ?? lanes, laneCount),
                        }))
                      }
                      if (activePanel) {
                        void generateDraftsForPanel(activePanel, nextSettings)
                      }
                    }}
                  />
                  <small>{settings.laneCount} lanes</small>
                </label>
                <label>
                  <span>Target row</span>
                  <input
                    type="range"
                    min="0.12"
                    max="0.72"
                    step="0.005"
                    value={settings.primaryY}
                    onChange={(event) =>
                      updateSettings('primaryY', Number(event.target.value))
                    }
                  />
                  <small>{percent(settings.primaryY)}</small>
                </label>
                {settings.mode !== 'gel' ? (
                  <label>
                    <span>{settings.mode === 'dot' ? 'Reference row' : 'Loading control row'}</span>
                    <input
                      type="range"
                      min="0.22"
                      max="0.92"
                      step="0.005"
                      value={settings.referenceY}
                      onChange={(event) =>
                        updateSettings('referenceY', Number(event.target.value))
                      }
                    />
                    <small>{percent(settings.referenceY)}</small>
                  </label>
                ) : null}
                <label>
                  <span>Band height</span>
                  <input
                    type="range"
                    min="0.05"
                    max="0.18"
                    step="0.005"
                    value={settings.bandHeight}
                    onChange={(event) =>
                      updateSettings('bandHeight', Number(event.target.value))
                    }
                  />
                  <small>{percent(settings.bandHeight)}</small>
                </label>
                <label>
                  <span>Background offset</span>
                  <input
                    type="range"
                    min="0.01"
                    max="0.12"
                    step="0.005"
                    value={settings.backgroundOffset}
                    onChange={(event) =>
                      updateSettings('backgroundOffset', Number(event.target.value))
                    }
                  />
                  <small>{percent(settings.backgroundOffset)}</small>
                </label>
              </div>

              <div className="control-cluster">
                <label>
                  <span>Brightness trim</span>
                  <input
                    type="range"
                    min="-50"
                    max="50"
                    step="1"
                    value={settings.brightness}
                    onChange={(event) =>
                      updateSettings('brightness', Number(event.target.value))
                    }
                  />
                  <small>
                    {settings.brightness > 0 ? '+' : ''}
                    {settings.brightness}
                  </small>
                </label>
                <label>
                  <span>Contrast trim</span>
                  <input
                    type="range"
                    min="0.65"
                    max="1.8"
                    step="0.01"
                    value={settings.contrast}
                    onChange={(event) =>
                      updateSettings('contrast', Number(event.target.value))
                    }
                  />
                  <small>{settings.contrast.toFixed(2)}x</small>
                </label>
                <label className="toggle">
                  <span>Invert panel</span>
                  <input
                    type="checkbox"
                    checked={settings.invert}
                    onChange={(event) => updateSettings('invert', event.target.checked)}
                  />
                </label>
                <div className="hint-card">
                  <strong>ROI controls</strong>
                  <p>Select lane, target, or reference in the image.</p>
                  <p>Drag the ROI body to move it. Drag the small handles to resize.</p>
                  <p>Arrow keys nudge. `[` and `]` still provide quick symmetric resizing.</p>
                </div>
              </div>
            </aside>
          </div>
        </section>

        <section className="panel ledger-panel">
          <div className="section-head">
            <div>
              <p className="eyebrow">Experimental ledger</p>
              <h2>Sample sheet</h2>
            </div>
          </div>

          <div className="ledger-table">
            <div className="ledger-head">
              <span>Lane</span>
              <span>Sample</span>
              <span>Group</span>
              <span>Use</span>
              <span>Normalized</span>
            </div>
            {lanes.map((lane, index) => {
              const row = activeAnalysis?.laneResults[index]
              return (
                <div key={lane.id} className="ledger-row">
                  <strong>{index + 1}</strong>
                  <input
                    value={lane.label}
                    onChange={(event) => updateLane(index, 'label', event.target.value)}
                  />
                  <input
                    value={lane.group}
                    onChange={(event) => updateLane(index, 'group', event.target.value)}
                  />
                  <label className="mini-toggle">
                    <input
                      type="checkbox"
                      checked={lane.enabled}
                      onChange={(event) => updateLane(index, 'enabled', event.target.checked)}
                    />
                    <span>{lane.enabled ? 'Included' : 'Muted'}</span>
                  </label>
                  <output>{row ? row.displayValue.toFixed(3) : '...'}</output>
                </div>
              )
            })}
          </div>
        </section>

        <section className="panel quant-panel">
          <div className="section-head">
            <div>
              <p className="eyebrow">Semi-quantification</p>
              <h2>Numbers that stay attached to the image</h2>
            </div>
            <div className="button-row">
              <button
                type="button"
                className="button ghost"
                onClick={handleExportProject}
                disabled={!panels.length}
              >
                Save project JSON
              </button>
              <button
                type="button"
                className="button ghost"
                onClick={handleExportCsv}
                disabled={!activeAnalysis}
              >
                Download CSV
              </button>
              <button
                type="button"
                className="button ghost"
                onClick={() => void handleExportPdf()}
                disabled={!selectedFigurePanels.length}
              >
                Export PDF
              </button>
              <button
                type="button"
                className="button solid"
                onClick={handleExportSvg}
                disabled={!selectedFigurePanels.length}
              >
                Export SVG
              </button>
            </div>
          </div>

          {analysisError ? <p className="error-text">{analysisError}</p> : null}

          <div className="metrics">
            <article>
              <span>Average active value</span>
              <strong>{activeAnalysis ? activeAnalysis.overview.meanDisplay.toFixed(3) : '0.000'}</strong>
            </article>
            <article>
              <span>Dynamic range</span>
              <strong>{activeAnalysis ? activeAnalysis.overview.dynamicRange.toFixed(2) : '0.00'}x</strong>
            </article>
            <article>
              <span>Saturation watch</span>
              <strong>{activeAnalysis ? `${activeAnalysis.overview.saturationCount} lanes` : '0 lanes'}</strong>
            </article>
            <article>
              <span>Low signal watch</span>
              <strong>{activeAnalysis ? `${activeAnalysis.overview.lowSignalCount} lanes` : '0 lanes'}</strong>
            </article>
          </div>

          {workspaceWarnings.length ? (
            <div className="warning-board">
              {workspaceWarnings.map((warning) => (
                <p key={warning}>{warning}</p>
              ))}
            </div>
          ) : null}

          <div className="compose-grid">
            <div className="compose-card">
              <div className="compose-head">
                <strong>Statistics</strong>
                <span>{activeAnalysis?.statistics.enabled ? 'Live' : 'Waiting'}</span>
              </div>
              <label className="toggle">
                <span>Show significance</span>
                <input
                  type="checkbox"
                  checked={statisticalSettings.enabled}
                  onChange={(event) => updateStatisticalSettings('enabled', event.target.checked)}
                />
              </label>
              <label>
                <span>Test method</span>
                <select
                  value={statisticalSettings.method}
                  onChange={(event) =>
                    updateStatisticalSettings(
                      'method',
                      event.target.value as StatisticalSettings['method'],
                    )
                  }
                >
                  <option value="welch-t">Welch t-test</option>
                  <option value="permutation">Permutation</option>
                </select>
              </label>
              <label>
                <span>Comparison mode</span>
                <select
                  value={statisticalSettings.comparisonMode}
                  onChange={(event) =>
                    updateStatisticalSettings(
                      'comparisonMode',
                      event.target.value as StatisticalSettings['comparisonMode'],
                    )
                  }
                >
                  <option value="vs-baseline">Against baseline group</option>
                  <option value="all-pairs">All pairwise groups</option>
                  <option value="anova-posthoc">ANOVA + post-hoc</option>
                </select>
              </label>
              <label>
                <span>Baseline group</span>
                <select
                  value={statisticalSettings.baselineGroup}
                  onChange={(event) =>
                    updateStatisticalSettings('baselineGroup', event.target.value)
                  }
                >
                  {uniqueGroups(lanes).map((group) => (
                    <option key={group} value={group}>
                      {group}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Multiplicity correction</span>
                <select
                  value={statisticalSettings.correction}
                  onChange={(event) =>
                    updateStatisticalSettings(
                      'correction',
                      event.target.value as StatisticalSettings['correction'],
                    )
                  }
                >
                  <option value="holm">Holm</option>
                  <option value="none">None</option>
                </select>
              </label>
              <label className="toggle">
                <span>Show `ns`</span>
                <input
                  type="checkbox"
                  checked={statisticalSettings.showNonSignificant}
                  onChange={(event) =>
                    updateStatisticalSettings('showNonSignificant', event.target.checked)
                  }
                />
              </label>
              <small>
                {activeAnalysis?.statistics.comparisons.length
                  ? `${activeAnalysis.statistics.comparisons.length} comparison(s) available via ${activeAnalysis.statistics.method}`
                  : 'Need at least two groups with >=2 active replicates'}
              </small>
              {activeAnalysis?.statistics.omnibusPValue != null ? (
                <small>Omnibus ANOVA p = {activeAnalysis.statistics.omnibusPValue.toFixed(4)}</small>
              ) : null}
            </div>

            <div className="compose-card">
              <div className="compose-head">
                <strong>Figure board</strong>
                <span>{selectedFigurePanels.length} panel(s)</span>
              </div>
              <label>
                <span>Board title</span>
                <input
                  value={figureBoardSettings.title}
                  onChange={(event) => updateFigureBoardSettings('title', event.target.value)}
                />
              </label>
              <label>
                <span>Columns</span>
                <select
                  value={figureBoardSettings.columns}
                  onChange={(event) =>
                    updateFigureBoardSettings('columns', Number(event.target.value) as 1 | 2)
                  }
                >
                  <option value="1">1 column</option>
                  <option value="2">2 columns</option>
                </select>
              </label>
              <div className="panel-picker">
                {panels.map((panel) => {
                  const checked = figureBoardSettings.selectedPanelIds.includes(panel.id)
                  const ready = Boolean(analysisByPanelId[panel.id])
                  return (
                    <label
                      key={panel.id}
                      className={`picker-row ${checked ? 'is-checked' : ''} ${ready ? '' : 'is-disabled'}`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={!ready}
                        onChange={() => togglePanelSelection(panel.id)}
                      />
                      <span>{panel.name}</span>
                    </label>
                  )
                })}
              </div>
              <small>Only analyzed panels can enter the publication board.</small>
            </div>
          </div>

          <div className="chart-shell">
            <FigurePreview
              document={boardPreview}
              panelCount={selectedFigurePanels.length}
            />
            <div className="notes">
              <p>
                The figure board is now generated from the same analysis objects used for on-screen quantification.
                Statistical brackets, stars, crop order, and exported SVG/PDF all stay synchronized.
              </p>
              <ul>
                <li>Baseline-vs-treatment and all-pair comparisons are available with optional Holm correction.</li>
                <li>Multi-panel boards support labeled panels and shared publication styling.</li>
                <li>Project JSON restores image trays, ROI drafts, statistics settings, and board layout choices.</li>
              </ul>
            </div>
          </div>
        </section>
      </main>
    </div>
  )
}

function FigurePreview({
  document,
  panelCount,
}: {
  document: FigureDocument
  panelCount: number
}) {
  if (!panelCount) {
    return (
      <div className="figure-board is-empty">
        <strong>Figure board preview</strong>
        <p>Select one or more analyzed panels to assemble the publication board.</p>
      </div>
    )
  }

  return (
    <div className="figure-board">
      <div className="svg-preview" dangerouslySetInnerHTML={{ __html: document.svg }} />
    </div>
  )
}

function renderResizeHandles(
  laneId: string,
  target: SelectedRegion['target'],
  rect: Rect,
  lane: Rect,
  onMouseDown: (
    event: ReactMouseEvent<HTMLButtonElement>,
    region: SelectedRegion,
    resizeHandle?: ResizeHandle,
  ) => void,
) {
  const handles: ResizeHandle[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']

  return handles.map((handle) => (
    <button
      key={`${laneId}-${target}-${handle}`}
      type="button"
      className={`resize-handle resize-${handle}`}
      style={handleStyle(rect, lane, handle)}
      onMouseDown={(event) => onMouseDown(event, { laneId, target }, handle)}
      aria-label={`Resize ${target} ${handle}`}
    />
  ))
}

function toPercentRect(rect: Rect, analysis: AnalysisResult | null) {
  const width = analysis?.width ?? 1000
  const height = analysis?.height ?? 620
  return {
    left: `${(rect.x / width) * 100}%`,
    top: `${(rect.y / height) * 100}%`,
    width: `${(rect.width / width) * 100}%`,
    height: `${(rect.height / height) * 100}%`,
  }
}

function innerPercentRect(lane: Rect, rect: Rect) {
  return {
    left: `${((rect.x - lane.x) / lane.width) * 100}%`,
    top: `${((rect.y - lane.y) / lane.height) * 100}%`,
    width: `${(rect.width / lane.width) * 100}%`,
    height: `${(rect.height / lane.height) * 100}%`,
  }
}

function handleStyle(rect: Rect, lane: Rect, handle: ResizeHandle): CSSProperties {
  const anchor = innerPercentRect(lane, rect)

  const map: Record<ResizeHandle, CSSProperties> = {
    n: { left: 'calc(50% - 5px)', top: '-5px' },
    s: { left: 'calc(50% - 5px)', bottom: '-5px' },
    e: { right: '-5px', top: 'calc(50% - 5px)' },
    w: { left: '-5px', top: 'calc(50% - 5px)' },
    ne: { right: '-5px', top: '-5px' },
    nw: { left: '-5px', top: '-5px' },
    se: { right: '-5px', bottom: '-5px' },
    sw: { left: '-5px', bottom: '-5px' },
  }

  return {
    ...anchor,
    ...map[handle],
  }
}

function percent(value: number) {
  return `${Math.round(value * 100)}%`
}

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
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

function dedupe(values: string[]) {
  return [...new Set(values)]
}

function dedupeIds(values: string[]) {
  return [...new Set(values)]
}

function uniqueGroups(lanes: LaneConfig[]) {
  return [...new Set(lanes.map((lane) => lane.group).filter(Boolean))]
}

function normalizeBoardSettings(
  settings: FigureBoardSettings,
  panelIds: string[],
  activePanelId: string | null,
) {
  return {
    ...settings,
    selectedPanelIds: normalizeSelectedPanelIds(settings.selectedPanelIds, panelIds, activePanelId),
  }
}

function normalizeSelectedPanelIds(
  selectedPanelIds: string[],
  panelIds: string[],
  activePanelId: string | null,
) {
  const validIds = new Set(panelIds)
  const filtered = selectedPanelIds.filter((panelId) => validIds.has(panelId))
  if (filtered.length) {
    return filtered
  }
  if (activePanelId && validIds.has(activePanelId)) {
    return [activePanelId]
  }
  return panelIds[0] ? [panelIds[0]] : []
}

function isSelected(
  selected: SelectedRegion | null,
  laneId: string,
  target: SelectedRegion['target'],
) {
  return selected?.laneId === laneId && selected?.target === target
}

export default App
