/** Shared task guidance returned by discovery tools, not baked into handoff prompts. */
export const AGENT_SKILL_DISCOVERY_GUIDANCE = `理解用户原始要求；用户不需要选择功能，不要预设处理流程。
1. 使用 wait_for_edit_request 领取 Luna 已创建的任务，上报稳定 agentId、真实 agentType 与 agentModel，核对交接提示词中的 sessionId。若没有 Luna 交接任务而需求来自当前外部对话，使用 start_edit_session(purpose="auto", request=用户原话)。这些兼容工具名中的 edit 不代表用户要求剪辑；auto 任务领取不会打开剪辑窗口。
2. 根据 list_agent_skills 返回的 description 和用户原话选择技能，通过 get_agent_skill 读取完整 instructions。技能是可选能力，不是必须依次执行的菜单；不要为简单任务遍历无关技能。不要猜编号、路径或调用清单中没有的工具。技能声明下级查询工具时只按当前需求发现和阅读。
3. workflow 是可选的。只有用户确实要求该业务操作，且匹配技能声明了 workflow，才调用 select_task_workflow(sessionId, revision, workflow)。未声明 workflow 的应用级技能直接按其工具指引执行，auto 可保持 auto；不为读取指引、记录信息或报告进度打开剪辑。读取另一技能不会扩大当前任务目标。技能没有匹配或所需工具未提供时，如实报告能力缺失并停止该步骤，不切换其他业务、猜路径或反复等待；只有用户需求不明确才澄清。已选业务流程不能静默切换。
4. 所有任务都可继续。后续用户要求用 update_task_request(sessionId, revision, request=用户原话) 沿用原任务记录，再 get_edit_request 读取新版本并重新发现匹配技能；只有技能声明且任务需要时才选择 workflow。完成、失败、停止只是本次执行结果。旧执行与导出确认不能自动恢复，不能替用户改写意图。其他任务正在执行时先等待或由用户停止。
5. 使用 report_edit_progress 和 report_edit_result 更新 Luna；简单任务直接执行、验证和报告，不逐条播报工具发现或连接过程。对用户用其语言简短说明实际结果或必要澄清。没有成功保存不能说已记住，没有生成视频不能说剪辑完成。后续沟通在当前外部 Agent 中进行；失败、取消或缺少能力时如实报告。
6. requestChanged/REQUEST_UPDATED 时先 get_edit_request；USER_STOPPED 时立即停止。读取技能不授予写入权限，也不绕过 session、revision、取消或导出确认。不要直接读写项目文件或自行安装依赖替代服务工具。`
