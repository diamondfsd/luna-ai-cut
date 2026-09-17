import "../../test/install-local-storage-mock";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useUIStore } from "../../stores/ui-store";

vi.mock("../../components/editor/AssetsPanel", () => ({
  AssetsPanel: () => <div>Media panel</div>,
}));
vi.mock("../../components/editor/InspectorPanel", () => ({
  InspectorPanel: () => <div>Inspector panel</div>,
}));
vi.mock("../../components/editor/Preview", () => ({
  Preview: () => <div>Preview panel</div>,
}));
vi.mock("../../components/editor/Timeline", () => ({
  Timeline: () => <div>Timeline panel</div>,
}));
vi.mock("../../components/editor/chat/ChatPanel", () => ({
  ChatPanel: ({ onClose }: { onClose?: () => void }) => (
    <div data-testid="desktop-ai-editor">
      <button type="button" onClick={onClose}>Close AI Editor</button>
    </div>
  ),
}));

import { EditPage } from "./EditPage";

describe("EditPage AI Editor dock", () => {
  beforeEach(() => {
    const panels = useUIStore.getState().panels;
    useUIStore.setState({
      panels: {
        ...panels,
        agentChat: { ...panels.agentChat, visible: true },
      },
    });
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  it("shares the right dock between inspector and chat, preserving the preview width", async () => {
    render(<EditPage />);

    expect(await screen.findByTestId("desktop-ai-editor")).toBeTruthy();
    expect(screen.getByTestId("desktop-edit-page").style.gridTemplateAreas).not.toContain("chat");
    expect(screen.getByTestId("desktop-edit-page").style.gridTemplateColumns.split(" ")).toHaveLength(3);

    fireEvent.click(screen.getByRole("tab", { name: "素材详情" }));
    expect(await screen.findByText("Inspector panel")).toBeTruthy();
    await waitFor(() => {
      expect(screen.queryByTestId("desktop-ai-editor")).toBeNull();
    });

    fireEvent.click(screen.getByRole("tab", { name: "AI 编辑器" }));
    expect(await screen.findByTestId("desktop-ai-editor")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Close AI Editor" }));

    await waitFor(() => {
      expect(screen.queryByTestId("desktop-ai-editor")).toBeNull();
    });
    expect(useUIStore.getState().panels.agentChat.visible).toBe(false);
    expect(await screen.findByText("Inspector panel")).toBeTruthy();
  });
});
