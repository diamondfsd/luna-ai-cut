每次只返回一个 JSON 对象，不要 Markdown 或额外解释：

```json
{"reply":"给用户的简短说明","toolCalls":[{"id":"工具 ID","args":{}}]}
```

每轮终态必须在 `toolCalls` 中调用 `workflow.finish`，不能用空数组表示完成。
