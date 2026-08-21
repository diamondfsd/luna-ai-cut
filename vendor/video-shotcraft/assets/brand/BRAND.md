# video-shotcraft 品牌规范

## 核心概念

标志名：**镜刻 / Frame Chisel**

未闭合的黑色框是一格正在被选择的镜头；琥珀斜面既是剪辑切点，也是把运动“刻”成镜头的刀口。标志不直接画摄像机、播放键或胶片，而是表现 video-shotcraft 的核心动作：**从运动中取景，以工艺完成它。**

## 品牌色

| Token | 名称 | Hex | 用途 |
|---|---|---|---|
| `--brand-amber` | 镜琥珀 | `#D3923C` | 唯一主强调色、关键动作、选中态、标志刀口 |
| `--brand-ink` | 片场墨 | `#171714` | 主背景、标题、标志结构 |
| `--brand-paper` | 剪辑纸 | `#F5F3EE` | 浅色背景、深底主文字 |
| `--brand-slate` | 场记灰 | `#B5B0A5` | 次级文字、说明信息 |

推荐比例：片场墨 70% / 剪辑纸 20% / 镜琥珀 10%。在高密度界面中，镜琥珀面积应进一步压到 3–5%，只标记真正的切点或焦点。

浅色界面沿用：

```css
:root {
  --brand-amber: #D3923C;
  --brand-ink: #171714;
  --brand-paper: #F5F3EE;
  --brand-slate: #716D64;
  --brand-line: #D9D5CC;
}
```

深色界面沿用：

```css
:root {
  --brand-amber: #D3923C;
  --brand-ink: #171714;
  --brand-paper: #F0EDE5;
  --brand-slate: #B5B0A5;
  --brand-line: #3E3B34;
}
```

## 使用规则

- 最小显示尺寸：数字界面 16px；低于 24px 时优先只用标志，不带字标。
- 安全空间：四周至少保留标志宽度的 1/4。
- 深底使用 `logo-mark-reverse.svg`；浅底使用 `logo-mark.svg`。
- 单色印刷、激光雕刻和遮罩使用 `logo-mark-mono.svg`。
- 字标默认使用 Avenir Next / Avenir / Inter，全部小写；不要改成全大写科技字标。
- 不旋转斜切刀口，不添加发光、渐变、描边或投影，不把琥珀色替换为多个强调色。

## 品牌语气

中文短句：**把运动，刻成镜头。**

英文短句：**Frame motion. Craft the shot.**
