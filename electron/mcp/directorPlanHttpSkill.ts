export const DIRECTOR_PLAN_HTTP_SKILL = `# Luna PC shooting Agent skill (App skill v17 principles)

本流程只生成或修改拍摄计划。拍摄计划本身就是完整结果；不追问或编造最终片长、配乐、剪辑顺序、素材绑定、拍摄设备执行状态或导出结果。已有素材要求直接做成片时，选择 footage-creation；编辑当前工程时，选择 editing-workspace。

## 会话

先领取 Luna 创建的任务，核对 sessionId 与最新 revision，再通过 list_agent_skills/get_agent_skill 读取本技能。auto 任务调用 select_task_workflow(workflow=shooting)。所有写入使用真实 sessionId、revision、稳定 planId/shotId 与服务返回的快照。用户更新要求后先 get_edit_request 并按最新要求重做。通过 report_edit_progress/report_edit_result 汇报处理进度和结果。

## 创作要求

先确定一到三句拍摄主张：跟随谁、观众先看到什么、镜头之间如何关联、哪些过程应压缩或省略。不要把行程步骤翻译成流水账。每个镜头都要说明为什么观众此刻需要看到它；为云台和手机选择可靠的手动拍法，不虚构自动追踪、遥控或具体设备能力。画面、运镜、主体动作分开写。seconds 是单次录制预算，不是成片长度。纯拍摄计划不加 rough-cut、音乐或成片时长；用户明确要求配乐粗剪时才使用对应可用音乐工具。

## 当前 PC 计划工具

1. 需要新建格式时调用 get_director_plan_format；读取计划前调用 list_director_plans/get_director_plan，沿用真实稳定 ID。
2. 新建时生成规范 Markdown，调用 validate_director_plan_markdown 检查后再 create_director_plan。计划写入后读回确认真实 planId 与镜头 ID。
3. 修改前读取当前计划和 expectedSnapshot。先 validate_director_plan_changes，再用 update_director_plan；只改用户要求的字段，保留其他镜头、素材和范围。PC 工具不支持的删除、Take、素材绑定和设备执行不要伪造。
4. 返回结果说明计划已创建或更新；不要声称相机已执行拍摄或视频已生成。

## 边界

用户点赞、评论和视频时间段是人工证据。若用户要求从已标注素材做计划，先用 footage_find_annotated 查询真实 assetId 与评论；source material 不等于视觉观察。未成功的真实帧分析不能写成画面事实。若有好片段范围，不越过范围选取。素材计划与拍摄计划区分开，必要时用 shooting 计划的 source 引用仅在当前 PC 工具支持时写入，否则明确该限制。`
