# 采样音源 — Salamander Grand Piano V3

自动演奏页面（`/#/autoplay`）**默认就使用这里的真实钢琴采样**，不需要任何开关。
若本目录为空或 `manifest.json` 缺失，引擎会安静回退到内置合成音源，页面依然能出声。

## 1. 这是什么

- **音源**：[Salamander Grand Piano V3](https://archive.org/details/SalamanderGrandPianoV3)，Alexander Holm 录制，
  许可 **CC BY 3.0**。
- **分发形态**：`@audio-samples/piano-mp3-velocity1 … velocity16`（npm，16 个独立力度层包）。
  本项目取其中 **3 层**：
  | 层 | 包 | 对应力度 | 用途 |
  |---|---|---|---|
  | `v3` | `piano-mp3-velocity3` | ≤ 0.36 | 弱奏（p） |
  | `v9` | `piano-mp3-velocity9` | ≤ 0.68 | 中奏（mf）—— 预取的首层 |
  | `v15` | `piano-mp3-velocity15` | > 0.68 | 强奏（f） |
- **采样点密度**：每 **3 个半音**一个采样点（A0、C1、D♯1、F♯1、A1 … 共 30 个）。
  播放时取最近采样点并按 `2^(Δ半音/12)` 变速 —— ±1.5 半音内的变速听不出音色损失，
  却把资源体积压到「每音一文件」的 1/3。

## 2. 文件命名

```
public/samples/
  manifest.json
  C4v3.mp3   C4v9.mp3   C4v15.mp3
  D#3v3.mp3  D#3v9.mp3  D#3v15.mp3
  ...
```

- 音名用科学音高记号：`C4` = 中央 C = MIDI 60，`A#3` = MIDI 58。**升号写作 `#`**。
- 后缀即力度层标识（`v3` / `v9` / `v15`）。

## 3. manifest.json

```json
{
  "name": "Salamander Grand Piano V3",
  "baseUrl": "samples/",
  "ext": "mp3",
  "layout": "sparse",       // 稀疏采样点 + 变速；"perNote" 则每个音高一个文件
  "noteName": "scientific",
  "anchorStart": 21,        // 锚点起点（MIDI），本例 = A0
  "anchorStep": 3,          // 锚点间隔（半音）
  "release": 0.24,          // 松键衰减（秒）
  "pedalTail": 5.5,         // 踏板下单个音最多延长多少秒
  "layers": [
    { "max": 0.36, "suffix": "v3",  "gain": 2.083 },
    { "max": 0.68, "suffix": "v9",  "gain": 1.0 },
    { "max": 1.01, "suffix": "v15", "gain": 0.481 }
  ]
}
```

### `gain` 是怎么来的（不要凭感觉填）

三层是三次独立录音，原始响度差好几个 dB。直接切层会出现「台阶」。
`gain` 用于抵消这个差异，使**所有层共用一条力度曲线**，于是跨层听不出接缝。

标定方法（已内置脚本）：

```bash
node tools/sample-calibrate.mjs      # 需要 8791 服务在跑
```

它会解码每层的若干采样点、取有效段 RMS 的中位数，输出：

```
建议 manifest layers.gain = [2.083, 1, 0.481]
```

同时输出每个采样的起音偏移（`lead`）与通道数，用于核对 mp3 编码延迟是否正常
（正常在 0～15ms）。

## 4. 引擎侧的关键处理（`src/audio/sampleEngine.ts`）

| 处理 | 为什么必须做 |
|---|---|
| **URL 编码 `#`** | `#` 是 URL 的 fragment 分隔符。`D#3v9.mp3` 不编码会被截成 `D` → 404。这一条曾让全曲**所有升号音静默消失**（含开头动机的 D♯），听感上只表现为"旋律完全不对" |
| **跳过 mp3 编码填充** | 解码后开头有 20~50ms 填充静音，不从真实起音点开始会让整首曲子"迟半个字"、起音发闷 |
| **解码后裁剪** | 原始采样一直录到完全静音（低音区长 22 秒）。不裁剪的话 90 个 buffer 解码后接近 500MB，LRU 会疯狂互踢（听感是音色忽好忽坏）。裁剪上限按音高：低音 12s → 高音 4s |
| **层增益 + 全局力度曲线** | 见上文 `gain` |
| **软回退** | 某音所需层未就绪时，先借同音高其它层（增益补偿），再不行交给合成音源。任何情况下都不漏音 |
| **踏板语义** | 踏板踩下时不人为截断，让录音自然衰减；抬起时统一落制音器。声部上限 96，超出优先淘汰非踏板声部 |

## 5. 加曲目 / 换音源

- **加曲目**：无需改动。引擎按「本曲实际用到的音高」预取，与曲目无关。
- **换音源**：只改 `manifest.json`（`layerStep`、`suffix`、`gain`），代码零改动。
  换完跑一次 `node tools/sample-calibrate.mjs` 重新标定 `gain` 即可。
- **删掉采样**：整个目录清空，页面自动走合成音源。
