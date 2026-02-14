/* ================================================================
   /p Layout — 新版 Workspace 路由组

   所有 /p/[projectId] 路由共用
   AuthGuard 已在根 layout.tsx 中提供
   ================================================================ */

export default function ProjectLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
