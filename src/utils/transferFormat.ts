import type { WorkflowDefinition } from '@/types/models';
import { summarizeWorkflow } from '@/utils/workflowTransfer';

export const pluralize = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

/** Workflow 列表右侧的摘要：步骤数、引用的请求数、inline 请求数 */
export const workflowMeta = (workflow: WorkflowDefinition) => {
  const { steps, inline, requestIds } = summarizeWorkflow(workflow);
  const parts = [pluralize(steps, 'step')];
  if (requestIds.size > 0) parts.push(pluralize(requestIds.size, 'request'));
  if (inline > 0) parts.push(`${inline} inline`);
  return parts.join(' · ');
};
