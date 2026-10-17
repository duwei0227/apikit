import type { Request, WorkflowDefinition } from '@/types/models';

export type WorkspaceTabDecision = 'save' | 'discard';

export interface WorkspaceTabInspection {
  isOpen: boolean;
  hasUnsavedEdits: boolean;
  request?: Request;
  workflow?: WorkflowDefinition;
}

export interface WorkspaceTabBridge {
  openRequest: (requestId: string) => Promise<void>;
  openWorkflow: (workflowId: string) => Promise<void>;
  inspectRequest: (requestId: string) => Promise<WorkspaceTabInspection>;
  inspectWorkflow: (workflowId: string) => Promise<WorkspaceTabInspection>;
  closeRequest: (requestId: string, decision?: WorkspaceTabDecision) => Promise<void>;
  closeWorkflow: (workflowId: string, decision?: WorkspaceTabDecision) => Promise<void>;
}

let workspaceTabBridge: WorkspaceTabBridge | null = null;

export function registerWorkspaceTabBridge(bridge: WorkspaceTabBridge): () => void {
  workspaceTabBridge = bridge;
  return () => {
    if (workspaceTabBridge === bridge) workspaceTabBridge = null;
  };
}

export function getWorkspaceTabBridge(): WorkspaceTabBridge {
  if (!workspaceTabBridge) throw new Error('ApiKit workspace is not ready');
  return workspaceTabBridge;
}
