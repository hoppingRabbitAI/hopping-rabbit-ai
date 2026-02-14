/**
 * Workflow 模块导出
 */

export type { 
  ClipNodeData, 
  ProcessorNodeData, 
  OutputNodeData, 
  AICapability,
  WorkflowNode,
  WorkflowEdge,
  WorkflowState,
  NodeType,
} from './types';
export { AI_CAPABILITIES } from './types';
export { WorkflowCanvas } from './WorkflowCanvas';
export { ClipNode } from './ClipNode';
export { FileUploadNode } from './FileUploadNode';
export type { FileUploadNodeData, UploadResult } from './FileUploadNode';
export { PromptNode } from './PromptNode';
export type { PromptNodeData, PromptVariant } from './PromptNode';
export { AddButtonEdge } from './AddButtonEdge';
export type { AddButtonEdgeData } from './AddButtonEdge';
export { MaterialPickerModal } from './MaterialPickerModal';
export type { SelectedMaterial } from './MaterialPickerModal';
export { AICapabilityPanel } from './AICapabilityPanel';
export { DrawingCanvas } from './DrawingCanvas';
export { KeyframeEditor } from './KeyframeEditor';
export { TemplateCandidateModal } from './TemplateCandidateModal';
export { GenerationComposerModal } from './GenerationComposerModal';
export { CompositorModal } from './CompositorModal';
export type { CompositorModalProps } from './CompositorModal';
export { TaskProgressPanel } from './TaskProgressPanel';
export { useTaskProgress } from './useTaskProgress';
export type { Task, TaskEvent } from './useTaskProgress';
export type { GenerateParams, GenerateResult, ConfirmParams } from './KeyframeEditor';
