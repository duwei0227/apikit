import { generateId } from '@/utils/id-generator';
import { requireRequest, requireWorkflow } from '../lookups';
import { describeRequest } from '../requestFields';
import { fail, requireString } from '../shared';
import type { McpToolContext, McpToolHandler } from '../types';
import { describeStep } from '../workflowSteps';
import { getWorkspaceTabBridge, type WorkspaceTabInspection, type WorkspaceTabDecision } from '@/services/workspaceTabBridge';

type WorkspaceTabType = 'request' | 'workflow';

interface PendingClose {
  type: WorkspaceTabType;
  id: string;
  snapshot: string;
  expiresAt: number;
}

const pendingCloses = new Map<string, PendingClose>();
const CONFIRMATION_TTL_MS = 10 * 60 * 1000;

function pendingClose(type: WorkspaceTabType, id: string, snapshot: string) {
  const now = Date.now();
  for (const [token, item] of pendingCloses) {
    if (item.expiresAt <= now || (item.type === type && item.id === id)) pendingCloses.delete(token);
  }
  const confirmationId = generateId();
  pendingCloses.set(confirmationId, { type, id, snapshot, expiresAt: now + CONFIRMATION_TTL_MS });
  return confirmationId;
}

async function currentSnapshot(type: WorkspaceTabType, inspection: WorkspaceTabInspection): Promise<string> {
  const current = type === 'request' ? inspection.request : inspection.workflow;
  if (!current) fail(`Could not read the current ${type} editor content`);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(current)));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function reviewResponse(
  type: WorkspaceTabType,
  id: string,
  inspection: WorkspaceTabInspection,
  context: McpToolContext,
) {
  const confirmationId = pendingClose(type, id, await currentSnapshot(type, inspection));
  if (type === 'request') {
    return {
      closed: false,
      requiresConfirmation: true,
      confirmationId,
      availableDecisions: inspection.request?.collectionId ? ['save', 'discard'] : ['discard'],
      ...(inspection.request?.collectionId ? {} : {
        saveUnavailableReason: 'Assign this request to a collection in ApiKit before saving it.',
      }),
      hasUnsavedEdits: true,
      request: describeRequest(inspection.request!, context.revealSecrets()),
    };
  }

  const workflow = inspection.workflow!;
  return {
    closed: false,
    requiresConfirmation: true,
    confirmationId,
    availableDecisions: ['save', 'discard'],
    hasUnsavedEdits: true,
    workflow: {
      id: workflow.id,
      name: workflow.name,
      steps: workflow.steps.map(step => describeStep(step, context.revealSecrets())),
    },
  };
}

async function closeTab(
  type: WorkspaceTabType,
  id: string,
  args: Record<string, unknown>,
  context: McpToolContext,
) {
  const bridge = getWorkspaceTabBridge();
  const inspect = type === 'request' ? bridge.inspectRequest : bridge.inspectWorkflow;
  const close = type === 'request' ? bridge.closeRequest : bridge.closeWorkflow;
  const inspection = await inspect(id);
  if (!inspection.isOpen) fail(`The ${type} is not open in ApiKit: ${id}`);

  const decision = args.decision;
  const confirmationId = args.confirmationId;
  if (decision !== undefined && decision !== 'save' && decision !== 'discard') {
    fail('decision must be save or discard');
  }
  if (decision === undefined && confirmationId !== undefined) {
    fail('decision is required with confirmationId');
  }
  if (decision !== undefined && typeof confirmationId !== 'string') {
    fail('confirmationId is required after the user reviews unsaved edits');
  }
  const pending = typeof confirmationId === 'string' ? pendingCloses.get(confirmationId) : undefined;
  if (decision !== undefined
    && (!pending || pending.type !== type || pending.id !== id || pending.expiresAt <= Date.now())) {
    pendingCloses.delete(confirmationId as string);
    fail('The confirmation is missing or expired. Review the current edits again.');
  }

  if (!inspection.hasUnsavedEdits) {
    if (typeof confirmationId === 'string') pendingCloses.delete(confirmationId);
    await close(id);
    return { closed: true, id, type, hasUnsavedEdits: false };
  }

  if (decision === undefined) return reviewResponse(type, id, inspection, context);

  if (!pending) fail('The confirmation is missing or expired. Review the current edits again.');
  if (pending.snapshot !== await currentSnapshot(type, inspection)) {
    pendingCloses.delete(confirmationId as string);
    return reviewResponse(type, id, inspection, context);
  }

  pendingCloses.delete(confirmationId as string);
  await close(id, decision as WorkspaceTabDecision);
  return { closed: true, id, type, decision, hadUnsavedEdits: true };
}

export const workspaceHandlers: Record<string, McpToolHandler> = {
  async open_request(args) {
    const requestId = requireString(args, 'requestId');
    const request = await requireRequest(requestId);
    const bridge = getWorkspaceTabBridge();
    await bridge.openRequest(requestId);
    return { opened: true, requestId, name: request.name };
  },

  async close_request(args, context) {
    return closeTab('request', requireString(args, 'requestId'), args, context);
  },

  async open_workflow(args) {
    const workflowId = requireString(args, 'workflowId');
    const workflow = requireWorkflow(workflowId);
    const bridge = getWorkspaceTabBridge();
    await bridge.openWorkflow(workflowId);
    return { opened: true, workflowId, name: workflow.name };
  },

  async close_workflow(args, context) {
    return closeTab('workflow', requireString(args, 'workflowId'), args, context);
  },
};
