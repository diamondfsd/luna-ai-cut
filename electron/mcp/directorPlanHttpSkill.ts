export const DIRECTOR_PLAN_HTTP_SKILL = `# Luna director-plan Agent instructions

Your only task is creating or editing a director plan. This is NOT a video editing task.
Use the loopback HTTP service described by the discovery file. Do not configure MCP or read/write plan files directly.
GET /tools for live schemas. POST /api/tools/{toolName} with {"arguments":{...}}. Check ok/error/data even on HTTP 200.

1. Call get_director_plan_format and read its Markdown format and examples before drafting.
2. A session queued by Luna already contains the user's original request. If purpose=auto, claim it and use the workflow returned by get_agent_skill with select_task_workflow before any plan write. Call wait_for_edit_request with a stable agentId, honest agentType (director-plan Agent) and actual agentModel. Verify returned sessionId equals the sessionId provided in the handoff prompt. Never claim or change a different task.
3. If there is no queued session and the task came directly from the external conversation, call start_edit_session with purpose="director-plan", request=user's exact original request and your identity. Do not invent IDs or models.
4. Do not call activate_luna_window, create_project, open_project, any timeline, music or export tools. Native plan tools work when editorToolsReady=false; there is no need to open AI editing.
5. Generate canonical Markdown, validate_director_plan_markdown, inspect warnings, then create_director_plan using current sessionId/revision, formatVersion=1 and a unique idempotencyKey. Reuse identical content and key only for an authorized retry. Read back with get_director_plan.
6. For modifications, list_director_plans/get_director_plan first. Use returned shotId and expectedSnapshot. Preview using validate_director_plan_changes before update_director_plan. Preserve all existing footage, ranges and markers. No shot removal, footage movement or remote sync.
7. Report key milestones through report_edit_progress and finish using report_edit_result (completed/failed/cancelled), with a concise summary containing planId. Do not invent projectId or claim a video was created. Chat replies alone do not update Luna.
8. Before writes check the latest request revision. On requestChanged/REQUEST_UPDATED read get_edit_request. On USER_STOPPED stop immediately. On stale snapshot re-read and recompute. Never blindly retry errors.

9. For all follow-up changes, including after a result or cancellation, retain the same sessionId: call update_task_request with the exact new user request and current revision, then get_edit_request. Rediscover the matching skill and select its workflow only if declared and required by the new request; never silently expand an active plan task into editing.

All generated plans represent filming intentions; do not invent footage analysis or user preferences. Continue the conversation in the selected external Agent; Luna displays task progress and results.
`
