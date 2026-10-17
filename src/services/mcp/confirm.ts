// 在 AI 工具里确认（MCP elicitation）：把确认请求转成 elicitation/create 的参数，并解释客户端的答复。

import type { McpConfirmRequest } from './tools';

export type McpConfirmLocation = 'apikit' | 'client';

/** allow / allowAll / deny 是用户的选择；null 表示客户端没法询问，需要回退到 ApiKit 的确认框 */
export type McpElicitationAnswer = 'allow' | 'allowAll' | 'deny' | null;

const DEFAULT_NOTE = 'This makes real network requests with your active environment.';

export function buildElicitation(request: McpConfirmRequest) {
  const message = `Allow ApiKit to run ${request.tool}?\n${request.detail}\n${request.note || DEFAULT_NOTE}`;
  // 删除等不可撤销的操作每次都确认，不提供"全部允许"
  if (request.destructive) return { message, requestedSchema: { type: 'object', properties: {} } };
  return {
    message,
    requestedSchema: {
      type: 'object',
      properties: {
        allowAll: {
          type: 'boolean',
          title: 'Allow all until ApiKit restarts',
          description: 'Do not ask again for requests, workflow runs and environment switches until ApiKit restarts.',
          default: false,
        },
      },
    },
  };
}

/** reply 是客户端答复的 JSON-RPC 消息，含 result 或 error */
export function interpretElicitation(reply: unknown): McpElicitationAnswer {
  const result = (reply as { result?: { action?: unknown; content?: { allowAll?: unknown } } } | null)?.result;
  const action = result?.action;
  if (action === 'accept') return result?.content?.allowAll === true ? 'allowAll' : 'allow';
  if (action === 'decline' || action === 'cancel') return 'deny';
  // 客户端返回了错误或无法识别的答复
  return null;
}
