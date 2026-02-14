'use client';

import React from 'react';
import { useParams } from 'next/navigation';
import { WorkspaceLayout } from '@/components/layout/WorkspaceLayout';

/* ================================================================
   /p/[projectId] — 项目画布

   直接进画布，不走 Explore。
   ================================================================ */

export default function ProjectPage() {
  const { projectId } = useParams<{ projectId: string }>();

  return <WorkspaceLayout initialProjectId={projectId} initialView="project" />;
}
