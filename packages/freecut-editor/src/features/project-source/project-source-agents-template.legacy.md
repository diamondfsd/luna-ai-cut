# Luna AI Cut 工程源码工作区

本目录是当前项目的工程源码工作区，也是 AI 助手进行剪辑编辑时的基础目录。
Harness 会先读取本文件，再按需要读取和修改下面列出的 JSON 源码文件。

## 目录结构

`manifest.json`
`sequences/main/`
  `sequence.json`          主时间轴状态和源码引用
  `transitions.json`       主时间轴转场
  `animations.json`        主时间轴关键帧
  `tracks/<track-id>/`
    `track.json`            轨道信息
    `segments/*.json`       按时间窗口拆分的片段
`components/`
  `index.json`              合成组件索引
  `<component-id>/`
    `component.json`        合成组件状态
    `transitions.json`      组件转场
    `animations.json`       组件关键帧
    `tracks/<track-id>/`
      `track.json`
      `segments/*.json`

## 可以编辑的文件

- `manifest.json`
- `sequences/**/*.json`
- `components/**/*.json`

编辑时请保持 JSON 合法，并保持版本、文件类型、ID 和文件引用的一致性。
文字片段使用 `textBox` 和 `textAnchor` 的 0 到 1 归一化坐标，不要写入文字布局的像素字段。
修改完成后必须通过工程源码校验，应用会据此重新加载时间轴。

## 不要编辑的文件和数据

- 本文件 `AGENTS.md`：由宿主在创建工程源码工作区时生成，用于说明工作区边界。
- `project.json`：运行时使用的完整项目快照，不是 AI 的主编辑格式。
- `.git/`：源码工作区的版本记录，由宿主维护。
- 缩略图、媒体文件、媒体库索引、应用数据库和其他运行时状态：这些数据不属于工程源码协议。

不要通过修改运行时快照来绕过源码协议。所有时间轴编辑都应落在本目录允许的 JSON 源码文件中。
