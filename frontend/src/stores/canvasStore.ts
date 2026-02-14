'use client';

import { create } from 'zustand';
import type { RouteResult } from '@/types/discover';

/* ================================================================
   Canvas Store — IntentRouter 状态管理

   画布节点/边/执行状态已迁移到 visualEditorStore
   后端数据源已迁移到 canvas_nodes + canvas_edges 表
   本 Store 仅保留 IntentRouter 相关状态
   ================================================================ */

/* ---------- IntentRouter State ---------- */

interface IntentRouterState {
  isAnalyzing: boolean;
  routeResult: RouteResult | null;
  confidence: number;
  analysisDescription: string;
  inputMode: 'image' | 'text';
  referenceText: string;
}

interface CanvasState {
  sessionId: string | null;
  templateId: string | null;
  intent: IntentRouterState;
}

interface CanvasActions {
  initSession: (sessionId: string, templateId?: string) => void;
  setAnalyzing: (v: boolean) => void;
  setRouteResult: (result: RouteResult | null) => void;
  setInputMode: (mode: 'image' | 'text') => void;
  setReferenceText: (text: string) => void;
  setAnalysisDescription: (desc: string) => void;
  reset: () => void;
}

const initialIntent: IntentRouterState = {
  isAnalyzing: false,
  routeResult: null,
  confidence: 0,
  analysisDescription: '',
  inputMode: 'image',
  referenceText: '',
};

const initialState: CanvasState = {
  sessionId: null,
  templateId: null,
  intent: { ...initialIntent },
};

export const useCanvasStore = create<CanvasState & CanvasActions>((set) => ({
  ...initialState,

  initSession: (sessionId, templateId) =>
    set({ ...initialState, sessionId, templateId: templateId ?? null }),

  setAnalyzing: (isAnalyzing) =>
    set((s) => ({ intent: { ...s.intent, isAnalyzing } })),

  setRouteResult: (routeResult) =>
    set((s) => ({
      intent: {
        ...s.intent,
        routeResult,
        confidence: routeResult?.confidence ?? 0,
        analysisDescription: routeResult?.overall_description ?? '',
      },
    })),

  setInputMode: (inputMode) =>
    set((s) => ({ intent: { ...s.intent, inputMode } })),

  setReferenceText: (referenceText) =>
    set((s) => ({ intent: { ...s.intent, referenceText } })),

  setAnalysisDescription: (analysisDescription) =>
    set((s) => ({ intent: { ...s.intent, analysisDescription } })),

  reset: () => set(initialState),
}));
