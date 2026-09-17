import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Track } from "@openreel/core";
import { createEmptyProject } from "../../../stores/project/project-helpers";
import { useProjectStore } from "../../../stores/project-store";
import { TrackHeader } from "./TrackHeader";

function audioTrack(id: string, name: string): Track {
  return {
    id,
    type: "audio",
    name,
    clips: [
      {
        id: `${id}-clip`,
        mediaId: `${id}-media`,
        trackId: id,
        startTime: 0,
        duration: 5,
        inPoint: 0,
        outPoint: 5,
        effects: [],
        audioEffects: [],
        transform: {
          position: { x: 0.5, y: 0.5 },
          scale: { x: 1, y: 1 },
          rotation: 0,
          anchor: { x: 0.5, y: 0.5 },
          opacity: 1,
        },
        volume: 1,
        keyframes: [],
      },
    ],
    transitions: [],
    locked: false,
    hidden: false,
    muted: false,
    solo: false,
  };
}

const noop = () => undefined;

function renderHeader(track: Track) {
  return render(
    <TrackHeader
      track={track}
      index={0}
      onDragStart={noop}
      onDragOver={noop}
      onDrop={noop}
      onDragEnd={noop}
    />,
  );
}

describe("TrackHeader audio controls", () => {
  beforeEach(() => {
    const project = createEmptyProject("Audio controls");
    useProjectStore.setState({
      hasOpenProject: true,
      project: {
        ...project,
        mediaLibrary: {
          items: ["dialogue", "music"].map((id) => ({
            id: `${id}-media`,
            name: id,
            type: "audio" as const,
            fileHandle: null,
            blob: null,
            metadata: {
              duration: 5,
              width: 0,
              height: 0,
              frameRate: 0,
              codec: "aac",
              sampleRate: 48_000,
              channels: 2,
              fileSize: 1,
            },
            thumbnailUrl: null,
            waveformData: null,
          })),
        },
        timeline: {
          ...project.timeline,
          tracks: [audioTrack("dialogue", "Dialogue"), audioTrack("music", "Music")],
        },
      },
    });
    useProjectStore.getState().actionExecutor.getHistory().clear();
  });

  afterEach(() => {
    cleanup();
    useProjectStore.setState({ hasOpenProject: false });
  });

  it("exposes solo directly in the timeline and persists it undoably", async () => {
    renderHeader(useProjectStore.getState().project.timeline.tracks[0]);

    expect(screen.getByText("Dialogue")).toHaveClass("cursor-grab");

    fireEvent.click(screen.getByRole("button", { name: "Solo Dialogue" }));

    await waitFor(() => {
      expect(useProjectStore.getState().project.timeline.tracks[0]?.solo).toBe(true);
      expect(useProjectStore.getState().actionExecutor.getHistory().canUndo()).toBe(true);
    });
  });

  it("uses explicit mute state and accessible track-specific labels", async () => {
    const view = renderHeader(useProjectStore.getState().project.timeline.tracks[1]);

    fireEvent.click(screen.getByRole("button", { name: "Mute Music" }));
    await waitFor(() => {
      expect(useProjectStore.getState().project.timeline.tracks[1]?.muted).toBe(true);
    });

    view.rerender(
      <TrackHeader
        track={useProjectStore.getState().project.timeline.tracks[1]}
        index={1}
        onDragStart={noop}
        onDragOver={noop}
        onDrop={noop}
        onDragEnd={noop}
      />,
    );
    expect(screen.getByRole("button", { name: "Unmute Music" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});
