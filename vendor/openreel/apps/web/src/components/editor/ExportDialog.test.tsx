import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SourceExportMatch } from "../../services/export-source-match";
import { ExportDialog } from "./ExportDialog";

vi.mock("@openreel/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@openreel/core")>();
  return {
    ...actual,
    estimateExportTime: vi.fn(() => null),
    getCodecRecommendations: vi.fn(() => []),
    getDeviceProfile: vi.fn(() => new Promise<never>(() => undefined)),
  };
});

const SOURCE_MATCH: SourceExportMatch = {
  width: 4000,
  height: 2400,
  frameRate: 30,
  bitrate: 60_000,
  sourceName: "source-match.mp4",
};

describe("ExportDialog", () => {
  afterEach(() => {
    cleanup();
  });

  it("keeps the source-match shortcut in the presets view", () => {
    render(
      <ExportDialog
        isOpen
        onClose={vi.fn()}
        onExport={vi.fn()}
        duration={1}
        sourceMatch={SOURCE_MATCH}
      />,
    );

    expect(screen.getByTestId("quick-export-card")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: "Custom Settings" }));

    expect(screen.queryByTestId("quick-export-card")).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Quality & encoding" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Audio" })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Enhance quality" }),
    ).toBeInTheDocument();
  });

  it("exports source settings from the quick action", () => {
    const onClose = vi.fn();
    const onExport = vi.fn();

    render(
      <ExportDialog
        isOpen
        onClose={onClose}
        onExport={onExport}
        duration={1}
        sourceMatch={SOURCE_MATCH}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Quick Export" }));

    expect(onExport).toHaveBeenCalledWith(
      expect.objectContaining({
        format: "mp4",
        codec: "h264",
        width: 4000,
        height: 2400,
        frameRate: 30,
        bitrate: 60_000,
      }),
    );
    expect(onClose).toHaveBeenCalledOnce();
  });
});
