/**
 * HoppingRabbit AI - Rabbit Hole 路由页面
 * AI 口型同步功能入口
 */

import { Metadata } from 'next';
import { RabbitHolePage } from '@/features/editor/components/RabbitHolePage';

export const metadata: Metadata = {
  title: 'Rabbit Hole - AI 口型同步 | HoppingRabbit AI',
  description: '上传你的视频和音频，AI 自动同步口型，生成自然流畅的口播视频',
};

export default function Page() {
  return <RabbitHolePage />;
}
