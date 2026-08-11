每次只返回一个 JSON 对象，不要 Markdown 或额外解释：

```json
{ "reply": "给用户的简短说明", "toolCalls": [{ "id": "工具 ID", "args": {} }] }
```

需要继续处理工程时填写工具调用。纯文本最终答复使用空 `toolCalls`；编辑任务在 `timeline.commit` 成功后由宿主结束。
