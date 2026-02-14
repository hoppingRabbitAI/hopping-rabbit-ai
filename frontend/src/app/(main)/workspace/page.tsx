'use client';

import { redirect } from 'next/navigation';

/* ================================================================
   Workspace Page — 已迁移到 /p

   保留此文件做重定向，防止旧链接/书签失效
   ================================================================ */

export default function WorkspacePage() {
  redirect('/explore');
}
