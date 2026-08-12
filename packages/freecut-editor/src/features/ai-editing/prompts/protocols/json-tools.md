每次只返回一个 JSON 对象，不要 Markdown、代码围栏、前后缀或额外解释。顶层必须且只能包含 `reply` 和 `toolCalls` 两个字段，这两个字段每次都必须提供：

```json
{ "reply": "给用户的简短说明", "toolCalls": [{ "id": "工具 ID", "args": {} }] }
```

调用工具时仍必须返回完整外层对象，例如：

```json
{ "reply": "", "toolCalls": [{ "id": "media.read", "args": { "mediaIds": ["素材 ID"] } }] }
```

每个工具调用必须且只能包含字符串 `id` 和对象 `args`。不要使用 `content`、`toolId`、`name`、`tool_calls` 等别名；不要把工具名作为 JSON 字段，例如 `{"media.read": {...}}`；不要把 `args` 编码成字符串。
需要继续处理工程时填写 `toolCalls`。纯文本最终答复使用空 `toolCalls`；编辑任务在 `git.commit` 成功后结束。
所有可用工具及参数已经在系统指令中完整提供，不需要额外加载。
