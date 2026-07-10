import { useEffect, useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'

import { AppNav } from '../components/AppNav'
import { HotUpdateBanner } from '../components/HotUpdateBanner'
import { UpdateBanner } from '../components/UpdateBanner'
import { PreviewModalHost } from '../components/PreviewModalHost'
import { AppRoute } from '../ui'
import { useApp } from '../context/AppContext'
import { DownloadProgressProvider } from '../context/DownloadProgressContext'
import { ExportProgressProvider } from '../context/ExportProgressContext'
import { useDeviceConnection } from '../context/DeviceConnectionContext'
import { CameraMediaPage } from '../pages/CameraMediaPage'
import { DevPage } from '../pages/DevPage'
import { DeviceDebugPage } from '../pages/DeviceDebugPage'
import { DeviceConnectPage } from '../pages/DeviceConnectPage'
import { LocalMediaPage } from '../pages/LocalMediaPage'
import { SettingsPage } from '../pages/SettingsPage'
import { WorkspacePage } from '../pages/WorkspacePage'
import type { CacheStats } from '../shared/types'
import type { CreativeModeId, WorkspaceMode } from '../workspace/components/WorkspaceModeHeader'

export function AppRoutes() {
  const { settings, setSettings, connection, hiddenDevMode } = useApp()
  const {
    activeDevice,
    cameraLibraryMounted,
    connectDevice,
    devicePhase,
    mockServerStatus,
    showDeviceConnect,
    sourceMode,
    chooseMockMediaDir,
    startMockServer,
    stopMockServer,
  } = useDeviceConnection()

  const [cacheStats, setCacheStats] = useState<CacheStats | null>(null)
  const [pagesKey, setPagesKey] = useState(0)
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>('edit')
  const [creativeModeId, setCreativeModeId] = useState<CreativeModeId | null>(null)
  const [workspaceEditing, setWorkspaceEditing] = useState(false)

  useEffect(() => {
    void window.luna.getCacheStats().then(setCacheStats).catch(() => undefined)
  }, [])

  async function chooseBaseDir(): Promise<void> {
    const dir = await window.luna.chooseDownloadDir()
    if (dir) setSettings(await window.luna.saveSettings({ downloadDir: dir }))
  }

  async function chooseLocalResourcesDir(): Promise<void> {
    const dir = await window.luna.chooseLocalResourcesDir()
    if (dir) setSettings(await window.luna.saveSettings({ localResourcesDir: dir }))
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
    setPagesKey((key) => key + 1)
  }

  const developerMode = settings?.developerMode ?? false
  const debugVisible = import.meta.env.DEV || hiddenDevMode
  const location = useLocation()
  const activePath = location.pathname === '/' ? '/library' : location.pathname
  const isActive = (path: string) => activePath === path

  // ── 路由访问权限表：path → 是否有权访问 ──
  // 加新路由时，在这里加一行，再在下面加 <section> 即可
  const routeAccess: [string, boolean][] = [
    ['/library', true],
    ['/local-resources', true],
    ['/workspace', true],
    ['/settings', true],
    ['/developer', developerMode],
    ['/ble-debug', debugVisible],
    ['/device-debug', debugVisible],
  ]
  const isKnownRoute = routeAccess.some(([path, allowed]) => allowed && isActive(path))

  // ── 特殊处理 ──
  if (isActive('/downloads')) return <Navigate to="/local-resources" replace />
  if (!isKnownRoute) return <Navigate to={developerMode ? '/developer' : '/library'} replace />

  // 独立调试包：只渲染设备调试页面，无导航、无路由切换
  if (typeof __DEBUG_STANDALONE__ !== 'undefined' && __DEBUG_STANDALONE__) {
    return (
      <main className="app">
        <DeviceDebugPage />
      </main>
    )
  }

  return (
    <ExportProgressProvider>
      <main className="app">
        <AppNav
        connection={connection}
        sourceMode={sourceMode}
        activeDevice={activeDevice}
        showWorkspaceMode={isActive('/workspace') && workspaceEditing}
        workspaceMode={workspaceMode}
        creativeModeId={creativeModeId}
        onModeChange={setWorkspaceMode}
        onCreativeModeChange={setCreativeModeId}
      />
      <UpdateBanner />
      <HotUpdateBanner />

      <div className="route-stack" key={pagesKey}>

        <AppRoute path="/library">
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
              <DownloadProgressProvider>
                <CameraMediaPage />
              </DownloadProgressProvider>
            </div>
          )}
        </AppRoute>

        <AppRoute path="/local-resources">
          <DownloadProgressProvider>
            <LocalMediaPage />
          </DownloadProgressProvider>
        </AppRoute>

        <AppRoute path="/workspace">
          <WorkspacePage
            workspaceMode={workspaceMode}
            creativeModeId={creativeModeId}
            pageActive={isActive('/workspace')}
            onEditingChange={setWorkspaceEditing}
          />
        </AppRoute>

        <AppRoute path="/settings" preserve={false}>
          <SettingsPage
            activeDevice={activeDevice}
            cacheStats={cacheStats}
            chooseBaseDir={chooseBaseDir}
            chooseLocalResourcesDir={chooseLocalResourcesDir}
            chooseExportDir={chooseExportDir}
            clearCache={clearCache}
            connection={connection}
            openDirectory={openDirectory}
            settings={settings}
            setSettings={setSettings}
          />
        </AppRoute>

        <AppRoute path="/ble-debug" preserve={false}>
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
        </AppRoute>

        <AppRoute path="/device-debug" preserve={false}>
          <DeviceDebugPage />
        </AppRoute>

        <PreviewModalHost />
      </div>
    </main>
    </ExportProgressProvider>
  )
}
