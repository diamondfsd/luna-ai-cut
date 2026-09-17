import { describe, expect, it, vi } from "vitest";
import {
  annotateContactSheet,
  buildContactSheetIndexText,
  type ContactSheetAnnotationCell,
  type ContactSheetAnnotationFrame,
} from "./contact-sheet-annotation";

const cell = (sheetIndex: number, frameId: string): ContactSheetAnnotationCell => ({
  frameId,
  sheetIndex,
  x: 6 + sheetIndex * 326,
  y: 6,
  width: 320,
  height: 180,
});

const frame = (overrides: Partial<ContactSheetAnnotationFrame> = {}): ContactSheetAnnotationFrame => ({
  frameId: "media-a#0",
  mediaId: "media-a",
  frameIndex: 0,
  timeSec: 12.5,
  name: "clip-a.mp4",
  kind: "video",
  capturedAt: "2026-08-29T14:33:21+08:00",
  base64: "frame",
  ...overrides,
});

describe("contact-sheet-annotation", () => {
  it("formats stable labels and a readable index", () => {
    const text = buildContactSheetIndexText(
      [frame({ frameId: "media-b#0", mediaId: "media-b", name: "clip-b.jpg", kind: "image", capturedAt: null }), frame()],
      [cell(0, "media-a#0"), cell(1, "media-b#0")],
    );

    expect(text).toContain("#01 | clip-a.mp4 | VIDEO | 时间 00:12.5 | mediaId=media-a | frameId=media-a#0");
    expect(text).toContain("#02 | clip-b.jpg | PHOTO | 拍摄 未知 | mediaId=media-b | frameId=media-b#0");
    expect(text.indexOf("#01")).toBeLessThan(text.indexOf("#02"));
  });

  it("draws labels over source frames when browser canvas is available", async () => {
    const fillText = vi.fn();
    const context = {
      fillStyle: "",
      font: "",
      measureText: (value: string) => ({ width: value.length * 7 }),
      fillRect: vi.fn(),
      drawImage: vi.fn(),
      fillText,
    } as unknown as CanvasRenderingContext2D;
    const originalGetContext = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, "getContext");
    const originalToDataURL = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, "toDataURL");
    const originalImage = globalThis.Image;

    class ImageMock {
      naturalWidth = 320;
      naturalHeight = 180;
      width = 320;
      height = 180;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;

      set src(_value: string) {
        queueMicrotask(() => this.onload?.());
      }
    }

    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      configurable: true,
      value: () => context,
    });
    Object.defineProperty(HTMLCanvasElement.prototype, "toDataURL", {
      configurable: true,
      value: () => "data:image/jpeg;base64,annotated",
    });
    vi.stubGlobal("Image", ImageMock);

    try {
      const result = await annotateContactSheet({
        base64: "original",
        mimeType: "image/jpeg",
        width: 332,
        height: 192,
        cells: [cell(0, "media-a#0")],
      }, [frame()]);

      expect(result).toEqual({ base64: "annotated", labeled: true });
      expect(context.drawImage).toHaveBeenCalledOnce();
      expect(fillText).toHaveBeenCalledWith("#01", 14, 164);
      expect(fillText).toHaveBeenCalledWith("clip-a.mp4", 14, 177);
    } finally {
      vi.stubGlobal("Image", originalImage);
      if (originalGetContext) Object.defineProperty(HTMLCanvasElement.prototype, "getContext", originalGetContext);
      if (originalToDataURL) Object.defineProperty(HTMLCanvasElement.prototype, "toDataURL", originalToDataURL);
    }
  });
});
