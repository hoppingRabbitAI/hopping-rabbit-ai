/**
 * Remotion Agent Demo Composition
 * 
 * 用于测试和演示所有知识类视觉组件
 */

import React from 'react';
import { AbsoluteFill, Sequence, useVideoConfig } from 'remotion';
import {
  PointListCanvas,
  ProcessFlowCanvas,
  ComparisonCanvas,
  ConceptCard,
  KeywordCard,
  DataNumber,
  HighlightBox,
  QuestionHook,
  ChapterTitle,
  ProgressIndicator,
  QuoteBlock,
  PaperBackground,
} from '../components';

// 演示数据
const demoPointList = {
  title: '不会编程的人，正在超越程序员',
  subtitle: '班尼Benny的头脑风暴',
  items: [
    { id: '1', text: 'Google 和 Claude 内部都在玩', revealAtMs: 0, highlight: { word: '内部都在玩', color: 'green' } },
    { id: '2', text: '普通人享受的技术平权工具！', revealAtMs: 2000 },
    { id: '3', text: 'AI 正在重新定义编程门槛', revealAtMs: 4000 },
  ],
  style: 'handwritten' as const,
  position: 'left' as const,
  background: 'paper' as const,
};

const demoProcessFlow = {
  steps: [
    { id: 's1', text: '如何用最小的成本来验证你的产品能不能活下来？', type: 'question' as const, activateAtMs: 0 },
    { id: 's2', text: 'MVP: 最小可执行产品', type: 'concept' as const, activateAtMs: 2000 },
    { id: 's3', text: '20%的投入就能完成核心功能的闭环', type: 'explanation' as const, activateAtMs: 4000 },
    { id: 's4', text: '你只用做20%，就能撬动80%价值', type: 'conclusion' as const, activateAtMs: 6000 },
  ],
  direction: 'vertical' as const,
  connector: 'arrow' as const,
  background: 'paper' as const,
};

const demoComparison = {
  leftTitle: '方案 A',
  rightTitle: '方案 B',
  rows: [
    { left: '✓ 成本低', right: '✗ 成本高', revealAtMs: 0 },
    { left: '✗ 效率一般', right: '✓ 效率高', revealAtMs: 1500 },
    { left: '✓ 上手快', right: '✗ 学习曲线陡', revealAtMs: 3000 },
  ],
};

const demoConcept = {
  term: 'MVP',
  definition: '最小可执行产品 (Minimum Viable Product)',
  keyPoints: ['核心功能闭环', '20%投入', '快速验证'],
  revealAtMs: 0,
};

/**
 * 完整演示 Composition
 */
export const RemotionAgentDemo: React.FC = () => {
  const { fps, durationInFrames } = useVideoConfig();
  
  // 每个场景 8 秒
  const sceneDuration = 8 * fps;
  
  return (
    <AbsoluteFill style={{ backgroundColor: '#FFFFFF' }}>
      {/* 场景 1: 要点列表 */}
      <Sequence from={0} durationInFrames={sceneDuration} name="PointList Demo">
        <PaperBackground color="#FDF6E3" texture="paper" />
        <PointListCanvas {...demoPointList} />
        <ProgressIndicator current={1} total={4} position="top-right" />
      </Sequence>

      {/* 场景 2: 流程图 */}
      <Sequence from={sceneDuration} durationInFrames={sceneDuration} name="ProcessFlow Demo">
        <PaperBackground color="#FFFEF5" texture="grid" />
        <ProcessFlowCanvas {...demoProcessFlow} />
        <ProgressIndicator current={2} total={4} position="top-right" />
      </Sequence>

      {/* 场景 3: 对比表格 */}
      <Sequence from={sceneDuration * 2} durationInFrames={sceneDuration} name="Comparison Demo">
        <ComparisonCanvas {...demoComparison} />
        <ProgressIndicator current={3} total={4} position="top-right" />
      </Sequence>

      {/* 场景 4: 概念卡片 */}
      <Sequence from={sceneDuration * 3} durationInFrames={sceneDuration} name="ConceptCard Demo">
        <ConceptCard {...demoConcept} />
        <ProgressIndicator current={4} total={4} position="top-right" />
      </Sequence>
    </AbsoluteFill>
  );
};

/**
 * Overlay 组件演示
 */
export const OverlayDemo: React.FC = () => {
  const { fps } = useVideoConfig();
  
  return (
    <AbsoluteFill style={{ backgroundColor: '#1F2937' }}>
      {/* 问题钩子 */}
      <Sequence from={0} durationInFrames={5 * fps} name="QuestionHook">
        <QuestionHook question="你知道为什么大多数创业公司都失败了吗？" position="center" />
      </Sequence>

      {/* 章节标题 */}
      <Sequence from={5 * fps} durationInFrames={3 * fps} name="ChapterTitle">
        <ChapterTitle number={1} title="MVP 方法论" position="center" />
      </Sequence>

      {/* 关键词卡片 */}
      <Sequence from={8 * fps} durationInFrames={4 * fps} name="KeywordCard - Tip">
        <KeywordCard 
          title="💡 核心观点" 
          text="专注比努力更重要" 
          variant="tip" 
          position="center" 
        />
      </Sequence>

      {/* 数据数字 */}
      <Sequence from={12 * fps} durationInFrames={4 * fps} name="DataNumber">
        <DataNumber 
          value="90%" 
          label="创业公司失败率" 
          trend="up" 
          position="center" 
        />
      </Sequence>

      {/* 高亮框 */}
      <Sequence from={16 * fps} durationInFrames={4 * fps} name="HighlightBox">
        <HighlightBox 
          text="快速迭代" 
          color="green" 
          boxStyle="handdrawn" 
          position="center" 
        />
      </Sequence>

      {/* 引用块 */}
      <Sequence from={20 * fps} durationInFrames={4 * fps} name="QuoteBlock">
        <QuoteBlock 
          text="Done is better than perfect." 
          source="Mark Zuckerberg" 
          position="center" 
        />
      </Sequence>
    </AbsoluteFill>
  );
};

// 导出配置
export const remotionAgentCompositions = [
  {
    id: 'RemotionAgentDemo',
    component: RemotionAgentDemo,
    durationInFrames: 32 * 30, // 32 秒 @ 30fps
    fps: 30,
    width: 1920,
    height: 1080,
  },
  {
    id: 'OverlayDemo',
    component: OverlayDemo,
    durationInFrames: 24 * 30, // 24 秒 @ 30fps
    fps: 30,
    width: 1920,
    height: 1080,
  },
];
