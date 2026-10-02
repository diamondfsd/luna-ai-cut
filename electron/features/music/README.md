# 背景音乐

- `musicGenerationService.ts`：模板查询、原生生成工作进程调用。保留实际渲染 MIDI、原始 DSL 和拍点文件，输出生成音频及曲谱时间信息。
- `musicScoreTiming.ts`：读取实际 MIDI 的速度、拍号与鼓事件，生成精确拍点；读取与音频同名的时间信息。
- `musicMedia.ts`：旧音乐素材编号兼容。

生成音乐不从混合音频反推节拍。曲谱拍点随本地素材导入并随项目保存，编辑器直接使用；外部音乐保持音频检测。旧生成文件无时间信息时保留音频检测兼容路径，需要可靠卡点时重新生成同一 DSL。

验证：`pnpm test:music-score` 检查实际原生 MIDI、渲染起音、不同速度/拍号与文件恢复；`pnpm test:luna-bgm` 检查工作进程。规则见 [AGENTS.md](AGENTS.md)。
