'use client';

import { WorkspaceLayout } from '@/components/layout/WorkspaceLayout';

/* ================================================================
   /explore — Explore 入口

   登录后的默认首页。展示模板瀑布流 + 灵感发现。
   项目在后台静默准备，用户点击项目才进 /p/{id}。
   ================================================================ */

export default function ExplorePage() {
  return <WorkspaceLayout initialView="explore" />;
}
