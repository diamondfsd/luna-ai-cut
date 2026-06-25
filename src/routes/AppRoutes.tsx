import { useEffect, useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'

import { AppNav } from '../components/AppNav'
import { UpdateBanner } from '../components/UpdateBanner'
import { useApp } from '../context/AppContext'
import { useDeviceConnection } from '../context/DeviceConnectionContext'
import { DevPage } from '../pages/DevPage'
import { DeviceConnectPage } from '../pages/DeviceConnectPage'
import { MediaLibraryPage } from '../pages/MediaLibraryPage'
import { SettingsPage } from '../pages/SettingsPage'
import type { CacheStats, LunaFile, PreviewResult } from '../shared/types'

export function AppRoutes() {
  const { settings, setSettings, connection, downloadProgress, setDownloadProgress } = useApp()
  const {
    activeDevice,
    cameraLibraryMounted,
    connectDevice,
    devices,
    devicePhase,
    mockServerStatus,
    showDeviceConnect,
    sourceMode,
    chooseMockMediaDir,
    startMockServer,
    stopMockServer,
  } = useDeviceConnection()

  const [cacheStats, setCacheStats] = useState<CacheStats | null>(null)
  const [previewFile, setPreviewFile] = useState<LunaFile | null>(null)
  const [preview, setPreview] = useState<PreviewResult | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [localResourcesRefreshKey, setLocalResourcesRefreshKey] = useState(0)
  const [pagesKey, setPagesKey] = useState(0)

  useEffect(() => {
    void window.luna.getCacheStats().then(setCacheStats).catch(() => undefined)
  }, [])

  useEffect(() => {
    return window.luna.onDownloadProgress((progress) => {
      setDownloadProgress((current) => {
        const previous = current.get(progress.fileName)
        const next = new Map(current).set(progress.fileName, progress)
        const wasLocal = previous?.status === 'done' || previous?.status === 'exists'
        const isLocal = progress.status === 'done' || progress.status === 'exists'
        if (isLocal && !wasLocal) {
          setLocalResourcesRefreshKey((key) => key + 1)
        }
        return next
      })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function chooseDir(): Promise<void> {
    const dir = await window.luna.chooseDownloadDir()
    if (dir) setSettings(await window.luna.saveSettings({ downloadDir: dir }))
  }

  async function chooseExportDir(): Promise<void> {
    const dir = await window.luna.chooseExportDir()
    if (dir) setSettings(await window.luna.saveSettings({ exportDir: dir }))
  }

  function openDirectory(targetPath: string | null | undefined): void {
    if (!targetPath) return
    void window.luna.openPath(targetPath)
  }

  async function clearCache(): Promise<void> {
    setCacheStats(await window.luna.clearCache())
    setPreviewFile(null)
    setPreview(null)
    setPreviewLoading(false)
    setLocalResourcesRefreshKey((key) => key + 1)
    setPagesKey((key) => key + 1)
  }

  const developerMode = settings?.developerMode ?? false
  const location = useLocation()
  const activePath = location.pathname === '/' ? '/library' : location.pathname
  const isDeveloperActive = developerMode && activePath === '/developer'
  const isLibraryActive = activePath === '/library' && !isDeveloperActive
  const isDownloadsLegacy = activePath === '/downloads'
  const isDownloadsActive = activePath === '/local-resources'
  const isSettingsActive = activePath === '/settings'
  const isBluetoothDebugActive = import.meta.env.DEV && activePath === '/ble-debug'
  const isKnownRoute = isDeveloperActive || isLibraryActive || isDownloadsActive || isSettingsActive || isBluetoothDebugActive

  if (isDownloadsLegacy) {
    return <Navigate to="/local-resources" replace />
  }

  if (!isKnownRoute) {
    return <Navigate to={developerMode ? '/developer' : '/library'} replace />
  }

  return (
    <main className="app">
      <AppNav connection={connection} sourceMode={sourceMode} activeDevice={activeDevice} />
      <UpdateBanner />

      <div className="route-stack" key={pagesKey}>
       

        <section className="route-panel" hidden={!isLibraryActive}>
          {showDeviceConnect && (
            <DeviceConnectPage
              activeDevice={activeDevice}
              connection={connection}
              phase={devicePhase}
              settings={settings}
              onConnect={connectDevice}
            />
          )}
          {(cameraLibraryMounted || !showDeviceConnect) && (
            <div hidden={showDeviceConnect}>
              <MediaLibraryPage
                isDownloadsPage={false}
                pageActive={isLibraryActive}
                settings={settings}
                downloadProgress={downloadProgress}
                setDownloadProgress={setDownloadProgress}
                downloading={downloading}
                setDownloading={setDownloading}
                previewFile={previewFile}
                setPreviewFile={setPreviewFile}
                preview={preview}
                setPreview={setPreview}
                previewLoading={previewLoading}
                setPreviewLoading={setPreviewLoading}
                activeDevice={activeDevice}
                refreshKey={pagesKey}
              />
            </div>
          )}
        </section>

        <section className="route-panel" hidden={!isDownloadsActive}>
          <MediaLibraryPage
            isDownloadsPage={true}
            pageActive={isDownloadsActive}
            settings={settings}
            downloadProgress={downloadProgress}
            setDownloadProgress={setDownloadProgress}
            downloading={downloading}
            setDownloading={setDownloading}
            previewFile={previewFile}
            setPreviewFile={setPreviewFile}
            preview={preview}
            setPreview={setPreview}
            previewLoading={previewLoading}
            setPreviewLoading={setPreviewLoading}
            refreshKey={localResourcesRefreshKey}
          />
        </section>

        {isSettingsActive && (
          <section className="route-panel">
            <SettingsPage
              activeDevice={activeDevice}
              devices={devices}
              cacheStats={cacheStats}
              chooseDir={chooseDir}
              chooseExportDir={chooseExportDir}
              clearCache={clearCache}
              connection={connection}
              openDirectory={openDirectory}
              settings={settings}
              setSettings={setSettings}
            />
          </section>
        )}

        {isBluetoothDebugActive && (
          <section className="route-panel">
            <DevPage
              activeDevice={activeDevice}
              settings={settings}
              setSettings={setSettings}
              developerMode={settings?.developerMode ?? false}
              mockServerStatus={mockServerStatus}
              startMockServer={startMockServer}
              stopMockServer={stopMockServer}
              chooseMockMediaDir={chooseMockMediaDir}
              openDirectory={openDirectory}
            />
          </section>
        )}
      </div>
    </main>
  )
}
