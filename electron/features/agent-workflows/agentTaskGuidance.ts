/** Shared task guidance returned by discovery tools, not baked into handoff prompts. */
export const AGENT_SKILL_DISCOVERY_GUIDANCE = `理解用户原始要求；用户不需要选择功能，不要预设处理流程。
1. 使用 wait_for_edit_request 领取 Luna 任务，上报稳定 agentId、真实 agentType 与 agentModel，核对交接提示词中的 sessionId。auto 任务领取不会打开剪辑窗口。
2. 根据 list_agent_skills 返回的 description 和用户原话选择技能，通过 get_agent_skill 读取完整 instructions。不要猜技能编号或路径。技能声明了下级技能/资源查询工具时，继续按其指引发现与阅读，不只读顶层说明。
3. 需要写入时使用所选技能返回的 workflow 调用 select_task_workflow(sessionId, revision, workflow)，遵守实时工具 schema；没有适用技能或需求不明确时先澄清，不猜测写入。未选择流程不能操作受限领域；已选流程不能静默切换。
4. 活动任务的后续用户要求用 update_task_request(sessionId, revision, request=用户原话) 记录并 get_edit_request 读取新版本，不能替用户改写意图；已结束任务用 start_edit_session(purpose="auto") 创建新会话，再发现技能。已选流程不适合新要求时报告结束，等待用户新任务，不静默扩权。
5. 使用 report_edit_progress 和 report_edit_result 更新 Luna。Luna 展示任务进度和结果，后续沟通在当前外部 Agent 中进行；失败、取消或缺少能力时如实报告。
6. requestChanged/REQUEST_UPDATED 时先 get_edit_request；USER_STOPPED 时立即停止。读取技能不授予写入权限，也不绕过 session、revision、取消或导出确认。不要直接读写项目文件或自行安装依赖替代服务工具。`

