import { describe, expect, it, vi } from "vitest";
import type { EditingHost, MulticamHostBridge } from "./host";
import { executeTool } from "./executor";
import { getTool, toMcpTools } from "./registry";
import type { MulticamManifest } from "@openreel/core";

function bridge(): MulticamHostBridge {
  const manifest: MulticamManifest = {
    spec: "openreel-multicam/v1",
    fps: 25,
    sync: { method: "audio-crosscorr", reference: "wide" },
    participants: [
      { id: "p1", name: "A", audio: "a", seat: "left" },
      { id: "p2", name: "B", audio: "b", seat: "right" },
    ],
    cameras: [
      { id: "a", type: "closeup", subject: "p1", file: "a.mp4" },
      { id: "b", type: "closeup", subject: "p2", file: "b.mp4" },
      { id: "wide", type: "wide", subject: "all", file: "wide.mp4" },
    ],
    constraints: {
      min_shot_ms: 1_800,
      max_shot_ms: 25_000,
      cut_lead_ms: 120,
      reaction_shot_after_ms: 12_000,
      forbid_jump_cut_same_subject: true,
    },
  };
  return {
    getManifest: vi.fn(async () => ({
      groupId: "g1",
      manifest,
    })),
    getActivityMap: vi.fn(),
    getTranscript: vi.fn(),
    setEditPolicy: vi.fn(async (_groupId, policy) => ({ policy })),
    annotateSegment: vi.fn(),
    getEditSummary: vi.fn(),
    overrideCut: vi.fn(async () => ({ cuts: 2 })),
    previewFrame: vi.fn(async () => ({ ok: true, data: { dataUrl: "data:image/png;base64,AA==" } })),
  };
}

describe("multicam agent and MCP tools", () => {
  it("publishes the narrow issue #92 tool surface", () => {
    const names = [
      "get_project_manifest",
      "get_activity_map",
      "get_transcript",
      "set_edit_policy",
      "annotate_segment",
      "get_edit_summary",
      "override_cut",
      "preview_frame",
    ];
    expect(names.every((name) => getTool(name))).toBe(true);
    expect(names.every((name) => toMcpTools().some((tool) => tool.name === name))).toBe(true);
    expect(getTool("set_edit_policy")?.destructive).toBe(true);
    expect(getTool("override_cut")?.destructive).toBe(true);
  });

  it("routes manifest reads through the host bridge", async () => {
    const multicam = bridge();
    const result = await executeTool(
      "get_project_manifest",
      { groupId: "g1" },
      { multicam } as unknown as EditingHost,
    );

    expect(result.ok).toBe(true);
    expect(multicam.getManifest).toHaveBeenCalledWith("g1");
  });

  it("enforces policy and cut bounds before invoking the host", async () => {
    const multicam = bridge();
    const host = { multicam } as unknown as EditingHost;
    const invalidPolicy = await executeTool(
      "set_edit_policy",
      { groupId: "g1", commitMs: 9_000 },
      host,
    );
    const invalidNudge = await executeTool(
      "override_cut",
      { groupId: "g1", switchId: "s1", operation: "nudge", deltaMs: 3_000 },
      host,
    );
    const valid = await executeTool(
      "set_edit_policy",
      { groupId: "g1", strategy: "composite", commitMs: 400 },
      host,
    );

    expect(invalidPolicy.ok).toBe(false);
    expect(invalidNudge.ok).toBe(false);
    expect(valid.ok).toBe(true);
    expect(multicam.setEditPolicy).toHaveBeenCalledWith(
      "g1",
      expect.objectContaining({ strategy: "composite", commitMs: 400 }),
    );
  });
});
