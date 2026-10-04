# AI 剪辑主进程服务

继承根目录与 `../AGENTS.md` 的领域边界。

- `aiEditorLocalMediaService.ts`：已下载素材、导演素材与生成音乐的统一发现、稳定编号及读取。
- `aiEditorDirectorMedia.ts`：本地导演计划 → 素材身份与拍摄意图关联；路径必须来自受目录限制的计划读取器。
- `aiEditorMediaAnalysisService.ts`：真实原片抽帧及联络表；携带意图上下文，不生成虚构画面结论。
- `aiEditorFrameCache.ts`：按原片身份/时间/尺寸复用抽帧，进程内限量与过期清理。
- `aiEditorMediaMetadataService.ts`：原片技术信息。
- `directorEditCoverage.ts`：读取完整计划检查镜头覆盖与显式遗漏理由。
- `directorEditPlanValidation.ts`：镜头归属、计划签名、原片时长、人工范围、非重叠与观察引用检查。
- `directorEditToolModule.ts`：`validate_director_edit_plan`、`get_director_edit_target` 和原子写入 `apply_director_edit_plan`，通过全应用注册表发现；检查前重新解析素材并探测原片时长。
- `aiEditorProjectService.ts`：AI 剪辑项目存储，与导演计划及工作台目录保持独立。

`aiEditorInspectionEvidence.ts` 保存本次进程实际抽帧时间与文件身份；原片变化、未抽取的时间或重启后要求重新分析。抽帧前后检查身份，避免分析期间换片。selectionBasis=director-plan 直接按规划组装，不要求抽帧且不接受视觉观察；visual-inspection 需要观察和区间内真实帧。两者均校验当前原片身份。方案应用会重做校验，在提交前检查任务和项目版本，通过核心单一动作写入空轨道，失败零写入并支持一次撤销/重做；clip metadata 保存来源身份、选片依据与理由。读回返回观察是否可复用；时间线重排可保留观察，选段或素材变更时失效。校验不能独立证明 Agent 的语义结论正确，不能把一次只读校验结果当作永久写入凭证。

非界面验证：`scripts/test-ai-editor-director-media.mjs`、`scripts/test-director-edit-plan.mjs`、`scripts/test-ai-editor-media-analysis.mjs`。
