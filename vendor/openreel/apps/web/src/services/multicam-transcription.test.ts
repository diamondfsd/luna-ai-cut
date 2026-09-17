import { describe, expect, it } from "vitest";
import { sherpaCuesToMulticamTranscript } from "./multicam-transcription";

describe("multicam transcription", () => {
  it("normalizes Sherpa timestamps and removes empty cues", () => {
    expect(sherpaCuesToMulticamTranscript([
      { text: " Hello ", startMs: 250, endMs: 1_500 },
      { text: "  ", startMs: 1_500, endMs: 2_000 },
      { text: "world", startMs: 2_000, endMs: 0 },
    ])).toEqual([
      { text: "Hello", startMs: 250, endMs: 1_500 },
      { text: "world", startMs: 2_000, endMs: 5_000 },
    ]);
  });
});
