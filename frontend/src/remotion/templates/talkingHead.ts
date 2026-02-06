/**
 * talkingHead - 口播主导风模版
 * 
 * 适合观点表达、评论、故事讲述
 * 特点:
 * - 口播为主：保持口播画面，观众能看到表情
 * - 关键词弹出：重要内容以叠加组件形式出现
 * - 简洁干净：不干扰观看体验
 */

import type { TemplateConfig } from '../types/visual';

export const talkingHeadTemplate: TemplateConfig = {
  id: 'talking-head',
  name: '口播主导风',
  description: '保持口播画面为主，关键词弹出强调，适合观点表达、故事讲述',
  category: 'story',
  
  // 内容呈现模式
  presentationMode: {
    primary: 'talking-head',       // 口播为主
    talkingHeadRole: 'main',       // 口播是主画面
    infoReveal: 'all-at-once',     // 整体展示
    canvasPersistence: 'none',     // 不使用持续画布
  },
  
  // 视觉风格
  style: {
    primary: '#1F2937',
    secondary: '#4B5563',
    accent: '#3B82F6',             // 蓝色强调色
    
    background: {
      type: 'solid',
      color: 'transparent',        // 口播画面为背景
    },
    
    typography: {
      fontFamily: '"Noto Sans SC", sans-serif',
      headingWeight: 700,
      bodyWeight: 500,
    },
    
    animation: {
      duration: 'fast',
      easing: 'ease-in-out',
    },
    
    borderRadius: 'large',
  },
  
  // 组件配置
  components: {
    canvas: {
      defaultPosition: 'center',
      listStyle: 'bulleted',
      flowConnector: 'line',
    },
    
    overlay: {
      defaultAnimation: {
        enter: 'zoom',
        exit: 'fade',
      },
      highlightBoxStyle: 'solid',
    },
    
    subtitle: {
      style: 'modern',
      background: 'blur',
      highlightColor: '#60A5FA',   // 浅蓝高亮
    },
    
    pip: {
      position: 'bottom-right',
      size: 'small',
      shape: 'circle',
    },
  },
};
