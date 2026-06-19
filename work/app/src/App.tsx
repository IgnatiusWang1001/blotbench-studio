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
  SelectedRegion,
  StatisticalSettings,
} from './types'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

type Language = 'en' | 'zh'

const LANGUAGE_STORAGE_KEY = 'blotbench-language-v1'

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
  const stageImageRef = useRef<HTMLImageElement | null>(null)
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
  } | null>(null)
  const [showAutosaveBanner, setShowAutosaveBanner] = useState(Boolean(restoredProject))
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [installState, setInstallState] = useState<'ready' | 'installed' | 'unavailable'>(
    window.matchMedia('(display-mode: standalone)').matches ? 'installed' : 'unavailable',
  )
  const [isOffline, setIsOffline] = useState(!navigator.onLine)
  const [isDragActive, setIsDragActive] = useState(false)
  const [stageFrame, setStageFrame] = useState({ width: 1000, height: 640 })
  const [language, setLanguage] = useState<Language>(() => {
    const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY)
    if (stored === 'zh' || stored === 'en') {
      return stored
    }
    return navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en'
  })
  const copy = useMemo(() => getCopy(language), [language])

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

  useEffect(() => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, language)
    document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en'
    document.title = copy.pageTitle
    const description = document.querySelector('meta[name="description"]')
    if (description) {
      description.setAttribute('content', copy.pageDescription)
    }
  }, [copy.pageDescription, copy.pageTitle, language])

  useEffect(() => {
    function syncStageFrame() {
      const element = stageImageRef.current
      if (!element) {
        return
      }
      const nextWidth = element.clientWidth || 1000
      const nextHeight = element.clientHeight || 640
      setStageFrame((current) =>
        current.width === nextWidth && current.height === nextHeight
          ? current
          : { width: nextWidth, height: nextHeight },
      )
    }

    syncStageFrame()
    window.addEventListener('resize', syncStageFrame)
    return () => window.removeEventListener('resize', syncStageFrame)
  }, [activePanelId, activeAnalysis?.width, activeAnalysis?.height])

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
  const stageMetrics = useMemo(
    () =>
      computeStageMetrics(
        activeAnalysis?.width ?? 1000,
        activeAnalysis?.height ?? 620,
        stageFrame.width,
        stageFrame.height,
      ),
    [activeAnalysis?.height, activeAnalysis?.width, stageFrame.height, stageFrame.width],
  )

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

  function toggleLanguage() {
    setLanguage((current) => (current === 'en' ? 'zh' : 'en'))
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
  ) {
    setSelectedRegion(region)
    setDragState({
      startX: event.clientX,
      startY: event.clientY,
      region,
    })
  }

  function handleOverlayMouseUp(event: ReactMouseEvent<HTMLDivElement>) {
    if (!dragState || !activePanelId) {
      return
    }
    event.preventDefault()

    const scaleX = (activeAnalysis?.width ?? 1000) / stageMetrics.width
    const scaleY = (activeAnalysis?.height ?? 620) / stageMetrics.height
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
          ? applyRegionDelta(draft, dragState.region, deltaX, deltaY, bounds)
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
          <strong>{copy.autosaveRecoveredTitle}</strong>
          <span>{copy.autosaveRecoveredBody}</span>
          <button type="button" className="button ghost" onClick={handleRestoreAutosaveDismiss}>
            {copy.dismiss}
          </button>
        </section>
      ) : null}

      <header className="masthead panel">
        <div>
          <p className="eyebrow">BlotBench Studio</p>
          <div className="masthead-topline">
            <h1>{copy.heroTitle}</h1>
            <button type="button" className="button ghost language-toggle" onClick={toggleLanguage}>
              {copy.languageToggle}
            </button>
          </div>
          <p className="lede">{copy.heroBody}</p>
        </div>
        <div className="masthead-meta">
          <div className="meta-card">
            <span>{copy.mode}</span>
            <strong>{modeLabel(settings.mode, language)}</strong>
          </div>
          <div className="meta-card">
            <span>{copy.panelSet}</span>
            <strong>{panels.length || 0}</strong>
          </div>
          <div className="meta-card">
            <span>{copy.quantState}</span>
            <strong>{activeAnalysis ? copy.live : copy.idle}</strong>
          </div>
          <div className="meta-card meta-card-install">
            <span>{copy.install}</span>
            <strong>
              {installState === 'installed'
                ? copy.desktopReady
                : installState === 'ready'
                  ? copy.appInstallAvailable
                  : copy.browserMode}
            </strong>
            <small>{isOffline ? copy.offlineNow : copy.offlineReady}</small>
            <div className="button-row compact">
              <button
                type="button"
                className="button ghost"
                disabled={installState !== 'ready'}
                onClick={() => void handleInstallApp()}
              >
                {copy.installApp}
              </button>
            </div>
          </div>
        </div>
      </header>

      <section className="workflow-strip panel">
        <article>
          <span>01</span>
          <h2>{copy.acquireTitle}</h2>
          <p>{copy.acquireBody}</p>
        </article>
        <article>
          <span>02</span>
          <h2>{copy.autoDraftTitle}</h2>
          <p>{copy.autoDraftBody}</p>
        </article>
        <article>
          <span>03</span>
          <h2>{copy.correctTitle}</h2>
          <p>{copy.correctBody}</p>
        </article>
        <article>
          <span>04</span>
          <h2>{copy.composeTitle}</h2>
          <p>{copy.composeBody}</p>
        </article>
      </section>

      <section className="panel landing-panel">
        <div className="section-head">
          <div>
            <p className="eyebrow">{copy.productProfile}</p>
            <h2>{copy.productProfileTitle}</h2>
          </div>
        </div>

        <div className="landing-grid">
          <article className="landing-card landing-card-wide">
            <span>{copy.aboutLabel}</span>
            <h3>{copy.aboutTitle}</h3>
            <p>{copy.aboutBody}</p>
          </article>

          <article className="landing-card">
            <span>{copy.validationLabel}</span>
            <h3>{copy.validationTitle}</h3>
            <ul>
              <li>{copy.validationBullet1}</li>
              <li>{copy.validationBullet2}</li>
              <li>{copy.validationBullet3}</li>
            </ul>
          </article>

          <article className="landing-card">
            <span>{copy.methodsLabel}</span>
            <h3>{copy.methodsTitle}</h3>
            <ul>
              <li>{copy.methodsBullet1}</li>
              <li>{copy.methodsBullet2}</li>
              <li>{copy.methodsBullet3}</li>
            </ul>
          </article>

          <article className="landing-card landing-card-wide">
            <span>{copy.citationLabel}</span>
            <h3>{copy.citationTitle}</h3>
            <p>{copy.citationBody}</p>
            <code className="citation-block">{copy.citationText}</code>
          </article>
        </div>
      </section>

      <main className="grid">
        <section className="panel upload-panel">
          <div className="section-head">
            <div>
              <p className="eyebrow">{copy.sourcePanels}</p>
              <h2>{copy.imageTray}</h2>
            </div>
            <div className="button-row">
              <button type="button" className="button ghost" onClick={handleLoadDemo}>
                {copy.loadDemoPanel}
              </button>
              <button
                type="button"
                className="button ghost"
                onClick={() => projectInputRef.current?.click()}
              >
                {copy.openProject}
              </button>
              <button
                type="button"
                className="button solid"
                onClick={() => fileInputRef.current?.click()}
              >
                {copy.addRawImage}
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
            <p>{copy.dropzoneTitle}</p>
            <small>{copy.dropzoneBody}</small>
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
                      {panel.bitDepth}-bit{' '}
                      {panel.source === 'demo'
                        ? copy.demoAssay
                        : panel.source === 'project'
                          ? copy.recoveredPanel
                          : copy.uploadedPanel}
                    </span>
                  </div>
                  <span
                    className="thumb-remove"
                    onClick={(event) => {
                      event.stopPropagation()
                      handleRemovePanel(panel.id)
                    }}
                  >
                    {copy.remove}
                  </span>
                </button>
              ))
            ) : (
              <div className="empty-state">
                <strong>{copy.noAssayLoaded}</strong>
                <p>{copy.noAssayBody}</p>
              </div>
            )}
          </div>
        </section>

        <section className="panel inspector-panel">
          <div className="section-head">
            <div>
              <p className="eyebrow">{copy.workbench}</p>
              <h2>{copy.laneDrafting}</h2>
            </div>
            <div className="button-row">
              <span className={`pill ${isAnalyzing || isDrafting ? 'is-warm' : 'is-calm'}`}>
                {isDrafting
                  ? copy.draftingLanes
                  : isAnalyzing
                    ? copy.recomputingQuantification
                    : copy.analysisSynced}
              </span>
              <button
                type="button"
                className="button ghost"
                onClick={handleRedraftActivePanel}
                disabled={!activePanel}
              >
                {copy.redraftActivePanel}
              </button>
            </div>
          </div>

          <div className="workbench" onKeyDown={handleWorkbenchKeyDown} tabIndex={0}>
            <div className="canvas-stage">
              {activePanel ? (
                <>
                  <img
                    ref={stageImageRef}
                    src={activeAnalysis?.processedUrl ?? activePanel.url}
                    alt={activePanel.name}
                    className="stage-image"
                  />
                  <div className="overlay" style={overlayStyle(stageMetrics)} onMouseUp={handleOverlayMouseUp}>
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
                          </>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="stage-placeholder">
                  <strong>{copy.workbenchWaiting}</strong>
                  <p>{copy.workbenchWaitingBody}</p>
                </div>
              )}
            </div>

            <aside className="rail">
              <div className="control-cluster">
                <label>
                  <span>{copy.assayMode}</span>
                  <select
                    value={settings.mode}
                    onChange={(event) =>
                      updateSettings('mode', event.target.value as AnalysisMode)
                    }
                  >
                    <option value="western">{copy.modeWestern}</option>
                    <option value="dot">{copy.modeDot}</option>
                    <option value="gel">{copy.modeGel}</option>
                  </select>
                </label>
                <label>
                  <span>{copy.laneCount}</span>
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
                  <small>{copy.laneCountValue(settings.laneCount)}</small>
                </label>
                <label>
                  <span>{copy.laneWidth}</span>
                  <input
                    type="range"
                    min="0.52"
                    max="0.92"
                    step="0.01"
                    value={settings.laneWidthScale}
                    onChange={(event) =>
                      updateSettings('laneWidthScale', Number(event.target.value))
                    }
                  />
                  <small>{percent(settings.laneWidthScale)}</small>
                </label>
                <label>
                  <span>{copy.laneHeight}</span>
                  <input
                    type="range"
                    min="0.18"
                    max="0.72"
                    step="0.01"
                    value={settings.laneHeight}
                    onChange={(event) =>
                      updateSettings('laneHeight', Number(event.target.value))
                    }
                  />
                  <small>{percent(settings.laneHeight)}</small>
                </label>
                <label>
                  <span>{copy.targetRow}</span>
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
                    <span>{settings.mode === 'dot' ? copy.referenceRow : copy.loadingControlRow}</span>
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
                  <span>{copy.bandHeight}</span>
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
                  <span>{copy.backgroundOffset}</span>
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
                  <span>{copy.brightnessTrim}</span>
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
                  <span>{copy.contrastTrim}</span>
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
                  <span>{copy.invertPanel}</span>
                  <input
                    type="checkbox"
                    checked={settings.invert}
                    onChange={(event) => updateSettings('invert', event.target.checked)}
                  />
                </label>
                <div className="hint-card">
                  <strong>{copy.roiControls}</strong>
                  <p>{copy.roiControlsBody1}</p>
                  <p>{copy.roiControlsBody2}</p>
                  <p>{copy.roiControlsBody3}</p>
                </div>
              </div>
            </aside>
          </div>
        </section>

        <section className="panel ledger-panel">
          <div className="section-head">
            <div>
              <p className="eyebrow">{copy.experimentalLedger}</p>
              <h2>{copy.sampleSheet}</h2>
            </div>
          </div>

          <div className="ledger-table">
            <div className="ledger-head">
              <span>{copy.lane}</span>
              <span>{copy.sample}</span>
              <span>{copy.group}</span>
              <span>{copy.use}</span>
              <span>{copy.normalized}</span>
            </div>
            {lanes.map((lane, index) => {
              const row = activeAnalysis?.laneResults[index]
              const diagnosis = row ? describeLaneDiagnosis(row, settings.mode, language) : null
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
                    <span>{lane.enabled ? copy.included : copy.muted}</span>
                  </label>
                  <div className="ledger-metric">
                    <output>{row ? row.displayValue.toFixed(3) : '...'}</output>
                    {row ? (
                      <small>
                        T {row.primaryDensity.toFixed(2)} | R {row.referenceDensity?.toFixed(2) ?? 'n/a'}
                      </small>
                    ) : null}
                    {diagnosis ? <small>{diagnosis}</small> : null}
                  </div>
                </div>
              )
            })}
          </div>
        </section>

        <section className="panel quant-panel">
          <div className="section-head">
            <div>
              <p className="eyebrow">{copy.semiQuantification}</p>
              <h2>{copy.quantTitle}</h2>
            </div>
            <div className="button-row">
              <button
                type="button"
                className="button ghost"
                onClick={handleExportProject}
                disabled={!panels.length}
              >
                {copy.saveProjectJson}
              </button>
              <button
                type="button"
                className="button ghost"
                onClick={handleExportCsv}
                disabled={!activeAnalysis}
              >
                {copy.downloadCsv}
              </button>
              <button
                type="button"
                className="button ghost"
                onClick={() => void handleExportPdf()}
                disabled={!selectedFigurePanels.length}
              >
                {copy.exportPdf}
              </button>
              <button
                type="button"
                className="button solid"
                onClick={handleExportSvg}
                disabled={!selectedFigurePanels.length}
              >
                {copy.exportSvg}
              </button>
            </div>
          </div>

          {analysisError ? <p className="error-text">{analysisError}</p> : null}

          <div className="metrics">
            <article>
              <span>{copy.averageActiveValue}</span>
              <strong>{activeAnalysis ? activeAnalysis.overview.meanDisplay.toFixed(3) : '0.000'}</strong>
            </article>
            <article>
              <span>{copy.dynamicRange}</span>
              <strong>{activeAnalysis ? activeAnalysis.overview.dynamicRange.toFixed(2) : '0.00'}x</strong>
            </article>
            <article>
              <span>{copy.saturationWatch}</span>
              <strong>
                {activeAnalysis ? copy.laneCountValue(activeAnalysis.overview.saturationCount) : copy.laneCountValue(0)}
              </strong>
            </article>
            <article>
              <span>{copy.lowSignalWatch}</span>
              <strong>
                {activeAnalysis ? copy.laneCountValue(activeAnalysis.overview.lowSignalCount) : copy.laneCountValue(0)}
              </strong>
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
                <strong>{copy.statistics}</strong>
                <span>{activeAnalysis?.statistics.enabled ? copy.live : copy.waiting}</span>
              </div>
              <label className="toggle">
                <span>{copy.showSignificance}</span>
                <input
                  type="checkbox"
                  checked={statisticalSettings.enabled}
                  onChange={(event) => updateStatisticalSettings('enabled', event.target.checked)}
                />
              </label>
              <label>
                <span>{copy.testMethod}</span>
                <select
                  value={statisticalSettings.method}
                  onChange={(event) =>
                    updateStatisticalSettings(
                      'method',
                      event.target.value as StatisticalSettings['method'],
                    )
                  }
                >
                  <option value="welch-t">{copy.testWelch}</option>
                  <option value="permutation">{copy.testPermutation}</option>
                </select>
              </label>
              <label>
                <span>{copy.comparisonMode}</span>
                <select
                  value={statisticalSettings.comparisonMode}
                  onChange={(event) =>
                    updateStatisticalSettings(
                      'comparisonMode',
                      event.target.value as StatisticalSettings['comparisonMode'],
                    )
                  }
                >
                  <option value="vs-baseline">{copy.compareBaseline}</option>
                  <option value="all-pairs">{copy.compareAllPairs}</option>
                  <option value="anova-posthoc">{copy.compareAnova}</option>
                </select>
              </label>
              <label>
                <span>{copy.baselineGroup}</span>
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
                <span>{copy.multiplicityCorrection}</span>
                <select
                  value={statisticalSettings.correction}
                  onChange={(event) =>
                    updateStatisticalSettings(
                      'correction',
                      event.target.value as StatisticalSettings['correction'],
                    )
                  }
                >
                  <option value="holm">{copy.correctionHolm}</option>
                  <option value="none">{copy.correctionNone}</option>
                </select>
              </label>
              <label className="toggle">
                <span>{copy.showNs}</span>
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
                  ? copy.comparisonSummary(
                      activeAnalysis.statistics.comparisons.length,
                      activeAnalysis.statistics.method,
                    )
                  : copy.needReplicates}
              </small>
              {activeAnalysis?.statistics.omnibusPValue != null ? (
                <small>{copy.omnibusAnova(activeAnalysis.statistics.omnibusPValue.toFixed(4))}</small>
              ) : null}
            </div>

            <div className="compose-card">
              <div className="compose-head">
                <strong>{copy.figureBoard}</strong>
                <span>{copy.panelCount(selectedFigurePanels.length)}</span>
              </div>
              <label>
                <span>{copy.boardTitle}</span>
                <input
                  value={figureBoardSettings.title}
                  onChange={(event) => updateFigureBoardSettings('title', event.target.value)}
                />
              </label>
              <label>
                <span>{copy.columns}</span>
                <select
                  value={figureBoardSettings.columns}
                  onChange={(event) =>
                    updateFigureBoardSettings('columns', Number(event.target.value) as 1 | 2)
                  }
                >
                  <option value="1">{copy.oneColumn}</option>
                  <option value="2">{copy.twoColumns}</option>
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
              <small>{copy.onlyAnalyzedPanels}</small>
            </div>
          </div>

          <div className="chart-shell">
            <FigurePreview
              document={boardPreview}
              panelCount={selectedFigurePanels.length}
              language={language}
            />
            <div className="notes">
              <p>{copy.figureBoardNote}</p>
              <ul>
                <li>{copy.figureBoardBullet1}</li>
                <li>{copy.figureBoardBullet2}</li>
                <li>{copy.figureBoardBullet3}</li>
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
  language,
}: {
  document: FigureDocument
  panelCount: number
  language: Language
}) {
  const copy = getCopy(language)
  if (!panelCount) {
    return (
      <div className="figure-board is-empty">
        <strong>{copy.figureBoardPreview}</strong>
        <p>{copy.figureBoardPreviewBody}</p>
      </div>
    )
  }

  return (
    <div className="figure-board">
      <div className="svg-preview" dangerouslySetInnerHTML={{ __html: document.svg }} />
    </div>
  )
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

function percent(value: number) {
  return `${Math.round(value * 100)}%`
}

function computeStageMetrics(
  imageWidth: number,
  imageHeight: number,
  frameWidth: number,
  frameHeight: number,
) {
  const scale = Math.min(frameWidth / imageWidth, frameHeight / imageHeight)
  const width = imageWidth * scale
  const height = imageHeight * scale
  return {
    width,
    height,
    offsetX: (frameWidth - width) / 2,
    offsetY: (frameHeight - height) / 2,
  }
}

function overlayStyle(metrics: ReturnType<typeof computeStageMetrics>): CSSProperties {
  return {
    left: `${metrics.offsetX}px`,
    top: `${metrics.offsetY}px`,
    width: `${metrics.width}px`,
    height: `${metrics.height}px`,
  }
}

function describeLaneDiagnosis(
  row: AnalysisResult['laneResults'][number],
  mode: AnalysisMode,
  language: Language,
) {
  if (row.primaryDensity <= 0.0001) {
    return language === 'zh'
      ? '目标框减背景后接近 0，通常表示目标框没压中条带或条带太弱。'
      : 'Target density is near 0 after background subtraction; the target ROI may miss the band or the band is too weak.'
  }

  if (mode !== 'gel' && (!row.referenceDensity || row.referenceDensity <= 0.0001)) {
    return language === 'zh'
      ? '内参框信号接近 0，归一化会失真。请检查青色框是否压中内参条带。'
      : 'Loading-control density is near 0; normalization may be unstable. Check whether the teal ROI sits on the control band.'
  }

  if (row.displayValue <= 0.0001) {
    return language === 'zh'
      ? '结果接近 0，优先检查目标框和背景位置。'
      : 'The final value is near 0. Check the target ROI and local background placement first.'
  }

  return language === 'zh'
    ? '若结果异常，先比对 T/R 两项是否与肉眼观察一致。'
    : 'If the value looks wrong, compare T and R first against what you see visually.'
}

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
}

function modeLabel(mode: AnalysisMode, language: Language) {
  if (mode === 'dot') {
    return language === 'zh' ? '点杂交' : 'Dot blot'
  }
  if (mode === 'gel') {
    return language === 'zh' ? '凝胶条带' : 'Gel band'
  }
  return language === 'zh' ? '蛋白印迹' : 'Western blot'
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

function getCopy(language: Language) {
  if (language === 'zh') {
    return {
      pageTitle: 'BlotBench Studio | WB / Dot Blot / 凝胶排版与半定量',
      pageDescription:
        'BlotBench Studio 是一个本地优先的 WB、Dot Blot 与凝胶图像工作流，支持 ROI 校正、半定量、统计比较和可发表级组图导出。',
      autosaveRecoveredTitle: '已恢复上一次本地会话。',
      autosaveRecoveredBody: '当前工作区已从浏览器自动保存中恢复。',
      dismiss: '关闭',
      heroTitle: 'Western Blot / Dot Blot / 凝胶成像，从图到图表，不再拆成四个软件。',
      heroBody:
        '上传原始曝光图，自动草拟泳道与条带，在同一界面修正 ROI、完成归一化半定量，并直接导出适合论文排版的组图。',
      languageToggle: 'English',
      mode: '模式',
      panelSet: '图板数',
      quantState: '定量状态',
      live: '已联动',
      idle: '待分析',
      install: '安装',
      desktopReady: '可作桌面应用',
      appInstallAvailable: '可安装应用',
      browserMode: '浏览器模式',
      offlineNow: '当前离线',
      offlineReady: '支持离线缓存',
      installApp: '安装应用',
      acquireTitle: '导入',
      acquireBody: '将原始 TIFF/JPG/PNG 直接带入本地优先工作台。',
      autoDraftTitle: '自动草拟',
      autoDraftBody: '定位信号区域、切分泳道，并给出目标条带行与置信度。',
      correctTitle: '修正',
      correctBody: '在同一界面微调泳道、目标带和内参 ROI。',
      composeTitle: '出图',
      composeBody: '导出标签、条带、柱状图和告警一致的发表级组图。',
      productProfile: '产品概览',
      productProfileTitle: '围绕 blot figure generation 的本地优先科研工作站',
      aboutLabel: 'About',
      aboutTitle: '为 Western Blot、Dot Blot 与凝胶半定量设计的一体化发表流程',
      aboutBody:
        'BlotBench Studio 将原始曝光导入、泳道与条带草拟、ROI 校正、内参归一化、统计比较与组图导出收束到同一工作界面，减少 ImageJ、Excel、GraphPad 与 PPT 之间的手工转抄与排版误差。',
      validationLabel: 'Validation',
      validationTitle: '面向可解释性，而非黑箱自动化',
      validationBullet1: '所有 ROI、泳道与条带边界均可人工复核和微调，自动结果从不锁死。',
      validationBullet2: '导出的统计图、裁剪图与 SVG/PDF 共享同一分析对象，避免屏幕结果与最终图稿不一致。',
      validationBullet3: '项目快照可恢复原图托盘、统计参数与组图布局，便于复查、复现实验记录。',
      methodsLabel: 'Methods',
      methodsTitle: '局部自动识别，整条链路本地运行',
      methodsBullet1: '浏览器端处理 TIFF/JPG/PNG，自动起草泳道、目标条带与内参条带 ROI。',
      methodsBullet2: '以内参归一化为核心，支持 Welch t、置换检验与 ANOVA 事后比较。',
      methodsBullet3: '直接输出 publication-ready 的 SVG、PDF、CSV 与项目 JSON，用于论文、补充材料与后续复算。',
      citationLabel: 'Citation',
      citationTitle: '建议在方法或补充材料中说明使用的图像整理流程',
      citationBody:
        '若 BlotBench Studio 参与了图像裁剪、半定量或组图导出，建议在 Methods 或 Figure preparation 中记录软件名称、版本号和本地分析流程。',
      citationText: 'BlotBench Studio v1.0.0 | local-first blot layout, semi-quantification, and figure-board export workflow',
      sourcePanels: '源图面板',
      imageTray: '图像托盘',
      loadDemoPanel: '加载演示面板',
      openProject: '打开项目',
      addRawImage: '添加原始图像',
      dropzoneTitle: '将实验图像拖到这里，或先加载演示查看完整流程。',
      dropzoneBody: '当前版本不会上传到服务器。更适合上传同一泳道顺序下同时包含目标蛋白区和内参区的完整 blot 面板。',
      demoAssay: '演示样例',
      recoveredPanel: '恢复面板',
      uploadedPanel: '已上传面板',
      remove: '移除',
      noAssayLoaded: '还没有载入实验图。',
      noAssayBody: '如果你想先看定量流程，可以从演示面板开始。',
      workbench: '工作台',
      laneDrafting: '泳道草拟',
      draftingLanes: '正在草拟泳道',
      recomputingQuantification: '正在重算定量',
      analysisSynced: '分析已同步',
      redraftActivePanel: '重新草拟当前面板',
      workbenchWaiting: '图像工作台正在等待面板。',
      workbenchWaitingBody: '载入图像后，这里会显示泳道范围，以及目标蛋白和内参蛋白各自的检测短框。',
      assayMode: '实验模式',
      modeWestern: 'Western blot',
      modeDot: 'Dot blot',
      modeGel: '凝胶条带',
      laneCount: '泳道数量',
      laneCountValue: (count: number) => `${count} 条泳道`,
      laneWidth: '泳道宽度',
      laneHeight: '泳道高度',
      targetRow: '目标条带行',
      referenceRow: '参考行',
      loadingControlRow: '内参条带行',
      bandHeight: '条带高度',
      backgroundOffset: '背景偏移',
      brightnessTrim: '亮度微调',
      contrastTrim: '对比度微调',
      invertPanel: '反相图像',
      roiControls: 'ROI 操作',
      roiControlsBody1: '蓝色虚线框是同一样本的泳道范围；短橙框用于目标蛋白条带，短青框用于内参蛋白条带。',
      roiControlsBody2: '只有当目标蛋白和内参蛋白共享同一泳道顺序、且都出现在这张上传图里时，这种双框定量才有意义。',
      roiControlsBody3: '如果目标图和内参图来自两张不同图片或不同膜，请先在外部按同一泳道顺序拼好，再导入这里拖拽短框定位。',
      experimentalLedger: '实验台账',
      sampleSheet: '样本表',
      lane: '泳道',
      sample: '样本',
      group: '分组',
      use: '启用',
      normalized: '归一化值',
      included: '纳入',
      muted: '静默',
      semiQuantification: '半定量',
      quantTitle: '让数值始终跟着图像走',
      saveProjectJson: '保存项目 JSON',
      downloadCsv: '下载 CSV',
      exportPdf: '导出 PDF',
      exportSvg: '导出 SVG',
      averageActiveValue: '启用样本平均值',
      dynamicRange: '动态范围',
      saturationWatch: '饱和提醒',
      lowSignalWatch: '低信号提醒',
      statistics: '统计',
      waiting: '等待中',
      showSignificance: '显示显著性',
      testMethod: '检验方法',
      testWelch: 'Welch t 检验',
      testPermutation: '置换检验',
      comparisonMode: '比较模式',
      compareBaseline: '相对基线组',
      compareAllPairs: '全部成对比较',
      compareAnova: 'ANOVA + 事后比较',
      baselineGroup: '基线组',
      multiplicityCorrection: '多重比较校正',
      correctionHolm: 'Holm',
      correctionNone: '无',
      showNs: '显示 `ns`',
      comparisonSummary: (count: number, method: string) => `${count} 个比较，方法：${method}`,
      needReplicates: '至少需要两个分组且每组至少 2 个启用重复',
      omnibusAnova: (p: string) => `整体 ANOVA p = ${p}`,
      figureBoard: '组图拼板',
      panelCount: (count: number) => `${count} 个面板`,
      boardTitle: '组图标题',
      columns: '列数',
      oneColumn: '1 列',
      twoColumns: '2 列',
      onlyAnalyzedPanels: '只有已完成分析的面板才能进入发表组图。',
      figureBoardNote:
        '组图预览直接来自当前分析对象。当前归一化默认假设目标蛋白区与内参区共享同一泳道几何；若来自不同图片，请先外部对齐后再导入。',
      figureBoardBullet1: '支持基线组比较和全成对比较，并可选 Holm 校正。',
      figureBoardBullet2: '支持多面板排版、面板编号与统一发表风格。',
      figureBoardBullet3: '项目 JSON 可恢复图像托盘、ROI 草稿、统计设置与组图布局。',
      figureBoardPreview: '组图预览',
      figureBoardPreviewBody: '请选择一个或多个已分析面板来拼装发表组图。',
    }
  }

  return {
    pageTitle: 'BlotBench Studio | WB / Dot Blot / Gel Layout and Semi-Quant',
    pageDescription:
      'BlotBench Studio is a local-first Western Blot, Dot Blot, and gel image workflow for ROI correction, semi-quantification, statistics, and publication-ready figure export.',
    autosaveRecoveredTitle: 'Recovered the last local session.',
    autosaveRecoveredBody: 'The current workspace was restored from browser autosave.',
    dismiss: 'Dismiss',
    heroTitle: 'Western Blot / Dot Blot / Gel figure line, not four disconnected apps.',
    heroBody:
      'Upload raw exposures, auto-draft lanes, correct ROIs in place, quantify against a loading control, and leave with a figure board that already looks like it belongs in a paper.',
    languageToggle: '中文',
    mode: 'Mode',
    panelSet: 'Panel set',
    quantState: 'Quant state',
    live: 'Live',
    idle: 'Idle',
    install: 'Install',
    desktopReady: 'Desktop-ready',
    appInstallAvailable: 'App install available',
    browserMode: 'Browser mode',
    offlineNow: 'Offline now',
    offlineReady: 'Offline-ready cache active',
    installApp: 'Install app',
    acquireTitle: 'Acquire',
    acquireBody: 'Bring raw TIFF/JPG/PNG into a local-first workbench.',
    autoDraftTitle: 'Auto draft',
    autoDraftBody: 'Find the signal region, split lanes, and propose band rows with confidence scores.',
    correctTitle: 'Correct',
    correctBody: 'Fine-tune lane, target, and reference ROIs in the same surface that runs quantification.',
    composeTitle: 'Compose',
    composeBody: 'Export a board where labels, bands, chart, and warnings already agree.',
    productProfile: 'Product profile',
    productProfileTitle: 'A local-first research workstation for blot figure generation',
    aboutLabel: 'About',
    aboutTitle: 'An integrated publication workflow for Western Blot, Dot Blot, and gel semi-quantification',
    aboutBody:
      'BlotBench Studio keeps raw exposure intake, lane and band drafting, ROI correction, loading-control normalization, statistical comparison, and figure-board export inside one work surface, reducing handoffs across ImageJ, Excel, GraphPad, and slide software.',
    validationLabel: 'Validation',
    validationTitle: 'Built for interpretability, not black-box automation',
    validationBullet1: 'Every ROI, lane, and band boundary remains reviewable and editable; auto-drafted results are never locked.',
    validationBullet2: 'Charts, crops, and exported SVG/PDF are generated from the same analysis objects, preventing drift between on-screen review and final figures.',
    validationBullet3: 'Project snapshots restore source panels, statistical settings, and board layout so figure preparation can be revisited and reproduced.',
    methodsLabel: 'Methods',
    methodsTitle: 'Local image handling with selective automation across the full chain',
    methodsBullet1: 'TIFF/JPG/PNG panels are processed in-browser, with automatic drafting of lanes, target bands, and loading-control ROIs.',
    methodsBullet2: 'Semi-quantification is centered on loading-control normalization with Welch t-tests, permutation tests, and ANOVA post-hoc comparisons.',
    methodsBullet3: 'Publication-ready SVG, PDF, CSV, and project JSON outputs support manuscript figures, supplements, and downstream re-analysis.',
    citationLabel: 'Citation',
    citationTitle: 'Document the figure-preparation workflow in methods or supplementary notes',
    citationBody:
      'If BlotBench Studio is used for image cropping, semi-quantification, or figure-board export, record the software name, version, and local analysis workflow in the Methods or figure-preparation section.',
    citationText: 'BlotBench Studio v1.0.0 | local-first blot layout, semi-quantification, and figure-board export workflow',
    sourcePanels: 'Source panels',
    imageTray: 'Image tray',
    loadDemoPanel: 'Load demo panel',
    openProject: 'Open project',
    addRawImage: 'Add raw image',
    dropzoneTitle: 'Drop assay images here, or load the demo to inspect the full workflow.',
    dropzoneBody:
      'No upload leaves the browser in this build. It works best with a complete blot panel where target and loading-control regions share the same lane order.',
    demoAssay: 'demo assay',
    recoveredPanel: 'recovered panel',
    uploadedPanel: 'uploaded panel',
    remove: 'remove',
    noAssayLoaded: 'No assay loaded yet.',
    noAssayBody: 'Start with the demo if you want to inspect the quantification pipeline first.',
    workbench: 'Workbench',
    laneDrafting: 'Lane drafting',
    draftingLanes: 'Drafting lanes',
    recomputingQuantification: 'Recomputing quantification',
    analysisSynced: 'Analysis synced',
    redraftActivePanel: 'Re-draft active panel',
    workbenchWaiting: 'Image workbench is waiting for a panel.',
    workbenchWaitingBody:
      'Once an image is loaded, this view shows lane ranges plus separate short detection boxes for the target protein and the loading control.',
    assayMode: 'Assay mode',
    modeWestern: 'Western blot',
    modeDot: 'Dot blot',
    modeGel: 'Gel band',
    laneCount: 'Lane count',
    laneCountValue: (count: number) => `${count} lanes`,
    laneWidth: 'Lane width',
    laneHeight: 'Lane height',
    targetRow: 'Target row',
    referenceRow: 'Reference row',
    loadingControlRow: 'Loading control row',
    bandHeight: 'Band height',
    backgroundOffset: 'Background offset',
    brightnessTrim: 'Brightness trim',
    contrastTrim: 'Contrast trim',
    invertPanel: 'Invert panel',
    roiControls: 'ROI controls',
    roiControlsBody1:
      'The dashed blue frame is the lane range for one sample; the short amber box is for the target protein; the short teal box is for the loading control.',
    roiControlsBody2:
      'This only makes quantitative sense when target and loading-control regions belong to the same lane order and are both present in the uploaded panel.',
    roiControlsBody3:
      'If target and loading control come from separate images or separate membranes, align or assemble them externally first, then import the combined panel and drag the short boxes into position.',
    experimentalLedger: 'Experimental ledger',
    sampleSheet: 'Sample sheet',
    lane: 'Lane',
    sample: 'Sample',
    group: 'Group',
    use: 'Use',
    normalized: 'Normalized',
    included: 'Included',
    muted: 'Muted',
    semiQuantification: 'Semi-quantification',
    quantTitle: 'Numbers that stay attached to the image',
    saveProjectJson: 'Save project JSON',
    downloadCsv: 'Download CSV',
    exportPdf: 'Export PDF',
    exportSvg: 'Export SVG',
    averageActiveValue: 'Average active value',
    dynamicRange: 'Dynamic range',
    saturationWatch: 'Saturation watch',
    lowSignalWatch: 'Low signal watch',
    statistics: 'Statistics',
    waiting: 'Waiting',
    showSignificance: 'Show significance',
    testMethod: 'Test method',
    testWelch: 'Welch t-test',
    testPermutation: 'Permutation',
    comparisonMode: 'Comparison mode',
    compareBaseline: 'Against baseline group',
    compareAllPairs: 'All pairwise groups',
    compareAnova: 'ANOVA + post-hoc',
    baselineGroup: 'Baseline group',
    multiplicityCorrection: 'Multiplicity correction',
    correctionHolm: 'Holm',
    correctionNone: 'None',
    showNs: 'Show `ns`',
    comparisonSummary: (count: number, method: string) => `${count} comparison(s) available via ${method}`,
    needReplicates: 'Need at least two groups with >=2 active replicates',
    omnibusAnova: (p: string) => `Omnibus ANOVA p = ${p}`,
    figureBoard: 'Figure board',
    panelCount: (count: number) => `${count} panel(s)`,
    boardTitle: 'Board title',
    columns: 'Columns',
    oneColumn: '1 column',
    twoColumns: '2 columns',
    onlyAnalyzedPanels: 'Only analyzed panels can enter the publication board.',
    figureBoardNote:
      'The figure board is generated from the same on-screen analysis objects. Current normalization assumes the target region and loading-control region share one lane geometry; externally align separate images before import.',
    figureBoardBullet1: 'Baseline-vs-treatment and all-pair comparisons are available with optional Holm correction.',
    figureBoardBullet2: 'Multi-panel boards support labeled panels and shared publication styling.',
    figureBoardBullet3: 'Project JSON restores image trays, ROI drafts, statistics settings, and board layout choices.',
    figureBoardPreview: 'Figure board preview',
    figureBoardPreviewBody: 'Select one or more analyzed panels to assemble the publication board.',
  }
}

export default App
