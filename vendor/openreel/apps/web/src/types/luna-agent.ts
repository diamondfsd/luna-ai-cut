export type OpenReelAgentSessionStatus = "queued" | "running" | "completed" | "failed" | "cancelled";
export type OpenReelAgentPhase =
  | "waiting"
  | "analyzing_media"
  | "creating_project"
  | "importing_media"
  | "editing"
  | "captioning"
  | "saving"
  | "exporting"
  | "completed"
  | "failed"
  | "cancelled";

export interface OpenReelAgentSession {
  sessionId: string;
  request: string;
  revision: number;
  projectId: string | null;
  status: OpenReelAgentSessionStatus;
  phase: OpenReelAgentPhase;
  progress: number;
  message: string;
  createdAt: string;
  updatedAt: string;
  cancelRequested: boolean;
  agentId: string | null;
  agentType: string | null;
  agentModel: string | null;
  exportConfirmation: "idle" | "pending";
  result?: {
    projectId?: string;
    projectName?: string;
    exportPath?: string;
    summary?: string;
  };
}

export interface OpenReelAgentEvent {
  type: "session-created" | "session-claimed" | "request-updated" | "progress" | "result" | "error" | "cancel-requested" | "cancelled" | "export-confirmation-required" | "export-confirmed" | "export-denied" | "tool-start" | "tool-finished";
  sequence: number;
  timestamp: string;
  session: OpenReelAgentSession;
  message?: string;
  callId?: string;
  toolName?: string;
  args?: Record<string, unknown>;
  ok?: boolean;
  summary?: string;
  error?: {
    code: string;
    message: string;
    retryable?: boolean;
    suggestedAction?: string;
  };
  durationMs?: number;
}

export interface OpenReelAgentSnapshot {
  session: OpenReelAgentSession | null;
  events: OpenReelAgentEvent[];
}

export interface OpenReelAgentApi {
  openChat(context: { purpose: 'editing' | 'director-plan'; request?: string; projectId?: string | null }): Promise<void>;
  generatePrompt(request: string): Promise<string>;
  createRequest(request: string, projectId?: string | null): Promise<OpenReelAgentSession>;
  updateRequest(sessionId: string, request: string): Promise<OpenReelAgentSession>;
  cancelRequest(sessionId: string): Promise<OpenReelAgentSession>;
  confirmExport(sessionId: string): Promise<OpenReelAgentSession>;
  denyExport(sessionId: string): Promise<OpenReelAgentSession>;
  getSnapshot(): Promise<OpenReelAgentSnapshot>;
  onEvent(handler: (event: OpenReelAgentEvent) => void): () => void;
  onActivate(handler: () => void): () => void;
}

