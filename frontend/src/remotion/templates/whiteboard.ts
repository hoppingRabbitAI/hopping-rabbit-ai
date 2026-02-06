/**
 * whiteboard - 白板讲解风模版
 * 
 * 知识博主常用的内容呈现风格
 * 特点:
 * - 画布为主：白色/米黄画布占据主要画面
 * - 口播为辅：博主以 PiP 小窗形式出现
 * - 递进展示：内容按逻辑层层递进，用箭头连接
 * - 手绘风格：边框、箭头模拟手绘效果
 * - 重点高亮：关键词用彩色框标注
 */

import type { TemplateConfig } from '../types/visual';

export const whiteboardTemplate: TemplateConfig = {
  id: 'whiteboard',
  name: '白板讲解风',
  description: '画布为主、逻辑递进的知识分享风格，适合概念解释、方法论讲解',
  category: 'knowledge',
  
  // 内容呈现模式
  presentationMode: {
    primary: 'canvas',            // 画布为主
    talkingHeadRole: 'pip',       // 口播作为小窗
    infoReveal: 'progressive',    // 渐进式展示
    canvasPersistence: 'persistent',  // 画布持续显示
  },
  
  // 视觉风格
  style: {
    primary: '#333333',
    secondary: '#666666',
    accent: '#4CAF50',            // 绿色强调色
    
    background: {
      type: 'paper',
      color: '#FFFEF5',           // 米黄纸张色
      texture: 'paper',
    },
    
    typography: {
      fontFamily: '"ZCOOL XiaoWei", "Noto Sans SC", sans-serif',
      headingWeight: 700,
      bodyWeight: 400,
    },
    
    animation: {
      duration: 'normal',
      easing: 'ease-out',
    },
    
    borderRadius: 'medium',
  },
  
  // 组件配置
  components: {
    canvas: {
      defaultPosition: 'center',
      listStyle: 'handwritten',
      flowConnector: 'arrow',      // 箭头连接
    },
    
    overlay: {
      defaultAnimation: {
        enter: 'draw',             // 手绘效果入场
        exit: 'fade',
      },
      highlightBoxStyle: 'handdrawn',
    },
    
    subtitle: {
      style: 'handwritten',
      background: 'none',
      highlightColor: '#FFEB3B',   // 黄色高亮
    },
    
    pip: {
      position: 'bottom-center',
      size: 'medium',
      shape: 'rectangle',
    },
  },
};
