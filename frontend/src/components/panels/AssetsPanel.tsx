'use client';

import React from 'react';
import { MyMaterialsView } from '@/components/workspace/MyMaterialsView';

/* ================================================================
   AssetsPanel — Sidebar 二级面板中的素材管理

   直接复用 MyMaterialsView 组件（AI 创作 + 用户素材）
   面板形式展示，不需要额外包装
   ================================================================ */

export function AssetsPanel() {
  return (
    <div className="h-full">
      <MyMaterialsView />
    </div>
  );
}
