export const AGENT_TASK_TOOLS = [
  {
    name: 'start_edit_session',
    description: 'Create and immediately claim an editing session for a request that came from outside Luna AI Cut. Include the exact user request, a stable agentId, the Agent category, and the actual model name; do not invent a sessionId or identity.',
    inputSchema: {
      type: 'object',
      properties: {
        request: { type: 'string', minLength: 1, description: 'The exact user editing request received by the external Agent.' },
        agentId: { type: 'string', minLength: 1, description: 'Stable identifier for this external Agent.' },
        agentType: { type: 'string', minLength: 1, description: 'Agent category or role, for example WorkBuddy external editing Agent.' },
        agentModel: { type: 'string', minLength: 1, description: 'The model name actually used by this Agent.' },
        purpose: { type: 'string', enum: ['auto', 'editing', 'director-plan'], description: 'Task type. Director-plan tasks never activate the editor.' },
        projectId: { type: 'string', description: 'Optional existing project id to associate with the session.' },
      },
      required: ['request', 'agentId', 'agentType', 'agentModel'],
      additionalProperties: false,
    },
  },
  {
    name: 'wait_for_edit_request',
    description: 'Wait for and claim the latest user editing request from Luna AI Cut. Register the Agent identity when waiting or claiming.',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: { type: 'string', minLength: 1, description: 'Stable identifier for this external Agent.' },
        agentType: { type: 'string', minLength: 1, description: 'Agent category or role, for example WorkBuddy external editing Agent.' },
        agentModel: { type: 'string', minLength: 1, description: 'The model name actually used by this Agent.' },
        timeoutSec: { type: 'number', minimum: 5, maximum: 900, description: 'How long to wait when there is no queued request. Defaults to 300 seconds.' },
      },
      required: ['agentId', 'agentType', 'agentModel'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_edit_request',
    description: 'Get the latest user editing request and revision. Call this whenever the user changes the request or before a major editing phase.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string' },
        knownRevision: { type: 'integer', minimum: 1 },
      },
      required: ['sessionId'],
      additionalProperties: false,
    },
  },
  {
    name: 'report_edit_progress',
    description: 'Report the current editing phase and progress to Luna AI Cut. Do not write a natural-language status reply instead of using this tool.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string' },
        revision: { type: 'integer', minimum: 1 },
        phase: { type: 'string', enum: ['waiting', 'analyzing_media', 'creating_project', 'importing_media', 'editing', 'captioning', 'saving', 'exporting'] },
        progress: { type: 'number', minimum: 0, maximum: 100 },
        message: { type: 'string' },
      },
      required: ['sessionId', 'revision', 'phase', 'progress', 'message'],
      additionalProperties: false,
    },
  },
  {
    name: 'report_edit_result',
    description: 'Report the final edit result to Luna AI Cut. The Luna chat page uses this structured result as the authoritative completion message.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string' },
        revision: { type: 'integer', minimum: 1 },
        status: { type: 'string', enum: ['completed', 'failed', 'cancelled'] },
        summary: { type: 'string' },
        projectId: { type: 'string' },
        projectName: { type: 'string' },
        exportPath: { type: 'string' },
      },
      required: ['sessionId', 'revision', 'status'],
      additionalProperties: false,
    },
  },
  {
    name: 'activate_luna_window',
    description: 'Notify Luna AI Cut to open the AI editing page and show the external Agent progress panel without bringing the app to the foreground.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'list_music_templates',
    description: 'List built-in background-music templates. Use this before writing a Music DSL when the user asks for music, BGM, or a stronger rhythmic edit.',
    inputSchema: {
      type: 'object',
      properties: {
        tag: { type: 'string', description: 'Optional template tag such as travel, cinematic, upbeat, or dialogue-safe.' },
        scene: { type: 'string', description: 'Optional scene tag such as travel, documentary, product, or holiday.' },
        dialogueSafe: { type: 'boolean', description: 'When true, only return arrangements suitable under narration or dialogue.' },
        limit: { type: 'integer', minimum: 1, maximum: 100, description: 'Maximum number of templates to return. Defaults to 50.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_music_template',
    description: 'Get one built-in music template and its editable compact Music DSL. Adapt the DSL instead of returning or rendering the original user request.',
    inputSchema: {
      type: 'object',
      properties: {
        templateId: { type: 'string', minLength: 1, description: 'Template id returned by list_music_templates.' },
      },
      required: ['templateId'],
      additionalProperties: false,
    },
  },
  {
    name: 'generate_background_music',
    description: 'Render a compact Music DSL to an instrumental WAV inside Luna, register it as local audio media, and return the mediaId to import with import_local_media. Do not pass a natural-language brief or JSON note array.',
    inputSchema: {
      type: 'object',
      properties: {
        dsl: { type: 'string', minLength: 1, description: 'A compact video-bgm DSL document. Start with bgm 1, then duration, tempo, meter, sections, and tracks.' },
        name: { type: 'string', maxLength: 120, description: 'Optional user-facing file name without a path.' },
      },
      required: ['dsl'],
      additionalProperties: false,
    },
  },
  {
    name: 'cancel_edit_request',
    description: 'Cancel an active Luna editing request when the user asks the Agent to stop.',
    inputSchema: {
      type: 'object',
      properties: { sessionId: { type: 'string' } },
      required: ['sessionId'],
      additionalProperties: false,
    },
  },
] as const

