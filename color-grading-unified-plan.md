# 统一调色管线方案

## 目标

以 ffmpeg 的 filter 算法为**唯一标准**，GLSL 预览和 ffmpeg 导出共用同一套参数和数学，达到像素级一致。

```
之前：  滑块 → darktable GLSL（预览）  ≠  滑块 → 手动映射 → ffmpeg（导出）
之后：  滑块 → ffmpeg 算法 GLSL（预览）  =  滑块 → ffmpeg filter（导出）
```

### 核心原则

1. **每行 GLSL 代码都必须源自 ffmpeg 源码**，不得自行推导公式或系数
2. 改写流程：读 `vf_*.c` 提取核心公式 → 翻译为 GLSL → 用相同输入验证像素输出一致
3. 凡 ffmpeg 源码中不存在的算法，GLSL 中也不存在（即删除对应 UI 控件）
4. `ColorGradingModule` 直传同组参数给 ffmpeg，不做二次映射

---

## 技术背景

### 当前 GLSL 来源

现有 9 个着色器模块均改编自 **darktable** 的 WebGL color lab 实现。darktable 的色彩科学和 ffmpeg 在以下关键点上存在差异：

| 环节 | darktable（当前） | ffmpeg |
|------|-----------------|--------|
| 对比度 pivot | `0.1845`（CIE L* 近似亮度） | `0.5`（中灰） |
| 亮度 | `pow(c, gamma)` 幂律 | `eq=brightness` 加性偏移 |
| 曝光度 | `(c - black) * 2^exposure` | `eq=gamma` 幂律 gamma |
| 饱和度 | `mix(gray, c, 1+sat)` | `eq=saturation` 乘性 |
| 色温 | RGB 三通道线性乘系数 | `colortemperature` 色温矩阵 |
| 阴影/高光/黑/白 | 乘性/加性混合 | `colorbalance`/`colorlevels` 分段 |

### ffmpeg 对应的 filter

| ffmpeg filter | 入口文件 | 覆盖功能 |
|--------------|---------|---------|
| `exposure` | `vf_exposure.c` | 曝光度 ±3EV + 黑色级别 ±1 |
| `eq` | `vf_eq.c` | brightness(加性), contrast(绕0.5), saturation(乘性), gamma(幂律) |
| `vibrance` | `vf_vibrance.c` | 自适应饱和度（保护肤色） |
| `colortemperature` | `vf_colortemperature.c` | 色温 Kelvin 转换矩阵 |
| `colorbalance` | `vf_colorbalance.c` | 阴影(rs/gs/bs) + 中间调(rm/gm/bm) + 高光(rh/gh/bh) |
| `colorlevels` | `vf_colorlevels.c` | 输入 RGB 黑/白点（rimin/rimax，无 gray 参数） |
| `curves` | `vf_curves.c` | 分段三次样条曲线（master/r/g/b 通道） |
| `hue` | `vf_hue.c` | 色相旋转（角度） |
| `huesaturation` | `vf_huesaturation.c` | 固定 6 色区(R/Y/G/C/B/M) + hue/sat/intensity/strength |
| `unsharp` | `vf_unsharp.c` | USM 锐化（可配置半径） |
| `hqdn3d` | `vf_hqdn3d.c` | 3D 降噪（空间+时间） |

---

## 实施计划

### 前提：ffmpeg 无法实现的功能 → 删除

基于 `/Users/zhouchao/projects/FFmpeg/libavfilter/` 实际源码验证：

| 功能 | 涉及 GLSL | ffmpeg filter | 结论 |
|------|----------|--------------|------|
| **HSL 连续色相范围** | `hsl.glsl` | `vf_huesaturation.c` 只支持 R/Y/G/C/B/M **6 个固定色区**（bitmask 模式），没有"任意目标色相 + 可变半径"的连续选择 | 删除 HSL 面板 |
| **色阶灰度点** | `levels.glsl` | `vf_colorlevels.c` 只有 rimin/rimax（黑/白点），无 gray 参数 | 删除灰度点滑块 |

其余功能均可映射，具体见各 Phase。

---

### Phase 1 — eq filter（曝光/亮度/对比度/饱和度）

**替换 GLSL**：`exposure.glsl` + `brightness.glsl` + `colorBalanceRgb.glsl` 中对比度/饱和度部分

ffmpeg `eq` filter 公式（来自 `vf_eq.c`）：

```
brightness:  c' = c + brightness               // 加性偏移，范围 [-1, 1]
contrast:    c' = (c - 0.5) * contrast + 0.5    // 绕 0.5 缩放
saturation:  gray = luma(c)
             c' = mix(gray, c, saturation)       // 乘性，范围 [0, 3]
gamma:       c' = pow(c, 1/gamma)               // 幂律
```

**对照当前 shader 差异**：
- 对比度 pivot：`0.1845`（darktable）→ `0.5`（ffmpeg）
- 亮度：`pow(c, gamma)`（darktable）→ `c + brightness`（ffmpeg）

**验证**：
```
ffmpeg -i ref.png -vf "eq=brightness=0.1:contrast=1.2:saturation=1.3:gamma=0.9" -frames 1 ref_ffmpeg.png
```
WebGL 渲染同参数截图，逐像素 PSNR 比较。

---

### Phase 2 — colorbalance + vibrance + colortemperature

**替换 GLSL**：`whiteBalance.glsl` + `toneEqualizer.glsl` + 部分 `colorBalanceRgb.glsl`

#### 2a. colorbalance（三路色轮）

ffmpeg `colorbalance` filter（来自 `vf_colorbalance.c`）：

```
shadowMask  = (1 - luma)²        // 阴影权重
midMask     = 1 - |luma - 0.5|*2 // 中间调权重
highMask    = luma²               // 高光权重

c' = c + rs * shadowMask + rm * midMask + rh * highMask    // R 通道
c' = c + gs * shadowMask + gm * midMask + gh * highMask    // G 通道
c' = c + bs * shadowMask + bm * midMask + bh * highMask    // B 通道
```

已有实现和 ffmpeg `colorbalance` 的差异：
- 当前：只有阴影/高光两段，缺少中间调
- 当前：用 `colorWheel(hue, amount)` 转换 → RGB
- ffmpeg：直接逐通道 rs/gs/bs/rm/gm/bm/rh/gh/bh

**改造**：三路色轮的 hue→RGB 转换保留，用 `colorWheel` 算出 rgb 偏移后映射到 colorbalance 的 rs/gs/bs 等参数。

#### 2b. vibrance

ffmpeg `vibrance` filter 公式：
```
c' = mix(c, gray, g * (maxc - minc))  // g = vibrance，对高 chroma 区域影响小
```
当前 GLSL 也是 chroma 保护模式，需要验证具体系数是否一致。

#### 2c. colortemperature

ffmpeg 6.0 `colortemperature` filter 算法：
```
r = 1 / (temp / 100) * 0.18   // 温度转换矩阵
b = (temp / 100) * 0.18
g = 1 + tint * 0.12
```
当前 GLSL：
```
r = 1 + temp * 0.18 - tint * 0.04
g = 1 + tint * 0.12
b = 1 - temp * 0.18 - tint * 0.04
```
差异：ffmpeg 的 r/b 和 temp 是**倒数关系**，且有 `0.18` 缩放。需要对齐。

---

### Phase 3 — colorlevels + curves

**替换 GLSL**：`levels.glsl` + `curve.glsl`

#### 3a. colorlevels（色阶）

ffmpeg `colorlevels`（来自 `vf_colorlevels.c`）：
```
rimin/gimin/bimin: 输入黑点，低于此值设为此值
rimax/gimax/bimax: 输入白点，高于此值设为此值
```
参数是 RGB 三通道独立。

当前 `levels.glsl` 是统一三通道的 black/gray/white 三点带 gamma 的映射，与 ffmpeg 的 `colorlevels` 语义不同。ffmpeg 的 colorlevels 不包含 gamma 和 gray 点。

需要确认是否直接用 `colorlevels` 替代，还是保留独立的 levels 计算（GLSL 和 ffmpeg 都用同一套公式）。

#### 3b. curves（曲线）

ffmpeg `curves` filter 格式：
```
curves=master='0/0 0.25/0.3 0.5/0.5 0.75/0.7 1/1':red='...'
```
使用 Catmull-Rom 样条插值或线性插值。

当前 GLSL 使用 smoothstep 插值，ffmpeg 默认是线性/样条插值。需要选择一致的插值方式。

---

### Phase 4 — unsharp + hqdn3d（细节）

**替换 GLSL**：`detail.glsl`

#### 4a. unsharp（锐化/清晰度/纹理）

ffmpeg `unsharp` filter：
```
unsharp=luma_msize_x=3:luma_msize_y=3:luma_amount=1.5
       :chroma_msize_x=3:chroma_msize_y=3:chroma_amount=0
```

当前 GLSL 使用 3×3 高斯模糊提取细节层：
```
detail = raw - blur3(raw)
c' = c + detail * (texture * 1.2 + clarity * 1.8)   // 清晰度/纹理
c' = c + detail * sharpen * 1.5                      // 锐化
```

ffmpeg 的 unsharp 使用可配置半径的 USM，需要映射：
- `clarity` → 大半径 unsharp（luma_msize=9, luma_amount=clarity）
- `texture` → 中半径 unsharp（luma_msize=5, luma_amount=texture）
- `sharpen` → 小半径 unsharp（luma_msize=3, luma_amount=sharpen*2）

#### 4b. hqdn3d（降噪）

ffmpeg `hqdn3d` filter：
```
hqdn3d=luma_spatial=4:chroma_spatial=4:luma_tmp=3:chroma_tmp=3
```

当前 GLSL：`mix(raw, blurred, denoise)`（仅空间域，简单混合）

GLSL 需要实现完整的 hqdn3d 算法或至少空间降噪部分。

---

### Phase 5 — 删除 HSL 面板

**ffmpeg 无法实现，直接删除 `hsl.glsl` 及其 UI**。

当前 HSL 算法复杂：目标色带检测 + 平滑过渡 + 三通道独立偏移。ffmpeg 没有任何 filter 能实现此功能。

UI 改动：移除 `HslPanel.tsx`，不再暴露 hslHue/hslSat/hslLum/hue 四个参数。输出管线（GLSL + ffmpeg）都不处理这些参数。

---

## 验证方案

每个 Phase 用一个参考帧验证：

```
Phase 1 验证脚本：ffmpeg -i ref.png -vf "eq=..." -frames 1 out.png
                  → WebGL 渲染同参数 → 像素差异图（PSNR/SSIM）

Phase 2-5 同理
```

使用 `node` 脚本 + `sharp` 或 `pixelmatch` 库计算差异。

---

## GLSL 着色器文件清单

| 文件 | 当前算法来源 | 替换目标 | Phase |
|------|------------|---------|-------|
| `exposure.glsl` | darktable | `eq=gamma` 公式 | 1 |
| `brightness.glsl` | darktable | `eq=brightness` 公式 | 1 |
| `whiteBalance.glsl` | darktable | `colortemperature` 矩阵 | 2 |
| `toneEqualizer.glsl` | darktable | `colorbalance` 分段 | 2 |
| `levels.glsl` | darktable | `colorlevels` 公式 | 3 |
| `curve.glsl` | darktable | `curves` filter 插值 | 3 |
| `detail.glsl` | darktable | `unsharp` + `hqdn3d` 算法 | 4 |
| `hsl.glsl` | darktable | **删除**（ffmpeg 无法实现） | 5 |
| `colorBalanceRgb.glsl` | darktable | 拆分到 Phase 1+2（对比度/饱和度→eq，三路色轮→colorbalance） | 1+2 |

---

## ffmpeg ColorGradingModule 对照扩展

后端 `electron/ffmpeg/colorGrading.ts` 同步更新，每个 Phase 增加对应的 filter 映射。

### 当前已实现（可直连到新管线）

| 参数 | ffmpeg filter | 数学匹配状态 |
|------|--------------|------------|
| exposure | `eq=gamma` | ✅ 已实现，需确认 gamma 系数 |
| brightness | `eq=brightness` | ✅ 已实现，需确认加性 vs 幂律 |
| contrast | `eq=contrast` | ✅ 已实现，pivot 需从 0.1845 改为 0.5 |
| saturation | `eq=saturation` | ✅ 已实现 |
| vibrance | `vibrance` | ✅ 已实现 |
| temperature | `colortemperature=K` | ✅ 已实现，公式需对齐倒数关系 |
| tint | `hue=H` | ✅ 已实现 |
| shadows | `colorbalance=rs/gs/bs` | ✅ 已实现 |
| highlights | `colorbalance=rh/gh/bh` | ✅ 已实现 |
| whites | `colorlevels=rimax` | ✅ 已实现 |
| blacks | `colorlevels=rimin` | ✅ 已实现 |
| clarity | `unsharp` 大半径 | ✅ 已实现 |
| sharpen | `unsharp` 小半径 | ✅ 已实现 |
| denoise | `hqdn3d` | ✅ 已实现 |

### 待新增（Phase 对应）

| 参数 | ffmpeg filter | Phase | 说明 |
|------|--------------|-------|------|
| black（曝光→黑色） | `eq=black` 或降级 | 1 | 当前设为 `eq=gamma`+`colorlevels` |
| gradeShadowsHue/Amount | `colorbalance=rs/gs/bs` | 2 | 需要 hue→RGB 转换 |
| gradeMidHue/Amount | `colorbalance=rm/gm/bm` | 2 | 新增中间调 |
| gradeHighlightsHue/Amount | `colorbalance=rh/gh/bh` | 2 | 已有，需对齐参数语义 |
| levelsBlack/Gray/White | `colorlevels` 全参数 | 3 | 需要 gamma 点计算 |
| curve (5通道) | `curves` | 3 | 需要 points→spline 序列化 |
| texture | `unsharp` 中半径 | 4 | 新参数 |

---

## 执行顺序建议

```
Phase 1 (eq)       → GLSL 和导出最先对齐，因为覆盖 80% 常用操作
  ↓ 验证通过
Phase 2 (color)    → 色温、色调均衡、自然饱和度、三路色轮
  ↓ 验证通过  
Phase 3 (curves)   → 曲线、色阶（最复杂的参数映射）
  ↓ 验证通过
Phase 4 (detail)   → 锐化、清晰度、纹理、降噪
  ↓ 验证通过
Phase 5 (cleanup)  → 删除 HSL 面板 + 色阶灰度点滑块
```

每个 Phase 包含：
1. **读** `libavfilter/vf_*.c` 源码，提取核心公式和系数
2. **写** GLSL 翻译，每行计算与 C 源码逐行对照
3. **更新** `ColorGradingModule`（直传同参数给 ffmpeg）
4. **验证**：ffmpeg 处理参考帧 → WebGL 渲染同参数 → pixelmatch 比较，容差 0
5. 提交
