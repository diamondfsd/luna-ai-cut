# Director Plan Markdown: current import contract

This profile reflects `src/lib/directorPlanImport.ts`, not a general Markdown document schema. Use it for new plans or appended shots. It is not an ID-preserving update format.

```markdown
# 露营一天
主要内容：从抵达到搭建营地，以日落结束。自然、轻快。

## 01 抵达营地
画面说明：人物携带装备进入营地，交代环境与目的地。
景别：远景
运镜说明：固定机位，让人物进入画面。
建议时长：4 秒
备注：先交代地点，保留有用的现场声音。

## 02 搭建帐篷
画面说明：展开帐篷、插杆和固定，覆盖动作过程与完成状态。
景别：中景与近景
运镜说明：固定机位，补拍手部动作。
建议时长：8 秒
备注：素材可粗拍，剪辑时选择互补动作；缺少完成画面时补拍。

## 03 日落收尾
画面说明：营地与日落同框，以人物停留或环境变化收束。
景别：远景
运镜说明：固定机位。
建议时长：5 秒
```

- Emit plain UTF-8 text, without prose before/after the plan or outer code fences when handing text directly to import. A chat code block is only presentation; its language-labelled opening fence is not supported import syntax.
- Use one `#` title, optional `主要内容：` before the first shot, and `## 01 镜头名称` per shot. Every level 2–6 heading is treated as a new shot, so do not add subheadings or a Markdown table.
- Use field names `画面说明`, `景别`, `运镜说明`, `建议时长`, `备注`. Additional named fields become remark text, not structured editor settings.
- Main content and field values can continue on plain text lines. Prefer concise single-line fields; bullets can be interpreted as additional shots in some positions.
- Always supply a positive edited duration with explicit `秒`. Omission defaults to 5 seconds. The parser clamps durations to 1 second–1 hour; validation should warn about clamping rather than claim the requested value was preserved.
- Maximum input is 512 KiB UTF-8 at the service boundary; at most 500 shots, 120 characters per plan/shot name and 4,000 characters per stored field/remark. Do not generate close to the limits unnecessarily.
- An imported plan creates fresh plan and shot IDs, empty takes, and pending local creation. Markdown cannot set take associations, stable IDs, locks, availability or source ranges.
- Total delivery duration, aspect ratio and style can be described in main content/remarks for humans, but are not enforced structured constraints by this parser. Keep their machine-readable counterparts in task/plan context when supported.
- Before committing through future tools, inspect parsed output and warnings. The current permissive parser accepts alternate syntax but may silently normalize fields, default durations or treat stray prose as shots; successful parsing alone does not prove intent was preserved.
