# 文本编辑功能设计文档

> 对标 剪映/CapCut 的文本编辑能力，为 HoppingRabbit AI 实现完整的文本功能

## 1. 功能概览

### 1.1 核心能力（参考剪映）

| 功能模块 | 描述 | 优先级 |
|---------|------|-------|
| **添加文本** | 用户可在视频上添加文本 Clip | P0 |
| **文本编辑** | 双击文本进入编辑模式，修改内容 | P0 |
| **拖拽移动** | 在画布上拖拽文本位置 | P0 |
| **缩放旋转** | 通过控制点调整大小和角度 | P0 |
| **样式编辑** | 字体、字号、颜色、描边等 | P0 |
| **预设模板** | 花字、标题等预设样式 | P1 |
| **动画效果** | 入场/出场/循环动画 | P2 |

### 1.2 交互设计原则（CapCut 风格）

```
┌─────────────────────────────────────────────────────────────────┐
│                     文本操作工作流                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. 点击右侧工具栏「Text」按钮                                   │
│     ↓                                                            │
│  2. 选择「添加文本」或预设模板                                   │
│     ↓                                                            │
│  3. 文本 Clip 自动添加到时间轴，画布出现可编辑文本框             │
│     ↓                                                            │
│  4. 直接在画布上拖拽调整位置、拉伸控制点调整大小                 │
│     ↓                                                            │
│  5. 在右侧属性面板精确调整字体、颜色、样式等                     │
│     ↓                                                            │
│  6. 双击文本进入编辑模式，修改文字内容                           │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## 2. 数据模型设计

### 2.1 文本样式类型（TextStyle）

```typescript
/**
 * 完整文本样式定义
 * 对标剪映 Text Clip 的所有可配置属性
 */
export interface TextStyle {
  // ========== 基础属性 ==========
  /** 字体系列 */
  fontFamily: string;
  /** 字号（像素） */
  fontSize: number;
  /** 字体颜色 */
  fontColor: string;
  /** 背景色（透明度支持） */
  backgroundColor: string;
  
  // ========== 样式修饰 ==========
  /** 粗体 */
  bold: boolean;
  /** 下划线 */
  underline: boolean;
  /** 斜体 */
  italic: boolean;
  
  // ========== 间距与对齐 ==========
  /** 字间距（像素） */
  letterSpacing: number;
  /** 行间距（倍数，如 1.5） */
  lineHeight: number;
  /** 水平对齐：左/中/右 */
  textAlign: 'left' | 'center' | 'right';
  /** 垂直对齐：上/中/下 */
  verticalAlign: 'top' | 'center' | 'bottom';
  
  // ========== 描边与阴影 ==========
  /** 描边开关 */
  strokeEnabled: boolean;
  /** 描边颜色 */
  strokeColor: string;
  /** 描边宽度 */
  strokeWidth: number;
  
  /** 阴影开关 */
  shadowEnabled: boolean;
  /** 阴影颜色 */
  shadowColor: string;
  /** 阴影模糊半径 */
  shadowBlur: number;
  /** 阴影 X 偏移 */
  shadowOffsetX: number;
  /** 阴影 Y 偏移 */
  shadowOffsetY: number;
  
  // ========== 高级效果（P2） ==========
  /** 渐变配置（可选） */
  gradient?: {
    type: 'linear' | 'radial';
    colors: string[];
    angle?: number;  // 线性渐变角度
  };
}

/**
 * 默认文本样式
 */
export const DEFAULT_TEXT_STYLE: TextStyle = {
  fontFamily: 'system-ui',  // 系统默认字体
  fontSize: 48,
  fontColor: '#FFFFFF',
  backgroundColor: 'transparent',
  bold: false,
  underline: false,
  italic: false,
  letterSpacing: 0,
  lineHeight: 1.2,
  textAlign: 'center',
  verticalAlign: 'center',
  strokeEnabled: false,
  strokeColor: '#000000',
  strokeWidth: 2,
  shadowEnabled: false,
  shadowColor: 'rgba(0,0,0,0.5)',
  shadowBlur: 4,
  shadowOffsetX: 2,
  shadowOffsetY: 2,
};
```

### 2.2 字体来源分析

#### 方案对比

| 方案 | 优点 | 缺点 | 推荐场景 |
|-----|------|------|---------|
| **Google Fonts** | 免费、种类丰富(1500+)、CDN 稳定 | 中文字体较少 | 英文为主 |
| **阿里巴巴字体** | 免费商用、中文优秀 | 数量有限 | 中文场景 |
| **系统字体** | 无加载延迟、兼容性好 | 跨平台不一致 | 基础文本 |
| **字体托管** | 完全控制、品牌定制 | 需要版权授权 | 商业产品 |

#### 推荐字体列表

```typescript
/**
 * 内置字体配置
 * 组合使用多种来源，覆盖中英文场景
 */
export const FONT_FAMILIES = [
  // ========== 系统字体（无需加载）==========
  { id: 'system-ui', name: '系统默认', category: 'system', source: 'system' },
  { id: 'serif', name: '衬线字体', category: 'system', source: 'system' },
  { id: 'sans-serif', name: '无衬线字体', category: 'system', source: 'system' },
  { id: 'monospace', name: '等宽字体', category: 'system', source: 'system' },
  
  // ========== Google Fonts（英文）==========
  { id: 'Roboto', name: 'Roboto', category: 'sans-serif', source: 'google' },
  { id: 'Open Sans', name: 'Open Sans', category: 'sans-serif', source: 'google' },
  { id: 'Montserrat', name: 'Montserrat', category: 'sans-serif', source: 'google' },
  { id: 'Playfair Display', name: 'Playfair Display', category: 'serif', source: 'google' },
  { id: 'Lato', name: 'Lato', category: 'sans-serif', source: 'google' },
  { id: 'Oswald', name: 'Oswald', category: 'sans-serif', source: 'google' },
  { id: 'Poppins', name: 'Poppins', category: 'sans-serif', source: 'google' },
  { id: 'Dancing Script', name: 'Dancing Script', category: 'handwriting', source: 'google' },
  { id: 'Pacifico', name: 'Pacifico', category: 'display', source: 'google' },
  { id: 'Bebas Neue', name: 'Bebas Neue', category: 'display', source: 'google' },
  
  // ========== Google Fonts（中文）==========
  { id: 'Noto Sans SC', name: '思源黑体', category: 'sans-serif', source: 'google' },
  { id: 'Noto Serif SC', name: '思源宋体', category: 'serif', source: 'google' },
  { id: 'Ma Shan Zheng', name: '马善政毛笔楷书', category: 'handwriting', source: 'google' },
  { id: 'ZCOOL XiaoWei', name: '站酷小薇体', category: 'display', source: 'google' },
  { id: 'ZCOOL QingKe HuangYou', name: '站酷庆科黄油体', category: 'display', source: 'google' },
  { id: 'ZCOOL KuaiLe', name: '站酷快乐体', category: 'display', source: 'google' },
  { id: 'Liu Jian Mao Cao', name: '流江毛草', category: 'handwriting', source: 'google' },
  { id: 'Long Cang', name: '龙藏体', category: 'handwriting', source: 'google' },
  
  // ========== 阿里巴巴字体（免费商用）==========
  { id: 'AlibabaPuHuiTi', name: '阿里巴巴普惠体', category: 'sans-serif', source: 'alibaba' },
] as const;

export type FontFamily = typeof FONT_FAMILIES[number]['id'];

/**
 * 字体加载器
 */
export async function loadFont(fontId: string): Promise<void> {
  const font = FONT_FAMILIES.find(f => f.id === fontId);
  if (!font || font.source === 'system') return;
  
  if (font.source === 'google') {
    const link = document.createElement('link');
    link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(fontId)}:wght@400;700&display=swap`;
    link.rel = 'stylesheet';
    document.head.appendChild(link);
    
    // 等待字体加载完成
    await document.fonts.load(`16px "${fontId}"`);
  }
  
  // TODO: 处理阿里巴巴字体等其他来源
}
```

## 3. UI 组件设计

### 3.1 右侧属性面板 (TextStylePanel)

参照剪映截图设计：

```
┌─ 文本属性面板 ────────────────────────────────┐
│                                              │
│ ✕ 关闭                                       │
│                                              │
│ 字体   [ 系统默认         ▼ ]                │
│                                              │
│ 字号   ●━━━━━━━━━━━━━━━━━━━━━━●  [ 48 ]      │
│                                              │
│ 样式   [B] [U] [I]                           │
│                                              │
│ 颜色   [ ████████ ▼ ]        ◇ ← 关键帧按钮  │
│                                              │
│ 字间距  [ 0   ] ↕   行间距  [ 1.2 ] ↕        │
│                                              │
│ 对齐方式  [≡] [≡] [≡]  |  [⋮⋮⋮] [⋮⋮⋮] [⋮⋮⋮]  │
│           左   中  右      上   中   下       │
│                                              │
│ ─────────────────────────────────────────── │
│                                              │
│ 描边                                    [○]  │
│ ├─ 颜色  [ ████████ ]                       │
│ └─ 宽度  [ 2   ] ↕                          │
│                                              │
│ 阴影                                    [○]  │
│ ├─ 颜色  [ ████████ ]                       │
│ ├─ 模糊  [ 4   ] ↕                          │
│ └─ 偏移  X [ 2 ]  Y [ 2 ]                   │
│                                              │
└──────────────────────────────────────────────┘
```

### 3.2 画布文本覆盖层 (TextOverlay)

```
┌─────────────────────────────────────────────────────────────┐
│                           视频画布                           │
│                                                             │
│       ┌─────────────────────────────────────────┐          │
│       │ ○                                     ○ │ ← 缩放手柄│
│       │                                         │          │
│       │          请输入文字内容                  │ ← 文本框  │
│       │                                         │          │
│       │ ○                                     ○ │          │
│       └───────────────────┬─────────────────────┘          │
│                           ○ ← 旋转手柄                      │
│                                                             │
│  交互说明：                                                 │
│  - 点击选中文本，显示边框和控制点                           │
│  - 拖拽中心区域：移动位置                                   │
│  - 拖拽四角：等比缩放                                       │
│  - 拖拽底部圆点：旋转                                       │
│  - 双击：进入文本编辑模式                                   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## 4. 实现计划

### Phase 1: 基础文本功能 (MVP)

- [x] 数据模型设计 (TextStyle 类型)
- [ ] TextStylePanel 组件 - 右侧属性面板
- [ ] TextOverlay 组件 - 画布拖拽交互
- [ ] 文本渲染到画布 (Canvas 2D / HTML overlay)
- [ ] 添加文本 Clip 到时间轴
- [ ] Text 工具按钮集成

### Phase 2: 增强编辑

- [ ] 字体加载器 (Google Fonts 集成)
- [ ] 预设文本模板
- [ ] 复制/粘贴样式
- [ ] 关键帧动画支持（位置、缩放、透明度）

### Phase 3: 高级功能

- [ ] 入场/出场动画预设
- [ ] 文字特效（打字机、弹跳等）
- [ ] 花字模板
- [ ] 文本路径动画

## 5. 技术实现要点

### 5.1 画布文本渲染

```typescript
// 使用 HTML Overlay 方式渲染文本（更好的编辑体验）
// 导出时使用 Canvas 2D 渲染保证一致性

interface TextRenderProps {
  text: string;
  style: TextStyle;
  transform: {
    x: number;
    y: number;
    scale: number;
    rotation: number;
  };
}

function renderTextToCanvas(ctx: CanvasRenderingContext2D, props: TextRenderProps) {
  const { text, style, transform } = props;
  
  ctx.save();
  
  // 应用变换
  ctx.translate(transform.x, transform.y);
  ctx.rotate(transform.rotation * Math.PI / 180);
  ctx.scale(transform.scale, transform.scale);
  
  // 设置字体样式
  const fontWeight = style.bold ? 'bold' : 'normal';
  const fontStyle = style.italic ? 'italic' : 'normal';
  ctx.font = `${fontStyle} ${fontWeight} ${style.fontSize}px "${style.fontFamily}"`;
  ctx.textAlign = style.textAlign;
  ctx.textBaseline = 'middle';
  
  // 描边
  if (style.strokeEnabled) {
    ctx.strokeStyle = style.strokeColor;
    ctx.lineWidth = style.strokeWidth;
    ctx.strokeText(text, 0, 0);
  }
  
  // 填充
  ctx.fillStyle = style.fontColor;
  ctx.fillText(text, 0, 0);
  
  ctx.restore();
}
```

### 5.2 与现有架构集成

文本 Clip 使用现有的 Clip 数据结构，扩展字段：

```typescript
// 创建文本 Clip
const textClip: Clip = {
  id: generateId(),
  trackId: textTrack.id,
  clipType: 'text',
  start: currentTime,
  duration: 5000,  // 默认 5 秒
  sourceStart: 0,
  name: '新建文本',
  contentText: '请输入文字',
  textStyle: DEFAULT_TEXT_STYLE,
  transform: {
    x: 0,
    y: 0,
    scale: 1,
    rotation: 0,
    opacity: 1,
  },
  volume: 1,
  isMuted: false,
  speed: 1,
  color: CLIP_TYPE_COLORS.text,
  isLocal: true,
};
```

## 6. 参考资源

- [Google Fonts](https://fonts.google.com/) - 免费字体库
- [阿里巴巴字体](https://www.alibabafonts.com/) - 免费商用中文字体
- [CapCut Web](https://www.capcut.com/) - 交互参考
- [Fabric.js](http://fabricjs.com/) - Canvas 文本编辑参考

---

*文档版本: 1.0*  
*创建日期: 2026-01-14*
