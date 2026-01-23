/**
 * 文本编辑相关类型定义
 * 对标剪映/CapCut 的文本功能
 */

// 调试开关
const DEBUG_ENABLED = process.env.NODE_ENV === 'development';
const debugWarn = (...args: unknown[]) => { if (DEBUG_ENABLED) console.warn(...args); };
const debugError = (...args: unknown[]) => { if (DEBUG_ENABLED) console.error(...args); };

// ==========================================
// 文本样式类型 (TextStyle)
// ==========================================

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
  /** 背景色（支持透明度） */
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
  /** 水平对齐 */
  textAlign: 'left' | 'center' | 'right';
  /** 垂直对齐 */
  verticalAlign: 'top' | 'center' | 'bottom';

  // ========== 描边效果 ==========
  /** 描边开关 */
  strokeEnabled: boolean;
  /** 描边颜色 */
  strokeColor: string;
  /** 描边宽度 */
  strokeWidth: number;

  // ========== 阴影效果 ==========
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

  // ========== 高级效果（可选）==========
  /** 渐变配置 */
  gradient?: TextGradient;
  /** 最大宽度（支持像素数字或百分比字符串，如 400 或 '80%'） */
  maxWidth?: number | string;
}

/**
 * 文本渐变配置
 */
export interface TextGradient {
  type: 'linear' | 'radial';
  colors: string[];
  angle?: number; // 线性渐变角度（度数）
}

/**
 * 默认文本样式
 */
export const DEFAULT_TEXT_STYLE: TextStyle = {
  fontFamily: 'system-ui',
  fontSize: 15,
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
  maxWidth: 160,  // 默认字幕宽度 160px，适合竖屏视频（9:16）
};

// ==========================================
// 字体配置
// ==========================================

export type FontSource = 'system' | 'google' | 'alibaba' | 'custom';
export type FontCategory = 'system' | 'sans-serif' | 'serif' | 'handwriting' | 'display' | 'monospace';

/**
 * 字体配置项
 */
export interface FontConfig {
  id: string;
  name: string;
  displayName: string; // 显示名称（支持中文）
  category: FontCategory;
  source: FontSource;
  /** 字体文件 URL（custom 类型需要） */
  url?: string;
  /** 字体预览文本 */
  previewText?: string;
  /** 支持的字重 */
  weights?: number[];
}

/**
 * 内置字体列表
 * 组合多种来源，覆盖中英文场景
 */
export const FONT_FAMILIES: FontConfig[] = [
  // ========== 系统字体（无需加载）==========
  { id: 'system-ui', name: 'system-ui', displayName: '系统默认', category: 'system', source: 'system' },
  { id: 'serif', name: 'serif', displayName: '衬线字体', category: 'serif', source: 'system' },
  { id: 'sans-serif', name: 'sans-serif', displayName: '无衬线', category: 'sans-serif', source: 'system' },
  { id: 'monospace', name: 'monospace', displayName: '等宽字体', category: 'monospace', source: 'system' },

  // ========== Google Fonts（英文）==========
  { id: 'Roboto', name: 'Roboto', displayName: 'Roboto', category: 'sans-serif', source: 'google', weights: [400, 500, 700] },
  { id: 'Open Sans', name: 'Open Sans', displayName: 'Open Sans', category: 'sans-serif', source: 'google', weights: [400, 600, 700] },
  { id: 'Montserrat', name: 'Montserrat', displayName: 'Montserrat', category: 'sans-serif', source: 'google', weights: [400, 500, 700] },
  { id: 'Playfair Display', name: 'Playfair Display', displayName: 'Playfair Display', category: 'serif', source: 'google', weights: [400, 700] },
  { id: 'Lato', name: 'Lato', displayName: 'Lato', category: 'sans-serif', source: 'google', weights: [400, 700] },
  { id: 'Oswald', name: 'Oswald', displayName: 'Oswald', category: 'sans-serif', source: 'google', weights: [400, 500, 700] },
  { id: 'Poppins', name: 'Poppins', displayName: 'Poppins', category: 'sans-serif', source: 'google', weights: [400, 500, 600, 700] },
  { id: 'Dancing Script', name: 'Dancing Script', displayName: 'Dancing Script', category: 'handwriting', source: 'google', weights: [400, 700] },
  { id: 'Pacifico', name: 'Pacifico', displayName: 'Pacifico', category: 'display', source: 'google', weights: [400] },
  { id: 'Bebas Neue', name: 'Bebas Neue', displayName: 'Bebas Neue', category: 'display', source: 'google', weights: [400] },
  { id: 'Abril Fatface', name: 'Abril Fatface', displayName: 'Abril Fatface', category: 'display', source: 'google', weights: [400] },
  { id: 'Lobster', name: 'Lobster', displayName: 'Lobster', category: 'display', source: 'google', weights: [400] },

  // ========== Google Fonts（中文）==========
  { id: 'Noto Sans SC', name: 'Noto Sans SC', displayName: '思源黑体', category: 'sans-serif', source: 'google', weights: [400, 500, 700], previewText: '思源黑体' },
  { id: 'Noto Serif SC', name: 'Noto Serif SC', displayName: '思源宋体', category: 'serif', source: 'google', weights: [400, 700], previewText: '思源宋体' },
  { id: 'Ma Shan Zheng', name: 'Ma Shan Zheng', displayName: '马善政毛笔楷书', category: 'handwriting', source: 'google', weights: [400], previewText: '毛笔楷书' },
  { id: 'ZCOOL XiaoWei', name: 'ZCOOL XiaoWei', displayName: '站酷小薇体', category: 'display', source: 'google', weights: [400], previewText: '站酷小薇' },
  { id: 'ZCOOL QingKe HuangYou', name: 'ZCOOL QingKe HuangYou', displayName: '站酷庆科黄油体', category: 'display', source: 'google', weights: [400], previewText: '黄油体' },
  { id: 'ZCOOL KuaiLe', name: 'ZCOOL KuaiLe', displayName: '站酷快乐体', category: 'display', source: 'google', weights: [400], previewText: '快乐体' },
  { id: 'Liu Jian Mao Cao', name: 'Liu Jian Mao Cao', displayName: '流江毛草', category: 'handwriting', source: 'google', weights: [400], previewText: '流江毛草' },
  { id: 'Long Cang', name: 'Long Cang', displayName: '龙藏体', category: 'handwriting', source: 'google', weights: [400], previewText: '龙藏体' },
  { id: 'Zhi Mang Xing', name: 'Zhi Mang Xing', displayName: '知萌行', category: 'handwriting', source: 'google', weights: [400], previewText: '知萌行' },
];

/**
 * 按类别分组的字体
 */
export function getFontsByCategory(): Record<FontCategory, FontConfig[]> {
  const grouped: Record<FontCategory, FontConfig[]> = {
    system: [],
    'sans-serif': [],
    serif: [],
    handwriting: [],
    display: [],
    monospace: [],
  };

  FONT_FAMILIES.forEach((font) => {
    grouped[font.category].push(font);
  });

  return grouped;
}

/**
 * 加载状态缓存
 */
const loadedFonts = new Set<string>();
const loadingFonts = new Map<string, Promise<void>>();

/**
 * 加载单个字体
 * @param fontId 字体 ID
 * @returns Promise，字体加载完成后 resolve
 */
export async function loadFont(fontId: string): Promise<void> {
  // 已加载
  if (loadedFonts.has(fontId)) return;

  // 正在加载
  const existing = loadingFonts.get(fontId);
  if (existing) return existing;

  const font = FONT_FAMILIES.find((f) => f.id === fontId);
  if (!font) {
    debugWarn(`Font not found: ${fontId}`);
    return;
  }

  // 系统字体无需加载
  if (font.source === 'system') {
    loadedFonts.add(fontId);
    return;
  }

  const loadPromise = (async () => {
    try {
      if (font.source === 'google') {
        // 构建 Google Fonts URL
        const weights = font.weights?.join(';') || '400;700';
        const fontName = encodeURIComponent(font.name);
        const url = `https://fonts.googleapis.com/css2?family=${fontName}:wght@${weights}&display=swap`;

        // 检查是否已存在
        const existingLink = document.querySelector(`link[href="${url}"]`);
        if (!existingLink) {
          const link = document.createElement('link');
          link.href = url;
          link.rel = 'stylesheet';
          document.head.appendChild(link);
        }

        // 等待字体实际加载
        await document.fonts.load(`400 16px "${font.name}"`);
      }

      loadedFonts.add(fontId);
    } catch (error) {
      debugError(`Failed to load font: ${fontId}`, error);
    } finally {
      loadingFonts.delete(fontId);
    }
  })();

  loadingFonts.set(fontId, loadPromise);
  return loadPromise;
}

/**
 * 预加载常用字体
 */
export async function preloadCommonFonts(): Promise<void> {
  const commonFonts = ['Noto Sans SC', 'Roboto', 'Montserrat'];
  await Promise.all(commonFonts.map(loadFont));
}

/**
 * 检查字体是否已加载
 */
export function isFontLoaded(fontId: string): boolean {
  const font = FONT_FAMILIES.find((f) => f.id === fontId);
  if (!font) return false;
  if (font.source === 'system') return true;
  return loadedFonts.has(fontId);
}

// ==========================================
// 文本预设模板
// ==========================================

export interface TextPreset {
  id: string;
  name: string;
  category: 'title' | 'subtitle' | 'caption' | 'fancy' | 'minimal';
  style: Partial<TextStyle>;
  /** 预览图片 URL */
  thumbnail?: string;
}

/**
 * 预设文本模板 - 剪映风格
 */
export const TEXT_PRESETS: TextPreset[] = [
  // 第一行 - 无样式 + 基础颜色
  { id: 'none', name: '无', category: 'minimal', style: {} },
  { id: 'white', name: '白色', category: 'minimal', style: { fontColor: '#FFFFFF', fontSize: 48 } },
  { id: 'black', name: '黑色', category: 'minimal', style: { fontColor: '#000000', fontSize: 48 } },
  { id: 'yellow', name: '黄色', category: 'minimal', style: { fontColor: '#FFEB3B', fontSize: 48 } },
  { id: 'red', name: '红色', category: 'minimal', style: { fontColor: '#F44336', fontSize: 48 } },
  { id: 'pink', name: '粉色', category: 'minimal', style: { fontColor: '#E91E63', fontSize: 48 } },
  { id: 'cyan', name: '青色', category: 'minimal', style: { fontColor: '#00BCD4', fontSize: 48 } },
  { id: 'green', name: '绿色', category: 'minimal', style: { fontColor: '#4CAF50', fontSize: 48 } },
  
  // 第二行 - 描边样式
  { id: 'blue-stroke', name: '蓝描边', category: 'title', style: { fontColor: '#2196F3', fontSize: 48, strokeEnabled: true, strokeColor: '#000000', strokeWidth: 2 } },
  { id: 'red-stroke', name: '红描边', category: 'title', style: { fontColor: '#F44336', fontSize: 48, strokeEnabled: true, strokeColor: '#000000', strokeWidth: 2 } },
  { id: 'green-stroke', name: '绿描边', category: 'title', style: { fontColor: '#4CAF50', fontSize: 48, strokeEnabled: true, strokeColor: '#000000', strokeWidth: 2 } },
  { id: 'purple-stroke', name: '紫描边', category: 'title', style: { fontColor: '#9C27B0', fontSize: 48, strokeEnabled: true, strokeColor: '#000000', strokeWidth: 2 } },
  { id: 'orange-stroke', name: '橙描边', category: 'title', style: { fontColor: '#FF9800', fontSize: 48, strokeEnabled: true, strokeColor: '#000000', strokeWidth: 2 } },
  { id: 'teal-stroke', name: '青描边', category: 'title', style: { fontColor: '#009688', fontSize: 48, strokeEnabled: true, strokeColor: '#000000', strokeWidth: 2 } },
  
  // 第三行 - 背景色样式
  { id: 'black-bg', name: '黑底白字', category: 'subtitle', style: { fontColor: '#FFFFFF', fontSize: 48, backgroundColor: '#000000' } },
  { id: 'white-bg', name: '白底黑字', category: 'subtitle', style: { fontColor: '#000000', fontSize: 48, backgroundColor: '#FFFFFF' } },
  { id: 'yellow-bg', name: '黄底黑字', category: 'subtitle', style: { fontColor: '#000000', fontSize: 48, backgroundColor: '#FFEB3B' } },
  { id: 'pink-bg', name: '粉底深字', category: 'subtitle', style: { fontColor: '#880E4F', fontSize: 48, backgroundColor: '#F8BBD9' } },
  { id: 'dark-bg', name: '深底白字', category: 'subtitle', style: { fontColor: '#FFFFFF', fontSize: 48, backgroundColor: '#37474F' } },
  
  // 第四行 - 渐变/发光样式
  { id: 'neon-cyan', name: '霓虹青', category: 'fancy', style: { fontColor: '#00FFFF', fontSize: 48, shadowEnabled: true, shadowColor: '#00FFFF', shadowBlur: 15, shadowOffsetX: 0, shadowOffsetY: 0 } },
  { id: 'rainbow-blue', name: '彩蓝', category: 'fancy', style: { fontColor: '#64B5F6', fontSize: 48, strokeEnabled: true, strokeColor: '#E91E63', strokeWidth: 1 } },
  { id: 'rainbow-pink', name: '彩粉', category: 'fancy', style: { fontColor: '#F48FB1', fontSize: 48, strokeEnabled: true, strokeColor: '#7C4DFF', strokeWidth: 1 } },
  { id: 'gold', name: '金黄', category: 'fancy', style: { fontColor: '#FFD54F', fontSize: 48, strokeEnabled: true, strokeColor: '#FF6F00', strokeWidth: 1 } },
  { id: 'neon-orange', name: '霓虹橙', category: 'fancy', style: { fontColor: '#FF9800', fontSize: 48, shadowEnabled: true, shadowColor: '#FF5722', shadowBlur: 12, shadowOffsetX: 0, shadowOffsetY: 0 } },
  { id: 'neon-green', name: '霓虹绿', category: 'fancy', style: { fontColor: '#76FF03', fontSize: 48, shadowEnabled: true, shadowColor: '#00E676', shadowBlur: 12, shadowOffsetX: 0, shadowOffsetY: 0 } },
];

/**
 * 获取预设模板的完整样式
 */
export function getPresetStyle(presetId: string): TextStyle {
  const preset = TEXT_PRESETS.find((p) => p.id === presetId);
  return {
    ...DEFAULT_TEXT_STYLE,
    ...(preset?.style || {}),
  };
}
