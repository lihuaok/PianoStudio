/*!
 * Copyright (c) 2026 LIHUA. All rights reserved.
 * 版权所有 (C) 2026 LIHUA，保留所有权利。
 */

/**
 * curriculum.ts — 课程体系
 * 六级进阶，覆盖零基础到演奏级；每课含知识点、练习、达标标准。
 */

export type LessonCategory = 'theory' | 'technique' | 'sight-reading' | 'repertoire' | 'ear' | 'practice-habits'
export type Difficulty = 1 | 2 | 3 | 4 | 5

export interface LessonBlock {
  kind: 'text' | 'exercise' | 'quiz' | 'tip' | 'key-list' | 'chord' | 'scale'
  title?: string
  body?: string
  /** 交互式练习的配置 */
  exercise?: {
    kind: 'interval' | 'scale' | 'chord' | 'key-signature' | 'rhythm' | 'note-name' | 'chord-quality' | 'scale-degree'
    prompt: string
    options?: string[]
    answer: string
    explanation: string
  }
}

export interface Lesson {
  id: string
  level: number
  order: number
  category: LessonCategory
  title: string
  subtitle: string
  objective: string
  estimatedMinutes: number
  blocks: LessonBlock[]
  /** 达标标准 */
  passCriteria: string
}

export interface Level {
  level: number
  name: string
  subtitle: string
  description: string
  targetAudience: string
  color: string
}

export const LEVELS: Level[] = [
  {
    level: 1,
    name: '入门 · 认识键盘',
    subtitle: '从零开始',
    description: '建立对钢琴键盘、音名、拍号的直觉。能独立演奏《致爱丽丝》的主题动机。',
    targetAudience: '零基础 · 儿童与成人均可',
    color: '#38bdf8',
  },
  {
    level: 2,
    name: '基础 · 五指与乐理',
    subtitle: '打地基',
    description: '掌握自然手位、连奏与断奏，理解大调音阶与基本和弦，能完整演奏 A 段。',
    targetAudience: '学过几个月键盘',
    color: '#34d399',
  },
  {
    level: 3,
    name: '进阶 · 乐理系统化',
    subtitle: '看得懂谱子',
    description: '调号、关系大小调、三和弦与七和弦、功能和声；视奏能力显著提升。',
    targetAudience: '学习 1 年以上',
    color: '#fbbf24',
  },
  {
    level: 4,
    name: '演奏 · 音乐表现',
    subtitle: '会「唱」钢琴',
    description: '乐句法、力度层次、踏板与 rubato；能完整演奏《致爱丽丝》全曲。',
    targetAudience: '学习 2–3 年',
    color: '#fb923c',
  },
  {
    level: 5,
    name: '深化 · 风格与结构',
    subtitle: '理解作品',
    description: '奏鸣曲式、回旋曲式分析；古典主义演奏传统与不同学派处理。',
    targetAudience: '有较好演奏基础',
    color: '#e879f9',
  },
  {
    level: 6,
    name: '大师 · 艺术表达',
    subtitle: '形成自己的声音',
    description: '音色构建、触键层次、个人诠释；将技巧与审美统一。',
    targetAudience: '专业方向',
    color: '#f87171',
  },
]

export const LESSONS: Lesson[] = [
  // ── Level 1 ──────────────────────────────────────────────────────────────
  {
    id: 'l1-keyboard',
    level: 1,
    order: 1,
    category: 'theory',
    title: '认识键盘与琴键规律',
    subtitle: '88 个键里藏着什么',
    objective: '能说出任意琴键的音名，理解黑键的分组规律',
    estimatedMinutes: 25,
    passCriteria: '随机给出 20 个琴键，音名正确率 ≥ 90%',
    blocks: [
      {
        kind: 'text',
        title: '钢琴的基本结构',
        body:
          '标准钢琴有 88 个键：52 个白键 + 36 个黑键。白键是七个字母 C D E F G A B，' +
          '从低到高循环排列；黑键夹在相邻两个白键之间，表示「升高半音」或「降低半音」。' +
          '\n\n关键规律：**黑键总是成组出现，2 个一组和 3 个一组交替。**' +
          'C♯D♯ 是一组（2 个），F♯G♯A♯ 是一组（3 个）。' +
          '看懂这个规律，你就能在键盘上「横着扫一眼」找到任何音。',
      },
      {
        kind: 'key-list',
        title: '八度与音域',
        body: '中央 C（记作 C4）在键盘正中间，是所有音高标注的原点。88 键的音域大约是 7 个八度。',
      },
      {
        kind: 'exercise',
        exercise: {
          kind: 'note-name',
          prompt: '中央 C 的音名是什么？',
          options: ['C4（中央 C）', 'C3', 'C5', 'B3'],
          answer: 'C4（中央 C）',
          explanation: '中央 C 记作 C4，它位于键盘中央，下方是 B3，上方是 C4。它是所有音名标注的原点。',
        },
      },
      {
        kind: 'exercise',
        exercise: {
          kind: 'note-name',
          prompt: 'E 和 F 之间为什么没有黑键？',
          options: [
            'E 到 F 只差半音，没有升高空间',
            '那个位置的琴键坏了',
            '设计者忘了加',
            'E 和 F 之间是全音',
          ],
          answer: 'E 到 F 只差半音，没有升高空间',
          explanation:
            '音阶中 E→F、F→B 是「半音」，其余相邻音都是「全音」。半音之间不存在「再升高半音」的音，' +
            '所以 E 与 F 之间、F 与 B 之间都没有黑键。这就是黑键呈现 2-3 分组规律的原因。',
        },
      },
      {
        kind: 'tip',
        title: '练习建议',
        body: '在真实钢琴（或本软件的键盘）上，从中央 C 开始向上弹一遍音阶 C D E F G A B C，用手感受「全全半全全全半」的排列。',
      },
    ],
  },
  {
    id: 'l1-posture',
    level: 1,
    order: 2,
    category: 'technique',
    title: '坐姿与手型',
    subtitle: '一切从身体开始',
    objective: '建立能支撑长期练习的正确姿势与放松手型',
    estimatedMinutes: 20,
    passCriteria: '连续弹奏 5 分钟，手腕不酸痛、手指不僵硬',
    blocks: [
      {
        kind: 'text',
        title: '三个基准点',
        body:
          '1. **坐姿**：琴凳坐前 1/3，大腿与地面基本平行，前臂与键盘大致平行（略高于键盘面）。\n' +
          '2. **手位**：手掌像轻轻握着一个鸡蛋，拇指与小指之间能容纳一只手的宽度。\n' +
          '3. **触键**：用指尖靠近指肚的位置触键，手腕保持放松不塌陷，力量来自手臂的重量而非手指的用力。',
      },
      {
        kind: 'tip',
        title: '常见错误',
        body:
          '① 手腕塌陷（像断掉一样）——会让前臂疲劳。\n' +
          '② 手指僵硬伸直——无法做快速交替。\n' +
          '③ 耸肩——上半身紧张会传导到手指。\n' +
          '自查方法：弹完后甩甩手，如果手是松的，说明没用力过猛。',
      },
      {
        kind: 'exercise',
        exercise: {
          kind: 'note-name',
          prompt: '弹奏时力量应该来自哪里？',
          options: ['手臂的重量自然下沉', '手指用力下压', '手腕用力抖动', '肩膀发力'],
          answer: '手臂的重量自然下沉',
          explanation:
            '正确的发力方式是把手臂的重量「放」到指尖上，而不是主动下压。' +
            '这样长时间练习也不累，而且音色更均匀、更有控制力。',
        },
      },
    ],
  },
  {
    id: 'l1-theme',
    level: 1,
    order: 3,
    category: 'repertoire',
    title: '《致爱丽丝》主题动机',
    subtitle: 'E–D♯–E–D♯–E–B–D–C–A',
    objective: '右手单独弹出主题动机，节奏均匀',
    estimatedMinutes: 40,
    passCriteria: '右手连续三遍弹对主题（76 BPM），无错音',
    blocks: [
      {
        kind: 'text',
        title: '为什么从这首曲子开始',
        body:
          '《致爱丽丝》的主题只用 9 个音：E5 D♯5 E5 D♯5 E5 B4 D5 C5 A4。' +
          '它音域窄、节奏规整、重复性强，是训练「音准 + 均匀 + 放松」的绝佳材料。' +
          '更重要的是——它几乎涵盖了小调音乐最核心的两个概念：**半音揉动**与**属和弦的悬念**。',
      },
      {
        kind: 'text',
        title: '3/8 拍怎么数',
        body:
          '3/8 表示每小节有三个「八分音符」的长度。数拍方式：1-2-3，每小节重新开始。' +
          '第一个音落在「1」，第二个落在「2」，第三个落在「3」，然后立刻回到下一小节的「1」。' +
          '感觉上像华尔兹的「咚-哒-哒」，这就是这首曲子著名的「摇曳感」来源。',
      },
      {
        kind: 'tip',
        title: '指法：5-4-5-4-5-2-4-3-1',
        body:
          '前五个音（E-D♯-E-D♯-E）用 5-4-5-4-5，手指在 E 和 D♯ 两个键之间小幅揉动，手型几乎不变。\n' +
          '然后 B4 用 2 指，D5 用 4 指，C5 用 3 指，最后 A4 用 1 指（拇指）。\n' +
          '注意 B4 和 C5 之间不要用同一个手指——这是初学者最常见的错误。',
      },
      {
        kind: 'exercise',
        exercise: {
          kind: 'note-name',
          prompt: '3/8 拍中，一个小节有几个拍？',
          options: ['3 拍', '2 拍', '4 拍', '6 拍'],
          answer: '3 拍',
          explanation: '拍号 3/8 的分子 3 表示每小节有三个八分音符的时值，分母 8 表示以八分音符为一拍。',
        },
      },
    ],
  },

  // ── Level 2 ──────────────────────────────────────────────────────────────
  {
    id: 'l2-position',
    level: 2,
    order: 1,
    category: 'technique',
    title: '自然手位与五指独立性',
    subtitle: '手型是乐句的骨架',
    objective: '掌握 C / G / F 三个自然手位，能独立完成五个手指的匀速练习',
    estimatedMinutes: 35,
    passCriteria: '五指独立性练习连续 10 遍无明显错音',
    blocks: [
      {
        kind: 'text',
        title: '什么是自然手位',
        body:
          '自然手位（也称「基本手位」）就是五个手指正好落在五个相邻白键上的位置：' +
          '1 指放 C，2 指放 D，3 指放 E，4 指放 F，5 指放 G。' +
          '在这个手位上，每个手指都落在自己的「家」上，不需要犹豫，这是一切快速演奏的基础。',
      },
      {
        kind: 'tip',
        title: '五指独立性练习法',
        body:
          '保持手型不动，依次单独抬起并落下：1-2-3-4-5，然后 5-4-3-2-1。\n' +
          '抬起其它四指，只让一个手指动作，幅度尽量小（1–2 厘米）。' +
          '这个练习枯燥但极其有效——它是所有快速音型（音符)的地基。建议每天 5 分钟。',
      },
      {
        kind: 'exercise',
        exercise: {
          kind: 'note-name',
          prompt: '自然手位中，5 指（小指）落在哪个音？',
          options: ['G', 'A', 'E', 'C'],
          answer: 'G',
          explanation: 'C 手位 = 1指C、2指D、3指E、4指F、5指G。5 指落在最高的白键 G 上。',
        },
      },
    ],
  },
  {
    id: 'l2-conn',
    level: 2,
    order: 2,
    category: 'technique',
    title: '连奏与断奏',
    subtitle: 'legato 与 staccato',
    objective: '能听辨并准确演奏连奏、断奏，形成基本的乐句感',
    estimatedMinutes: 30,
    passCriteria: '在《致爱丽丝》A 段正确使用断奏与连奏',
    blocks: [
      {
        kind: 'text',
        title: '连奏（legato）',
        body:
          '连奏要求**前一个音还没完全消失时，后一个音已经响起**，听起来像一条不断的线。' +
          '实现方法：前一个音离键之前不要抬得太高，手指贴着键面向下一个键「滑」过去。',
      },
      {
        kind: 'text',
        title: '断奏（staccato）',
        body:
          '断奏要求每个音**短促而清晰**，音与音之间留有空隙。' +
          '关键不是「用力砸」，而是「弹下后迅速放松离键」——保持轻盈的触感。',
      },
      {
        kind: 'tip',
        title: '在《致爱丽丝》里的应用',
        body:
          '主题的 E–D♯–E–D♯–E 应该是**半连奏（portato）**：每个音清晰可辨，但音符之间有轻微的连接。' +
          '这正是贝多纳要的效果——像呼吸一样自然，又像耳语一样亲密。',
      },
      {
        kind: 'exercise',
        exercise: {
          kind: 'note-name',
          prompt: 'staccato 的正确实现方式是？',
          options: ['弹下后迅速放松离键，保持轻盈', '用力砸键', '按得越久越好', '用左手压住'],
          answer: '弹下后迅速放松离键，保持轻盈',
          explanation:
            '断奏的「短」来自快速的离键动作和放松的触感，而不是更大的力度。' +
            '用力砸反而会让声音变得僵硬，且容易损伤手指关节。',
        },
      },
    ],
  },
  {
    id: 'l2-major',
    level: 2,
    order: 3,
    category: 'theory',
    title: '大调音阶与调号',
    subtitle: '音阶是乐理的语法',
    objective: '理解大调音阶的构造规律，能在任何调上弹奏音阶',
    estimatedMinutes: 40,
    passCriteria: '在 C / G / D / F 四个调上正确弹奏上下行音阶',
    blocks: [
      {
        kind: 'scale',
        title: '自然大调',
        body:
          '大调音阶的音程排列是「全-全-半-全-全-全-半」（W-W-H-W-W-W-H）。' +
          '这个「两个全音接一个半音」的固定模式，是所有大调音阶的共同特征。',
      },
      {
        kind: 'text',
        title: '调号是怎么回事',
        body:
          '为了让 C 大调音阶保持上述音程模式，D 音需要升高、F 不需要——这就是「一个升号」。' +
          '每增加一个升号，音阶整体升高半音，从 C → G → D → A → E → B。\n\n' +
          '**核心概念**：调号的本质是「为了让音阶模式成立而必须调整的那些音」。' +
          '升号的顺序是 F C G D A E B；降号则相反（B E A D G C F）。',
      },
      {
        kind: 'exercise',
        exercise: {
          kind: 'key-signature',
          prompt: 'D 大调的调号有几个升号？分别是哪些音？',
          options: ['2 个：F♯、C♯', '1 个：F♯', '3 个：F♯、C♯、G♯', '4 个：F♯、C♯、G♯、D♯'],
          answer: '2 个：F♯、C♯',
          explanation:
            'D 大调 = C 大调升两个音。升号按 F、C、G、D…的顺序加入，因此 D 大调是 F♯ 和 C♯。' +
            '你可以验证：D 大调音阶 D-E-F♯-G-A-B-C♯-D，音程恰好是全全半全全全半。',
        },
      },
      {
        kind: 'exercise',
        exercise: {
          kind: 'scale',
          prompt: '大调音阶中，哪两个相邻音之间是半音？',
          options: ['第 3–4 度 与 第 7–8 度', '第 1–2 度 与 第 2–3 度', '第 4–5 度 与 第 5–6 度', '第 5–6 度 与 第 6–7 度'],
          answer: '第 3–4 度 与 第 7–8 度',
          explanation: '音阶度数从主音开始数：1-2(全) 2-3(全) 3-4(半) 4-5(全) 5-6(全) 6-7(全) 7-8(半)。半音出现在第 3→4 和第 7→8。',
        },
      },
    ],
  },
  {
    id: 'l2-chord',
    level: 2,
    order: 4,
    category: 'theory',
    title: '三和弦入门',
    subtitle: '三个音叠起来就是和声',
    objective: '理解三和弦的构成，能识别并演奏大三、小三、减三和弦',
    estimatedMinutes: 35,
    passCriteria: '能正确说出并弹奏 C 大调上的所有三和弦',
    blocks: [
      {
        kind: 'chord',
        title: '三和弦的基本构造',
        body:
          '三和弦由三个音按「三度叠置」构成（每个音相隔三个字母名）：' +
          '根音 → 三音 → 五音。例如 C-E-G 就是以 C 为根音的大三和弦。',
      },
      {
        kind: 'text',
        title: '大、小、减的区别',
        body:
          '- **大三和弦**：根音到三音是 4 个半音（大三度）→ 明亮、开阔，如 C-E-G\n' +
          '- **小三和弦**：根音到三音是 3 个半音（小三度）→ 柔和、忧郁，如 A-C-E\n' +
          '- **减三和弦**：根音到三音是 3 半音，三音到五音也是 3 半音 → 紧张、不稳定，如 B-D-F\n' +
          '（注意：减三和弦的两个音程都是小三度，这是它与小三和弦的根本区别）',
      },
      {
        kind: 'tip',
        title: '回到《致爱丽丝》',
        body:
          '这首曲子的和声基础极简：A 段只用两个和弦——a 小调（A-C-E）与 E 大调（E-G♯-B）。' +
          '它们交替出现，形成「悬置—解答」的呼吸。' +
          '理解这一点，你就不只是「照着弹」，而是知道**为什么**要这么弹。',
      },
      {
        kind: 'exercise',
        exercise: {
          kind: 'chord-quality',
          prompt: 'E–G♯–B 是什么和弦？',
          options: ['大三和弦', '小三和弦', '减三和弦', '增三和弦'],
          answer: '大三和弦',
          explanation:
            'E→G♯ 是 4 个半音（大三度），G♯→B 也是 4 个半音，根音到五音 E→B 是 7 个半音（纯五度）。' +
            '大三度 + 小三度的叠置 = 大三和弦。它是《致爱丽丝》里的属和弦（V）。',
        },
      },
    ],
  },

  // ── Level 3 ──────────────────────────────────────────────────────────────
  {
    id: 'l3-relative',
    level: 3,
    order: 1,
    category: 'theory',
    title: '关系大小调与调性色彩',
    subtitle: '同一条音阶的两种面貌',
    objective: '理解关系大小调，能在琴上快速找到并对比两者的听感',
    estimatedMinutes: 40,
    passCriteria: '能说出任意大调的关系小调，并弹出对比',
    blocks: [
      {
        kind: 'text',
        title: '什么是关系大小调',
        body:
          '关系大小调共用同一组音，但主音不同，因此调号完全相同。' +
          '例如 C 大调与 a 小调都用「没有升号没有降号」的调号。\n\n' +
          '在钢琴上它们的区别只是**哪个音感觉最稳定**：C 大调是 C 感觉上「回家」，a 小调则是 A。' +
          '这也是为什么同样一组音，能弹出完全不同的情绪。',
      },
      {
        kind: 'tip',
        title: '在《致爱丽丝》里听这个',
        body:
          'A 段的第 9 小节起，主题从 a 小调移到关系大调 C 大调。' +
          '请反复听第 1–8 小节和第 9–14 小节——**同一段旋律，不同的色彩**。' +
          '这是训练调性感最好的素材。',
      },
      {
        kind: 'exercise',
        exercise: {
          kind: 'scale-degree',
          prompt: 'G 大调的关系小调是？',
          options: ['e 小调', 'd 小调', 'a 小调', 'b 小调'],
          answer: 'e 小调',
          explanation:
            '关系小调位于大调主音下方小三度。G 下方小三度是 E，所以 G 大调（1 个升号 F♯）的关系小调是 e 小调。',
        },
      },
    ],
  },
  {
    id: 'l3-seventh',
    level: 3,
    order: 2,
    category: 'theory',
    title: '属七和弦与终止式',
    subtitle: '音乐的「悬念装置」',
    objective: '理解属七和弦的构成与解决，理解终止式的听感',
    estimatedMinutes: 45,
    passCriteria: '能弹出并听辨属七→主和弦的解决',
    blocks: [
      {
        kind: 'text',
        title: '七和弦：在三和弦上加一个七音',
        body:
          '七和弦 = 三个音（三和弦）+ 与根音相隔七度的音。' +
          '最常用的是「属七和弦」：大三三和弦 + 小七度，如 E-G♯-B-D。' +
          '那个 D 音就是「导音」，它有强烈的向上倾向，几乎必然要上行解决到 E。',
      },
      {
        kind: 'text',
        title: '终止式：音乐的句号',
        body:
          '- **完全终止（V–I）**：属和弦解决到主和弦，稳定、圆满。\n' +
          '- **不完全终止（V）**：停在属和弦上，有悬念，需要后续解决。《致爱丽丝》的 A 段结尾就是典型例子。\n' +
          '- ** deceptive 阻碍终止**：本该回主却转向别的和弦，出人意料。',
      },
      {
        kind: 'tip',
        title: '《致爱丽丝》里的和声设计',
        body:
          '贝多纳在 A 段只用 I 和 V 两个和弦，这是极简的。' +
          '但正因为简单，悬念感才格外强烈——第 2 小节落在 a 小调（I），但第 3 小节又跳回 E 大调（V），' +
          '这个「刚落地又被悬起」的手法，是全曲最迷人的地方。',
      },
      {
        kind: 'exercise',
        exercise: {
          kind: 'chord-quality',
          prompt: 'a 小调里的属七和弦是？',
          options: ['E–G♯–B–D', 'A–C♯–E–G♯', 'D–F♯–A–C♯', 'A–C–E–G'],
          answer: 'E–G♯–B–D',
          explanation:
            'a 小调的属音是 E（自然小调第七级 G 升高半音成为 G♯）。' +
            '所以属七和弦 = E + G♯（大三度）+ B（纯五度）+ D（小七度）= E-G♯-B-D。' +
            '其中 D 是导音，必须上行到 E 才能解决。',
        },
      },
    ],
  },
  {
    id: 'l3-rhythm',
    level: 3,
    order: 3,
    category: 'theory',
    title: '节奏型与节拍感',
    subtitle: '时间是音乐的骨架',
    objective: '掌握附点、切分、三连音等常见节奏型，能稳定读出复杂节奏',
    estimatedMinutes: 45,
    passCriteria: '能准确读出并演奏八分、附点、切分、三连音组合',
    blocks: [
      {
        kind: 'text',
        title: '常见节奏型',
        body:
          '- **附点**：延长原时值的 1/2。如附点四分 = 四分 + 八分。感觉是「长—短」的急促。\n' +
          '- **三连音**：三个音均分一个二等分音符的时值。感觉是「紧—紧—紧」，与二等分的「长—短」形成对比。\n' +
          '- **切分音**：重音落在非强拍上，打破常规律动。19 世纪的华尔兹与布鲁斯常用。',
      },
      {
        kind: 'tip',
        title: '3/8 与 6/8 的区别（易混淆）',
        body:
          '3/8 是「三个二等分音符」（咚-哒-哒，每拍都同样强）。\n' +
          '6/8 是「两个三等分音符」（咚-哒-咚-哒-哒，强弱规律是 强-弱-弱）。\n' +
          '《致爱丽丝》是 3/8，感觉是摇摆的、急促的；而很多抒情曲是 6/8，感觉是流动的。' +
          '这个区别很重要，因为**它决定了如何数拍**。',
      },
      {
        kind: 'exercise',
        exercise: {
          kind: 'rhythm',
          prompt: '3/8 与 6/8 的核心区别是？',
          options: ['每拍时值不同（3/8 每拍是八分，6/8 每拍是附点八分）', '音符数量不同', '谱面行数不同', '没有区别'],
          answer: '每拍时值不同（3/8 每拍是八分，6/8 每拍是附点八分）',
          explanation:
            '3/8：三个八分音符做三拍，每拍是八分音符，每拍等长。\n' +
            '6/8：六个八分音符做两拍（每拍是附点八分），强弱规律为 强-弱-弱。\n' +
            '这个差别直接决定了律动感：3/8 是「摇晃」，6/8 是「流动」。',
        },
      },
    ],
  },

  // ── Level 4 ──────────────────────────────────────────────────────────────
  {
    id: 'l4-phrasing',
    level: 4,
    order: 1,
    category: 'technique',
    title: '乐句与呼吸',
    subtitle: '会说话的钢琴',
    objective: '能划分乐句、做出呼吸感，让演奏有句子的结构',
    estimatedMinutes: 40,
    passCriteria: '在《致爱丽丝》A 段做出明确的乐句起伏',
    blocks: [
      {
        kind: 'text',
        title: '乐句是音乐的句子',
        body:
          '和说话一样，音乐也有句子、逗号、句号。乐句的划分依据是**旋律走向 + 和声变化 + 节奏型**。' +
          '在《致爱丽丝》里：\n\n' +
          '- m1–m4：两个小乐句（E-D♯-E 动机 + 下行解答）\n' +
          '- m5–m8：E-C-B-A 的下行收束，是一个完整的呼吸\n' +
          '- m9 起：转到 C 大调，新的乐句开始',
      },
      {
        kind: 'tip',
        title: '呼吸的三个层次',
        body:
          '① **句子**：通常 4–8 小节，用力度起伏标出（渐强到最高点再渐弱）。\n' +
          '② **分句**：2–4 小节，可以有轻微的停顿或重音转移。\n' +
          '③ **连奏/断奏**：音符之间的连接方式，是最小的呼吸单位。\n\n' +
          '三个层次叠加，就有了「说话感」。',
      },
      {
        kind: 'exercise',
        exercise: {
          kind: 'interval',
          prompt: '乐句呼吸主要通过什么表达？',
          options: ['力度起伏与轻微停顿', '加快速度', '增加音符', '提高音量到最大'],
          answer: '力度起伏与轻微停顿',
          explanation:
            '乐句呼吸靠的是「张与弛」：一个乐句内力度推向高点，然后在结尾处回落。' +
            '最重要的不是一直强，而是知道**在哪里变弱**——留白才有音乐。',
        },
      },
    ],
  },
  {
    id: 'l4-pedal',
    level: 4,
    order: 2,
    category: 'technique',
    title: '延音踏板（弱音/强音踏板）',
    subtitle: '钢琴家的呼吸',
    objective: '理解踏板的和声功能，能演奏出干净的踏板线条',
    estimatedMinutes: 35,
    passCriteria: '在《致爱丽丝》A 段使用踏板且无「糊音」',
    blocks: [
      {
        kind: 'text',
        title: '踏板的三种效果',
        body:
          '- **右踏板（Sustain）**：延续所有被踩下的音的余音，让声音连成线。\n' +
          '- **弱音踏板（Sostenuto）**：只延续踩下时被按住的那些音。\n' +
          '- **选择性/练习踏板**（半踏）：通过演奏机结构保留部分余音。',
      },
      {
        kind: 'tip',
        title: '《致爱丽丝》的踏板原则',
        body:
          'A 段是 pp（极弱），踏板必须**换得勤**——每个乐句换一次，而不是一拍换一次。' +
          '关键规则：**换踏板时下一个音必须与踏板同步落下**，否则旧和弦会与新声部短暂碰撞。\n\n' +
          '错误示范：整小节都不换踏板 → E 和 D♯ 的半音被混成一片，旋律就模糊了。',
      },
      {
        kind: 'exercise',
        exercise: {
          kind: 'note-name',
          prompt: '换踏板时应该？',
          options: ['在下一个乐句的第一个音落键的同时换', '提前一拍换', '整段不换', '随便换'],
          answer: '在下一个乐句的第一个音落键的同时换',
          explanation:
            '换踏板的动作要和乐句起点同步，这样新踏板只承载新乐句的音，不会有旧声音的残余干扰。' +
            '这需要提前准备——在换之前手已经悬在下一个音的上方。',
        },
      },
    ],
  },
  {
    id: 'l4-rubato',
    level: 4,
    order: 3,
    category: 'technique',
    title: '速度弹性（rubato）与呼吸',
    subtitle: 'Poco moto 的真意',
    objective: '理解「Poco moto」标记，在保持速度基准的前提下做出自然的弹性',
    estimatedMinutes: 35,
    passCriteria: '能在保持速度基准的前提下做出自然的弹性',
    blocks: [
      {
        kind: 'text',
        title: 'Poco moto 是什么意思',
        body:
          '字面意思是「稍微动起来」「小步地移动」，是一种温和的速度指示，比 Allegro 慢，' +
          '但比 Adagio 快。它暗示的是**轻盈、有弹性、略带流动**的状态，而不是死板地匀速。',
      },
      {
        kind: 'tip',
        title: 'rubato 的艺术',
        body:
          'rubato 不是「随便加速」，而是**在乐句内部稍微放宽，句尾稍收紧**——' +
          '像说话时讲到句末会自然慢下来。\n\n' +
          '练习方法：先严格用节拍器匀速弹 4 遍，建立稳定的速度感；' +
          '然后关掉节拍器，只保留「起始点的节拍器声音」，让乐句自然流动。',
      },
      {
        kind: 'exercise',
        exercise: {
          kind: 'note-name',
          prompt: 'rubato 的正确理解是？',
          options: ['乐句内稍放宽、句尾稍收紧的自由度', '随意加速或减速', '完全不数拍', '越快越好'],
          answer: '乐句内稍放宽、句尾稍收紧的自由度',
          explanation:
            'rubato 的前提是「心中有数」——你已经建立了稳定的速度基准，才能在其上做弹性变化。' +
            '脱离基准的随意变化只会听起来像节奏不稳，而不是「会呼吸」。',
        },
      },
    ],
  },

  // ── Level 5 ──────────────────────────────────────────────────────────────
  {
    id: 'l5-form',
    level: 5,
    order: 1,
    category: 'theory',
    title: '曲式：回旋曲式与奏鸣曲式',
    subtitle: '看穿音乐的地图',
    objective: '能分析简单曲式的段落划分，理解 ABACA 与奏鸣曲式的结构',
    estimatedMinutes: 50,
    passCriteria: '能分析《致爱丽丝》的完整结构并解释每一段的功能',
    blocks: [
      {
        kind: 'text',
        title: '回旋曲式（ABACA）',
        body:
          'A = 主题（出现多次），B / C = 插部（对比段落）。结构像 A-B-A-C-A。' +
          'A 段的出现保证了曲子的统一性，B/C 段提供多样性。' +
          '这是莫扎特、贝多纳、海顿最常使用的曲式。',
      },
      {
        kind: 'text',
        title: '奏鸣曲式（Sonata Form）',
        body:
          '呈示部（主调→副调）→ 展开部（离调、冲突）→ 再现部（回归主调）。' +
          '慢板乐章常用双呈示部（两个主题分别在不同调上呈示）。',
      },
      {
        kind: 'tip',
        title: '分析《致爱丽丝》的结构',
        body:
          '全曲 ABACA，其中 A 段内部还有一个嵌套的三段式：\n' +
          'A₁（a 小调）→ A₂（C 大调）→ A₁′（a 小调）\n\n' +
          '用本软件的「曲式地图」可以看到每个段落的起止小节。' +
          '理解结构后，你就能预判「接下来音乐要往哪里走」，这是演奏大型曲目的必备能力。',
      },
      {
        kind: 'exercise',
        exercise: {
          kind: 'note-name',
          prompt: '回旋曲式 ABACA 中，C 段的作用是？',
          options: ['提供与 B 段不同的对比', '重复 A 段', '结束全曲', '引子'],
          answer: '提供与 B 段不同的对比',
          explanation:
            '回旋曲的对比段落 B 和 C 各有不同性格（常见 B 抒情、C 活跃），' +
            '它们的并置制造了曲子的多样性；A 段的反复出现则保证统一性。',
        },
      },
    ],
  },
  {
    id: 'l5-style',
    level: 5,
    order: 2,
    category: 'ear',
    title: '古典主义演奏传统',
    subtitle: '维也纳的钢琴美学',
    objective: '了解古典时期的钢琴特性与不同时代演奏风格的差异',
    estimatedMinutes: 45,
    passCriteria: '能说出至少三种对《致爱丽丝》的合理速度与力度方案及其依据',
    blocks: [
      {
        kind: 'text',
        title: '古典主义时期的钢琴',
        body:
          '贝多纳创作时使用的是维也纳的 fortepiano（早期钢琴），比现代钢琴轻巧、延音短、弱音器效果好。' +
          '因此原始的「pp」在当时的 fortepiano 上其实并不弱——这解释了为什么后世钢琴家的演绎常常比「pp」更响。',
      },
      {
        kind: 'tip',
        title: '听不同学派的演奏',
        body:
          '推荐对比聆听：\n' +
          '- **Schnabel**（1938）：干练、不留情，每一个音都清晰\n' +
          '- **Kempff**：极轻的触键，接近原始 fortepiano 的效果\n' +
          '- **Brendel**：自由、弹性大，装饰音丰富\n' +
          '- **Gulda**：几乎不加踏板，晶莹剔透\n\n' +
          '听完后思考：这些差异里，哪些来自「学派的审美」，哪些来自「乐器/录音条件」？',
      },
      {
        kind: 'exercise',
        exercise: {
          kind: 'note-name',
          prompt: 'Kempff 的演绎常被形容为？',
          options: ['极轻的触键，接近早期钢琴效果', '厚重的踏板', '快速的节奏', '强烈的装饰音'],
          answer: '极轻的触键，接近早期钢琴效果',
          explanation:
            'Kempff 常被认为更接近贝多纳时代的 fortepiano 声音：触键极轻、延音短、弱音自然。' +
            '这提醒我们：现代钢琴上「pp」的绝对音量已不同于当年。',
        },
      },
    ],
  },

  // ── Level 6 ──────────────────────────────────────────────────────────────
  {
    id: 'l6-touch',
    level: 6,
    order: 1,
    category: 'technique',
    title: '音色层次与触键控制',
    subtitle: '从「弹对」到「弹好」',
    objective: '掌握多种音色塑造手法，建立个人的声音概念',
    estimatedMinutes: 60,
    passCriteria: '能在同一段乐句中做出至少 4 种可辨识的音色变化',
    blocks: [
      {
        kind: 'text',
        title: '决定音色的三个物理量',
        body:
          '1. **触键位置**：靠近指尖（明亮）vs 指腹（柔和）\n' +
          '2. **触键速度**：快而浅（明亮）vs 慢而深（厚重）\n' +
          '3. **释放速度**：快速离键（断奏）vs 缓慢离键（连绵）\n\n' +
          '这三个量组合起来，就能覆盖从「晶莹」到「雄伟」的广阔音色范围。',
      },
      {
        kind: 'tip',
        title: '练习音色的方法',
        body:
          '选一段只有 5 个音的旋律，用不同的触键位置/速度/释放方式各弹一遍。' +
          '录下来对比。这能让你耳朵和手指都记住每种触键的「声音签名」。\n\n' +
          '建议从「靠近指尖+快速触键」开始（最明亮），再逐步探索更深的触键。',
      },
      {
        kind: 'exercise',
        exercise: {
          kind: 'interval',
          prompt: '想要获得更明亮的音色，应该？',
          options: ['靠近指尖触键，速度稍快', '用指腹慢慢压', '增加踏板', '弹得更重'],
          answer: '靠近指尖触键，速度稍快',
          explanation:
            '靠近指尖（而非指腹）触键能激发更丰富的高次泛音；触键速度稍快则瞬态更鲜明。' +
            '两者结合就能获得明亮、歌唱的音色。',
        },
      },
    ],
  },
  {
    id: 'l6-practice',
    level: 6,
    order: 2,
    category: 'practice-habits',
    title: '科学练习法',
    subtitle: '如何聪明地练习',
    objective: '掌握刻意练习的核心原则，设计高效的练习计划',
    estimatedMinutes: 40,
    passCriteria: '能为自己制定并执行一份有效的曲目练习计划',
    blocks: [
      {
        kind: 'text',
        title: '刻意练习的核心原则',
        body:
          '1. **慢速起步**：用比目标速度慢 30–50% 的速度练习，直到完全正确。\n' +
          '2. **分段攻克**：一次只练 1–4 小节，不超过你的注意力范围。\n' +
          '3. **即时反馈**：录下自己的演奏并回听——你无法在演奏中察觉自己的错误。\n' +
          '4. **突破瓶颈**：卡住的地方单独循环练习（使用本软件的「循环段落」功能）。\n' +
          '5. **间隔重复**：今天练的曲子明天、后天再复习，比一次性练两小时有效得多。',
      },
      {
        kind: 'tip',
        title: '20 分钟高效练习模板',
        body:
          '- 3 分钟：手型与五指独立性热身\n' +
          '- 7 分钟：难点片段慢速循环（用节拍器 + 循环功能）\n' +
          '- 5 分钟：全曲连贯演奏（录音）\n' +
          '- 5 分钟：回听录音、发现问题、记录下次要改进的点\n\n' +
          '这个模板可以用在本软件的「练习计划」功能里。',
      },
      {
        kind: 'exercise',
        exercise: {
          kind: 'note-name',
          prompt: '最有效的练习方式是？',
          options: ['慢速分段 + 即时录音反馈', '快速通练全曲', '只练开头', '只练难点反复'],
          answer: '慢速分段 + 即时录音反馈',
          explanation:
            '快速通练会掩盖错误；只练开头或难点会失去整体性。' +
            '「慢速分段 + 录音反馈」既保证了准确度，又能通过回听发现耳朵无法实时察觉的问题。',
        },
      },
    ],
  },
]

export function lessonsByLevel(level: number): Lesson[] {
  return LESSONS.filter((l) => l.level === level).sort((a, b) => a.order - b.order)
}

export function lessonById(id: string): Lesson | undefined {
  return LESSONS.find((l) => l.id === id)
}

export const CATEGORY_META: Record<LessonCategory, { label: string; icon: string; color: string }> = {
  theory: { label: '乐理', icon: '📐', color: '#38bdf8' },
  technique: { label: '技法', icon: '🎹', color: '#34d399' },
  'sight-reading': { label: '视奏', icon: '👁️', color: '#fbbf24' },
  repertoire: { label: '曲目', icon: '🎼', color: '#fb923c' },
  ear: { label: '听觉', icon: '👂', color: '#e879f9' },
  'practice-habits': { label: '方法', icon: '🧭', color: '#f87171' },
}
