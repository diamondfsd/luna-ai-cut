import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vite-plus/test'

import type { TimelineTrack } from '@freecut/types/timeline'

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
  it('renders a unified disable control for video tracks', () => {
    const { onToggleDisabled } = renderTrackHeader(
      makeTrack({ kind: 'video', visible: true, muted: false }),
    )

    expect(screen.getByRole('button', { name: 'Disable track' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Hide track' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Mute track' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Disable track' }))

    expect(onToggleDisabled).toHaveBeenCalledTimes(1)
  })

  it('derives the disable state from audio mute status', () => {
    const { container } = renderTrackHeader(
      makeTrack({ id: 'track-2', name: 'A1', kind: 'audio', muted: true }),
    )

    expect(screen.getByRole('button', { name: 'Enable track' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Show track' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Unmute track' })).not.toBeInTheDocument()
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

    fireEvent.click(screen.getByRole('button', { name: 'Enable track' }))

    expect(onToggleDisabled).toHaveBeenCalledTimes(1)
  })

  it('keeps the lower-frequency sync lock action in the context menu', () => {
    const { container } = render(
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

    expect(screen.queryByRole('button', { name: 'Disable sync lock' })).not.toBeInTheDocument()
    fireEvent.contextMenu(container.querySelector('[data-track-id="track-1"]')!)
    expect(screen.getByRole('menuitem', { name: 'Disable sync lock' })).toBeInTheDocument()
  })
})
