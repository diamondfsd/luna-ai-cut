/**
 * WorkspaceGate
 *
 * Wraps the router and, when the current URL is a storage-dependent route
 * (`/projects*` or `/editor*`), blocks it until the workspace is ready:
 *
 *   1. In Electron, initialize the app-managed disk workspace automatically.
 *   2. In browser mode, restore a saved workspace handle when available.
 *   3. If browser permission is revoked, show a Reconnect splash.
 *
 * The landing page (`/`) is not a storage-dependent route — it renders
 * without waiting for the gate, so users see no splash flash on first
 * visit. Navigating into a protected route after the handle is initialized
 * falls through to the "ready" path without additional UI.
 *
 * Also listens for permission-lost signals from fs-primitives and flips
 * back to the Reconnect state mid-session.
 */

import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ensureKnownWorkspaceForCurrent,
  getWorkspaceHandleRecord,
  isFileSystemAccessSupported,
  queryHandlePermission,
  requestHandlePermission,
  saveWorkspaceHandleRecord,
} from '@freecut/infrastructure/storage/handles-db'
import { onPermissionLost, setWorkspaceRoot } from '@freecut/infrastructure/storage/workspace-fs/root'
import { createLogger } from '@freecut/shared/logging/logger'
import { getNativeWorkspaceRoot } from '@freecut/infrastructure/storage/native-file-system'
import { WorkspaceGateSplash } from './workspace-gate-splash'
import { usePathname } from './use-pathname'

/**
 * Routes that read/write the workspace and therefore need the gate to be
 * ready before their loaders run. Anything else renders freely without
 * waiting on storage initialization.
 */
function isStorageProtectedPath(pathname: string): boolean {
  return pathname.startsWith('/projects') || pathname.startsWith('/editor')
}

const logger = createLogger('WorkspaceGate')

type E2eWindow = Window & {
  luna?: {
    environment?: {
      freecutStorage?: 'disk' | 'opfs'
    }
  }
}

async function getOpfsWorkspaceRoot(): Promise<FileSystemDirectoryHandle | null> {
  const e2eWindow = window as E2eWindow
  if (e2eWindow.luna?.environment?.freecutStorage !== 'opfs') return null
  if (typeof navigator.storage?.getDirectory !== 'function') return null
  const originRoot = await navigator.storage.getDirectory()
  return originRoot.getDirectoryHandle('luna-freecut', { create: true })
}

type GateStatus =
  | { kind: 'initializing' }
  | { kind: 'unavailable' } // Non-Chromium browsers
  | { kind: 'pick' } // No saved handle
  | { kind: 'reconnect'; handleName: string } // Saved handle, permission revoked
  | { kind: 'ready' }

export function WorkspaceGate({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<GateStatus>({ kind: 'initializing' })
  const [error, setError] = useState<string | null>(null)
  const { t } = useTranslation()
  const pathname = usePathname()
  const needsWorkspace = isStorageProtectedPath(pathname)

  const activate = useCallback(async (handle: FileSystemDirectoryHandle) => {
    setWorkspaceRoot(handle)
    try {
      const { bootstrapWorkspace } = await import('@freecut/infrastructure/storage/workspace-fs/bootstrap')
      await bootstrapWorkspace(handle)
    } catch (error) {
      logger.warn('bootstrapWorkspace failed', error)
    }
    // Fire the auto-purge sweep for long-trashed projects in the
    // background — it touches disk and we don't want it to block the
    // app render. Wrapped in setTimeout so it runs after first paint.
    setTimeout(() => {
      void import('./deps/trash-auto-purge').then(({ autoPurgeExpiredTrash }) =>
        autoPurgeExpiredTrash(),
      )
    }, 0)
    setStatus({ kind: 'ready' })
    window.dispatchEvent(new Event('freecut:ensure-toaster'))
  }, [])

  // Initial load: check if we have a saved handle, check its permission.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      // OPFS is reserved for isolated browser automation. Electron production
      // uses the native app-managed workspace below.
      const e2eRoot = await getOpfsWorkspaceRoot()
      if (e2eRoot) {
        if (!cancelled) await activate(e2eRoot)
        return
      }
      const nativeRoot = await getNativeWorkspaceRoot()
      if (nativeRoot) {
        if (!cancelled) await activate(nativeRoot)
        return
      }
      if (!isFileSystemAccessSupported()) {
        if (!cancelled) setStatus({ kind: 'unavailable' })
        return
      }
      // Promote any legacy `workspace:current` into a proper known-workspace
      // record before we read it, so the indicator's "known workspaces" list
      // includes the one the user is about to use.
      await ensureKnownWorkspaceForCurrent()
      const record = await getWorkspaceHandleRecord()
      if (!record) {
        if (!cancelled) setStatus({ kind: 'pick' })
        return
      }
      const handle = record.handle as FileSystemDirectoryHandle
      const permission = await queryHandlePermission(handle)
      if (cancelled) return
      if (permission === 'granted') {
        await activate(handle)
      } else {
        setStatus({ kind: 'reconnect', handleName: record.name })
      }
    })().catch((error) => {
      logger.error('Gate initialization failed', error)
      if (!cancelled) setStatus({ kind: 'pick' })
    })
    return () => {
      cancelled = true
    }
  }, [activate])

  // Permission-lost mid-session → flip to reconnect.
  useEffect(() => {
    const unsubscribe = onPermissionLost(() => {
      void (async () => {
        const record = await getWorkspaceHandleRecord()
        setStatus({ kind: 'reconnect', handleName: record?.name ?? 'workspace' })
      })()
    })
    return () => {
      unsubscribe()
    }
  }, [])

  const handlePick = useCallback(async () => {
    setError(null)
    try {
      const handle = await window.showDirectoryPicker({
        id: 'freecut-workspace',
        mode: 'readwrite',
        startIn: 'documents',
      })
      const queryState = await queryHandlePermission(handle)
      const finalState =
        queryState === 'granted' ? queryState : await requestHandlePermission(handle)
      if (finalState !== 'granted') {
        setError(t('projects.workspaceGate.folderPermissionDenied'))
        setStatus({ kind: 'reconnect', handleName: handle.name })
        return
      }
      await saveWorkspaceHandleRecord(handle)
      await activate(handle)
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        // User cancelled the picker; stay on splash.
        return
      }
      logger.error('Folder pick failed', error)
      setError(t('projects.workspaceGate.folderPickFailed'))
    }
  }, [activate, t])

  const handleReconnect = useCallback(async () => {
    setError(null)
    const record = await getWorkspaceHandleRecord()
    if (!record) {
      setStatus({ kind: 'pick' })
      return
    }
    const handle = record.handle as FileSystemDirectoryHandle
    const permission = await requestHandlePermission(handle)
    if (permission === 'granted') {
      await activate(handle)
      return
    }
    setError(t('projects.workspaceGate.reconnectPermissionDenied'))
  }, [activate, t])

  // Routes that don't touch storage never wait on the gate — no splash, no
  // flash, even on first load while we're checking handles-db.
  if (!needsWorkspace) {
    return <>{children}</>
  }

  if (status.kind === 'ready') {
    return <>{children}</>
  }

  // On protected routes during initialization, render a bare background
  // block so the transition from "checking" to "ready" or "splash" is
  // invisible instead of a logo+spinner flash.
  if (status.kind === 'initializing') {
    return <div className="min-h-screen bg-background" aria-hidden="true" />
  }

  return (
    <WorkspaceGateSplash
      status={status}
      error={error}
      onPickFolder={handlePick}
      onReconnect={handleReconnect}
    />
  )
}
