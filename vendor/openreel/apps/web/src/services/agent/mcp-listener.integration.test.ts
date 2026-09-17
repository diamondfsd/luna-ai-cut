import { describe, it, expect, vi } from "vitest";

// No @openreel/agent mock here: exercises the real registry and host wiring.

vi.mock("./host-singleton", () => ({
  getLiveEditorHost: () => ({
    requireOpenProject: () => {
      throw new Error("No project is open");
    },
  }),
  runExclusive: (fn: () => Promise<unknown>) => fn(),
}));

import { handleMcpBridgeRequest } from "./mcp-listener";

describe("handleMcpBridgeRequest (real registry)", () => {
  it("listTools returns the real registry", async () => {
    const res = await handleMcpBridgeRequest({ callId: "c", kind: "listTools" });
    expect(res.ok).toBe(true);
    expect((res.result as unknown[]).length).toBeGreaterThan(10);
  });

  it("requires confirmation before deleting media", async () => {
    await handleMcpBridgeRequest({
      callId: "skill",
      kind: "callTool",
      name: "get_editing_skill",
      args: {},
    });
    const res = await handleMcpBridgeRequest({
      callId: "c",
      kind: "callTool",
      name: "delete_media",
      args: { mediaId: "m1" },
    });
    expect(res.ok).toBe(true);
    expect((res.result as { error?: { code: string } }).error?.code).toBe(
      "CONFIRMATION_REQUIRED",
    );
  });
});
