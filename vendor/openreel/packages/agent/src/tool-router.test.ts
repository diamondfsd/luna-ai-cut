import { describe, expect, it } from "vitest";
import { getTool, toOpenAITools } from "./registry";
import { DEFAULT_AGENT_TOOL_LIMIT, selectToolsForPrompt } from "./tool-router";

describe("agent tool router", () => {
  it("keeps ordinary timeline editing under provider tool limits", () => {
    const names = selectToolsForPrompt("Trim the first clip, add captions, and fade the audio");
    expect(names.length).toBeLessThanOrEqual(DEFAULT_AGENT_TOOL_LIMIT);
    expect(names).toContain("trim_clip");
    expect(names).toContain("add_subtitle");
    expect(names).toContain("set_clip_fade");
    expect(names).toContain("get_editor_state");
    expect(names).toContain("execute_action");
    expect(toOpenAITools(names)).toHaveLength(names.length);
  });

  it("routes motion requests to motion tools without losing core inspection", () => {
    const names = selectToolsForPrompt(
      "Create a motion composition with animated text layers, masks, and keyframes",
    );
    expect(names.length).toBeLessThanOrEqual(DEFAULT_AGENT_TOOL_LIMIT);
    expect(names).toContain("create_motion_composition");
    expect(names).toContain("add_motion_layer");
    expect(names).toContain("get_editor_state");
    expect(names.some((name) => getTool(name)?.domain === "motion")).toBe(true);
  });

  it("routes 3D product work to semantic creation tools", () => {
    const names = selectToolsForPrompt(
      "Build a cinematic 3D product scene with an exploded view and brushed metal materials",
    );
    expect(names.length).toBeLessThanOrEqual(DEFAULT_AGENT_TOOL_LIMIT);
    expect(names).toContain("create_product_cinematic_scene");
    expect(names).toContain("animate_creation_exploded_view");
    expect(names).toContain("apply_creation_material_preset");
  });

  it("retains tools used earlier in a follow-up conversation", () => {
    const names = selectToolsForPrompt("Make it slower", {
      maxTools: 20,
      priorToolNames: ["animate_layer"],
    });
    expect(names).toContain("animate_layer");
  });
});
