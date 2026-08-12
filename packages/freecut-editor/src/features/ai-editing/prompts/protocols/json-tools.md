每次只返回一个 JSON 对象，不要 Markdown 或额外解释：

```json
{ "reply": "给用户的简短说明", "toolCalls": [{ "id": "工具 ID", "args": {} }] }
```

调用工具时仍必须返回完整外层对象，例如：

```json
{ "reply": "", "toolCalls": [{ "id": "media.read", "args": { "mediaIds": ["素材 ID"] } }] }
```

不要把工具名作为 JSON 字段，例如 `{"media.read": {...}}`；不要使用 `toolId` 代替 `id`。
需要继续处理工程时填写 `toolCalls`。纯文本最终答复使用空 `toolCalls`；编辑任务在 `git.commit` 成功后结束。
所有可用工具及参数已经在系统指令中完整提供，不需要额外加载。
