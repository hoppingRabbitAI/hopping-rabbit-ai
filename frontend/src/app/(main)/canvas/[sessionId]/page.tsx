'use client';

import React, { useEffect, useCallback, useState, Suspense } from 'react';
import { useParams, useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { Loader2, Plus } from 'lucide-react';

// ★ VisualEditor — 老系统完整画布引擎 (500 行)
//   内部包含: WorkflowCanvas + MainTimeline + 分镜加载 + 轮询 + 撤销重做
//   通过 props 接收 projectId/sessionId，不依赖 URL 参数
const VisualEditor = dynamic(
  () => import('@/components/visual-editor/VisualEditor'),
  { ssr: false },
);

// ★ PRD v1.1 新增 — 意图分析面板
import { IntentPanel } from '@/components/canvas/IntentPanel';

// ★ canvasStore 仅用于 IntentRouter 状态 (isAnalyzing, routeResult...)
import { useCanvasStore } from '@/stores/canvasStore';

// API
import { canvasApi, intentRouterApi } from '@/lib/api';
import type { CapabilityType } from '@/types/discover';

/* ================================================================
   Canvas Session Page — PRD §3.3

   治标治本思路:
   ┌─────────────────────────────────────────────────────────┐
   │ 不再自己拼 Shot / 调 WorkflowCanvas / 管 store         │
   │                                                         │
   │ 正确做法:                                               │
   │  1. 加载 canvas_session → 拿到 project_id              │
   │  2. 用 VisualEditor(projectId, sessionId, hideHeader)  │
   │     VisualEditor 内部完成:                              │
   │       - 通过 projectId 查找/加载 shot-segmentation     │
   │       - 自动轮询分镜结果 → formatClipsToShots          │
   │       - 渲染 WorkflowCanvas + MainTimeline             │
   │       - 撤销/重做 / 自由节点 / 画布连线                │
   │  3. IntentPanel 叠加在左侧作为 PRD 输入层              │
   └─────────────────────────────────────────────────────────┘

   布局:
   ┌──────────┬────────────────────────────────────┐
   │          │                                    │
   │  Intent  │      VisualEditor                  │
   │  Panel   │   (含 WorkflowCanvas + Timeline)   │
   │  260px   │   完整的分镜加载 · 节点拖拽 · 连线  │
   │          │   对齐 · AI 右键 · 自由节点 · 循环   │
   │          │                                    │
   └──────────┴────────────────────────────────────┘
   ================================================================ */

export default function CanvasSessionPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const router = useRouter();

  // ★ PRD IntentRouter 状态
  const intentStore = useCanvasStore();
  const intent = useCanvasStore((s) => s.intent);

  // 本地 UI 状态
  const [userPhotoUrl, setUserPhotoUrl] = useState<string | null>(null);
  const [referenceUrl, setReferenceUrl] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [segSessionId, setSegSessionId] = useState<string | null>(null);
  const [isResolved, setIsResolved] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);

  // ==========================
  // 初始化: canvas session → 解析 project_id
  // ==========================
  useEffect(() => {
    if (!sessionId || isResolved) return;

    intentStore.initSession(sessionId);

    (async () => {
      try {
        const res = await canvasApi.getSession(sessionId);
        if (res.data) {
          const session = res.data;
          const state = (session.state ?? {}) as Record<string, any>;

          // 提取照片 URL（用于 IntentPanel 显示）
          const uPhoto: string | null =
            state.user_photo_url ?? (session as any).subject_url ?? null;
          const refUrl: string | null =
            state.reference_url ?? (session as any).reference_url ?? null;
          if (uPhoto) setUserPhotoUrl(uPhoto);
          if (refUrl) setReferenceUrl(refUrl);

          // 提取路由结果
          if (state.route_result || (session as any).route_result) {
            intentStore.setRouteResult(state.route_result ?? (session as any).route_result);
          }

          // ★ 关键: 从 canvas session 中获取 project_id
          //   如果 state 中记录了 project_id → 直接使用
          //   否则尝试用 session 的 template_id 或者 id 作为 fallback
          const pId = state.project_id ?? (session as any).project_id ?? null;
          const sId = state.seg_session_id ?? (session as any).seg_session_id ?? null;

          if (pId) {
            setProjectId(pId);
            if (sId) setSegSessionId(sId);
            console.log('[Canvas] 关联 project:', pId, 'seg_session:', sId);
          } else {
            // 未关联 project — VisualEditor 会显示空画布
            // 用户可以通过 IntentPanel 上传素材来创建项目
            console.log('[Canvas] 无关联 project，等待用户操作');
          }
        }
      } catch (err) {
        console.warn('[Canvas] 加载 session 失败:', err);
        setResolveError('画布会话加载失败');
      }

      setIsResolved(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // ==========================
  // IntentPanel 回调
  // ==========================

  /** 用户上传我的照片 */
  const handleUserPhotoSelect = useCallback(
    (file: File) => {
      const url = URL.createObjectURL(file);
      setUserPhotoUrl(url);
    },
    [],
  );

  /** 用户上传参考图 + 自动触发分析 */
  const handleReferenceSelect = useCallback(
    (file: File) => {
      const url = URL.createObjectURL(file);
      setReferenceUrl(url);

      if (userPhotoUrl || url) {
        intentStore.setAnalyzing(true);
        intentRouterApi
          .analyze({ subject_url: userPhotoUrl ?? undefined, reference_url: url })
          .then((res) => {
            if (res.data) intentStore.setRouteResult(res.data);
          })
          .catch(() => {
            intentStore.setAnalysisDescription('分析失败，请手动添加能力节点');
          })
          .finally(() => intentStore.setAnalyzing(false));
      }
    },
    [intentStore, userPhotoUrl],
  );

  /** 清除我的照片 */
  const handleUserPhotoClear = useCallback(() => {
    setUserPhotoUrl(null);
  }, []);

  /** 清除参考图 */
  const handleReferenceClear = useCallback(() => {
    setReferenceUrl(null);
  }, []);

  /** 文字描述分析 */
  const handleTextSubmit = useCallback(async () => {
    const text = intent.referenceText;
    if (!text.trim()) return;
    intentStore.setAnalyzing(true);
    try {
      const res = await intentRouterApi.analyzeText({
        text,
        subject_url: userPhotoUrl ?? undefined,
      });
      if (res.data) intentStore.setRouteResult(res.data);
    } catch (err) {
      console.error('[Canvas] Text analysis failed:', err);
      intentStore.setAnalysisDescription('文字分析失败，请手动添加能力节点');
    } finally {
      intentStore.setAnalyzing(false);
    }
  }, [intentStore, intent.referenceText, userPhotoUrl]);

  /** 手动添加能力 */
  const handleAddCapability = useCallback((_type: CapabilityType) => {
    // TODO Phase 1: 通过 WorkflowCanvas 右键菜单的 AI 能力系统
    console.log('[Canvas] Add capability via IntentPanel:', _type);
  }, []);

  // ==========================
  // 渲染
  // ==========================

  // 正在解析 canvas session
  if (!isResolved) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-3.5rem)] bg-surface-base">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-accent-core mx-auto mb-3" />
          <p className="text-sm text-hr-text-tertiary">正在加载画布…</p>
        </div>
      </div>
    );
  }

  // 解析失败
  if (resolveError) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-3.5rem)] bg-surface-base">
        <div className="text-center max-w-sm bg-white p-8 rounded-2xl shadow-card border border-hr-border-dim">
          <p className="text-semantic-error font-medium mb-2">加载失败</p>
          <p className="text-sm text-hr-text-tertiary mb-4">{resolveError}</p>
          <div className="flex gap-3 justify-center">
            <button
              onClick={() => {
                setResolveError(null);
                setIsResolved(false);
              }}
              className="px-4 py-2 bg-surface-raised text-hr-text-primary rounded-xl text-sm font-medium hover:bg-surface-hover transition-colors"
            >
              重试
            </button>
            <button
              onClick={() => router.push('/canvas?new=1')}
              className="px-4 py-2 bg-accent-core text-white rounded-xl text-sm font-medium hover:bg-accent-hover transition-colors"
            >
              新建画布
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-3.5rem)] overflow-hidden bg-surface-base">
      {/* ★ 左侧: IntentPanel — PRD v1.1 的"参考图驱动"输入层 */}
      <IntentPanel
        userPhotoUrl={userPhotoUrl}
        referenceUrl={referenceUrl}
        referenceText={intent.referenceText}
        isAnalyzing={intent.isAnalyzing}
        analysisDescription={intent.analysisDescription}
        inputMode={intent.inputMode}
        onUserPhotoSelect={handleUserPhotoSelect}
        onUserPhotoClear={handleUserPhotoClear}
        onReferenceSelect={handleReferenceSelect}
        onReferenceClear={handleReferenceClear}
        onReferenceTextChange={(text) => intentStore.setReferenceText(text)}
        onInputModeChange={(mode) => intentStore.setInputMode(mode)}
        onTextSubmit={handleTextSubmit}
        onAddCapability={handleAddCapability}
      />

      {/* ★ 中央: VisualEditor — 老系统完整画布引擎
          VisualEditor 内部自动完成:
          1. 通过 projectId 查找 shot-segmentation session
          2. 自动加载/轮询分镜结果 → Shot[]
          3. 渲染 WorkflowCanvas (1781行) + MainTimeline (623行)
          4. 管理 visualEditorStore (撤销/重做/自由节点/画布连线)
      */}
      <div className="flex-1 overflow-hidden relative">
        {projectId ? (
          <Suspense
            fallback={
              <div className="h-full w-full flex items-center justify-center bg-surface-base">
                <Loader2 className="w-8 h-8 animate-spin text-accent-core" />
              </div>
            }
          >
            <VisualEditor
              projectId={projectId}
              hideHeader
              className="!bg-surface-base"
            />
          </Suspense>
        ) : (
          <div className="h-full w-full flex items-center justify-center bg-surface-base">
            <Loader2 className="w-8 h-8 animate-spin text-accent-core" />
          </div>
        )}
      </div>
    </div>
  );
}
