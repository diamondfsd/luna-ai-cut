import { create } from "zustand";
import type {
  OpenReelAgentEvent,
  OpenReelAgentSession,
} from "../types/global";

const TERMINAL_STATUSES = new Set<OpenReelAgentSession["status"]>([
  "completed",
  "failed",
  "cancelled",
]);
const MAX_VISIBLE_EVENTS = 120;

export interface ExternalAgentState {
  available: boolean;
  initialized: boolean;
  session: OpenReelAgentSession | null;
  awaitingAgent: boolean;
  promptGenerated: boolean;
  events: OpenReelAgentEvent[];
  lastSequence: number;
  error: string | null;
  initialize: () => Promise<void>;
  submit: (request: string, projectId?: string | null) => Promise<void>;
  cancel: () => Promise<void>;
  confirmExport: () => Promise<void>;
  denyExport: () => Promise<void>;
  markPromptGenerated: () => void;
  clearError: () => void;
}

let initializationPromise: Promise<void> | null = null;
let unsubscribeFromAgent: (() => void) | null = null;

function agentBridge(): NonNullable<typeof window.openreel>["lunaAgent"] {
  return window.openreel?.lunaAgent;
}

function applyEvent(event: OpenReelAgentEvent): void {
  useExternalAgentStore.setState((state) => {
    if (event.sequence <= state.lastSequence) return state;
    const isNewSession = state.session?.sessionId !== event.session.sessionId;
    const startsSession = event.type === "session-created"
      || event.type === "session-claimed"
      || event.type === "request-updated";
    const clearsError = isNewSession
      || startsSession
      || event.type === "tool-start"
      || (event.type === "tool-finished" && event.ok !== false);
    return {
      session: event.session,
      awaitingAgent: event.type === "session-created" || event.type === "session-claimed"
        ? false
        : state.awaitingAgent,
      events: [...state.events, event].slice(-MAX_VISIBLE_EVENTS),
      lastSequence: event.sequence,
      error: event.type === "error"
        ? event.message ?? "外部 Agent 执行失败"
        : clearsError
          ? null
          : state.error,
    };
  });
}

export const useExternalAgentStore = create<ExternalAgentState>((set, get) => ({
  available: false,
  initialized: false,
  session: null,
  awaitingAgent: false,
  promptGenerated: false,
  events: [],
  lastSequence: 0,
  error: null,

  initialize: async () => {
    if (get().initialized) return;
    if (initializationPromise) return initializationPromise;
    initializationPromise = (async () => {
      const bridge = agentBridge();
      if (!bridge) {
        set({ available: false, initialized: true });
        return;
      }
      set({ available: true });
      try {
        const snapshot = await bridge.getSnapshot();
        const orderedEvents = [...snapshot.events].sort((a, b) => a.sequence - b.sequence);
        const lastSequence = orderedEvents.at(-1)?.sequence ?? 0;
        set({
          session: snapshot.session,
          promptGenerated: Boolean(snapshot.session) || get().promptGenerated,
          awaitingAgent: snapshot.session ? false : get().awaitingAgent,
          events: orderedEvents.slice(-MAX_VISIBLE_EVENTS),
          lastSequence,
          initialized: true,
          error: null,
        });
        unsubscribeFromAgent?.();
        unsubscribeFromAgent = bridge.onEvent(applyEvent);
      } catch (error) {
        set({
          initialized: true,
          error: error instanceof Error ? error.message : "无法连接外部 Agent 任务服务",
        });
      }
    })().finally(() => {
      initializationPromise = null;
    });
    return initializationPromise;
  },

  submit: async (request: string, projectId?: string | null) => {
    const bridge = agentBridge();
    if (!bridge) {
      set({ error: "当前页面不支持外部 Agent" });
      return;
    }
    const trimmed = request.trim();
    if (!trimmed) return;
    set({ error: null, available: true });
    try {
      const current = get().session;
      const next = current && !TERMINAL_STATUSES.has(current.status)
        ? await bridge.updateRequest(current.sessionId, trimmed)
        : await bridge.createRequest(trimmed, projectId ?? null);
      set({ session: next, error: null });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "无法提交剪辑要求" });
    }
  },

  cancel: async () => {
    const bridge = agentBridge();
    const session = get().session;
    if (!bridge || !session || TERMINAL_STATUSES.has(session.status)) return;
    try {
      const next = await bridge.cancelRequest(session.sessionId);
      set({ session: next, error: null });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "无法停止剪辑任务" });
    }
  },

  confirmExport: async () => {
    const bridge = agentBridge();
    const session = get().session;
    if (!bridge || !session || session.exportConfirmation !== "pending") return;
    try {
      const next = await bridge.confirmExport(session.sessionId);
      set({ session: next, error: null });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "无法确认导出" });
    }
  },

  denyExport: async () => {
    const bridge = agentBridge();
    const session = get().session;
    if (!bridge || !session || session.exportConfirmation !== "pending") return;
    try {
      const next = await bridge.denyExport(session.sessionId);
      set({ session: next, error: null });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "无法取消导出" });
    }
  },

  markPromptGenerated: () => set({ awaitingAgent: true, promptGenerated: true, error: null }),

  clearError: () => set({ error: null }),
}));
