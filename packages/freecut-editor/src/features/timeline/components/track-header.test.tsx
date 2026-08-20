import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'

import type { TimelineTrack } from '@freecut/types/timeline'

import { useItemsStore } from '../stores/items-store'
import { TrackHeader } from './track-header'

vi.mock('../hooks/use-track-drag', () => ({
  useTrackDrag: () => ({
    handleDragStart: () => undefined,
  }),
}))

function makeTrack(overrides: Partial<TimelineTrack> = {}): TimelineTrack {
  return {
    id: 'track-1',
    name: 'V1',
    kind: 'video',
    height: 72,
    locked: false,
    visible: true,
    muted: false,
    solo: false,
    volume: 0,
    order: 0,
    items: [],
    ...overrides,
  }
}

function renderTrackHeader(track: TimelineTrack, onToggleDisabled = vi.fn()) {
  const renderResult = render(
    <TrackHeader
      track={track}
      isActive={false}
      isSelected={false}
      canDeleteTrack
      canDeleteEmptyTracks
      onToggleLock={() => undefined}
      onToggleSyncLock={() => undefined}
      onToggleDisabled={onToggleDisabled}
      onToggleSolo={() => undefined}
      onSelect={() => undefined}
      onCloseGaps={() => undefined}
      onAddVideoTrack={() => undefined}
      onAddAudioTrack={() => undefined}
      onDeleteTrack={() => undefined}
      onDeleteEmptyTracks={() => undefined}
    />,
  )

  return { ...renderResult, onToggleDisabled }
}

describe('TrackHeader', () => {
  beforeEach(() => {
    useItemsStore.getState().setItems([])
  })

  it('renders a unified disable control for video tracks', () => {
    const { onToggleDisabled } = renderTrackHeader(
      makeTrack({ kind: 'video', visible: true, muted: false }),
    )

    expect(screen.getByRole('button', { name: '禁用轨道' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '隐藏轨道' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '静音轨道' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '禁用轨道' }))

    expect(onToggleDisabled).toHaveBeenCalledTimes(1)
  })

  it('derives the disable state from audio mute status', () => {
    const { container } = renderTrackHeader(
      makeTrack({ id: 'track-2', name: 'A1', kind: 'audio', muted: true }),
    )

    expect(screen.getByRole('button', { name: '启用轨道' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '显示轨道' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '取消静音' })).not.toBeInTheDocument()
    expect(container.querySelector('[data-track-id="track-2"]')).toHaveAttribute(
      'data-track-disabled',
      'true',
    )
  })

  it('calls onToggleDisabled when clicking Enable track on a muted audio track', () => {
    const onToggleDisabled = vi.fn()
    renderTrackHeader(
      makeTrack({ id: 'track-3', name: 'A2', kind: 'audio', muted: true }),
      onToggleDisabled,
    )

    fireEvent.click(screen.getByRole('button', { name: '启用轨道' }))

    expect(onToggleDisabled).toHaveBeenCalledTimes(1)
  })

  it('renders sync lock enabled by default and toggles the label when disabled', () => {
    const { container, rerender } = render(
      <TrackHeader
        track={makeTrack()}
        isActive={false}
        isSelected={false}
        canDeleteTrack
        canDeleteEmptyTracks
        onToggleLock={() => undefined}
        onToggleSyncLock={() => undefined}
        onToggleDisabled={() => undefined}
        onToggleSolo={() => undefined}
        onSelect={() => undefined}
        onCloseGaps={() => undefined}
        onAddVideoTrack={() => undefined}
        onAddAudioTrack={() => undefined}
        onDeleteTrack={() => undefined}
        onDeleteEmptyTracks={() => undefined}
      />,
    )

    const trackHeader = container.querySelector('[data-track-id]')
    expect(trackHeader).not.toBeNull()

    fireEvent.contextMenu(trackHeader as HTMLElement)
    expect(screen.getByRole('menuitem', { name: '禁用同步锁定' })).toBeInTheDocument()

    fireEvent.keyDown(document.body, { key: 'Escape' })

    rerender(
      <TrackHeader
        track={makeTrack({ syncLock: false })}
        isActive={false}
        isSelected={false}
        canDeleteTrack
        canDeleteEmptyTracks
        onToggleLock={() => undefined}
        onToggleSyncLock={() => undefined}
        onToggleDisabled={() => undefined}
        onToggleSolo={() => undefined}
        onSelect={() => undefined}
        onCloseGaps={() => undefined}
        onAddVideoTrack={() => undefined}
        onAddAudioTrack={() => undefined}
        onDeleteTrack={() => undefined}
        onDeleteEmptyTracks={() => undefined}
      />,
    )

    fireEvent.contextMenu(trackHeader as HTMLElement)
    expect(screen.getByRole('menuitem', { name: '启用同步锁定' })).toBeInTheDocument()
  })
})
