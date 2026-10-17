// MCP 工具：定义与执行。Rust 端只负责协议，所有读写都经过这里调用 Pinia store，界面实时同步。

import { MCP_TOOLS } from './definitions';
import { collectionHandlers } from './handlers/collections';
import { environmentHandlers } from './handlers/environments';
import { logHandlers } from './handlers/logs';
import { requestHandlers } from './handlers/requests';
import { variableHandlers } from './handlers/variables';
import { workspaceHandlers } from './handlers/workspace';
import { workflowHandlers } from './handlers/workflows';
import { isRecord } from './shared';
import { type McpToolContext, type McpToolResult, McpToolError, type McpToolHandler } from './types';

export * from './types';
export { MCP_TOOLS } from './definitions';
export { buildWorkflowSteps } from './workflowSteps';

const HANDLERS: Record<string, McpToolHandler> = {
  ...collectionHandlers,
  ...requestHandlers,
  ...workflowHandlers,
  ...environmentHandlers,
  ...variableHandlers,
  ...logHandlers,
  ...workspaceHandlers,
};

const TOOLS_BY_NAME = new Map(MCP_TOOLS.map(tool => [tool.name, tool]));

/** 交给 Rust 端的 tools/list 内容 */
export const mcpToolList = () => MCP_TOOLS.map(tool => ({
  name: tool.name,
  title: tool.title,
  description: tool.description,
  inputSchema: tool.inputSchema,
  annotations: {
    readOnlyHint: tool.kind === 'read',
    destructiveHint: tool.destructive === true,
    idempotentHint: tool.kind === 'read',
    openWorldHint: tool.kind === 'execute' && !tool.localOnly,
  },
}));

export const getMcpTool = (name: string) => TOOLS_BY_NAME.get(name);

/** 可能请用户确认的工具；支持 elicitation 的客户端调用它们时，服务端用事件流应答 */
export const mcpConfirmToolNames = () => MCP_TOOLS
  .filter(tool => tool.kind === 'execute' || tool.mayConfirm || tool.destructive)
  .map(tool => tool.name);

export async function callMcpTool(name: string, rawArgs: unknown, context: McpToolContext): Promise<McpToolResult> {
  try {
    const handler = HANDLERS[name];
    if (!handler) throw new McpToolError(`Unknown tool: ${name}`);
    const args = isRecord(rawArgs) ? rawArgs : {};
    const result = await handler(args, context);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  } catch (error) {
    return { content: [{ type: 'text', text: (error as Error | null)?.message || String(error) }], isError: true };
  }
}
