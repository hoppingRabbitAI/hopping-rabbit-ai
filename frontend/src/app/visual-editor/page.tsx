import { redirect } from 'next/navigation';

/* VisualEditor 独立入口 — 已迁移到 /p/[projectId] */
export default function VisualEditorPage() {
  redirect('/explore');
}
