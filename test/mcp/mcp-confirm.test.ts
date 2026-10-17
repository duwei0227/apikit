import { describe, expect, it } from 'vitest';
import { buildElicitation, interpretElicitation } from '@/services/mcp/confirm';
import { mcpConfirmToolNames } from '@/services/mcp/tools';

describe('MCP confirmation in the AI tool', () => {
  it('MCP-CONFIRM-001 builds an elicitation with a flat schema', () => {
    const elicitation = buildElicitation({ tool: 'send_request', title: 'AI wants to send a request', detail: 'GET https://httpbin.org/get' });
    expect(elicitation.message).toBe(
      'Allow ApiKit to run send_request?\nGET https://httpbin.org/get\nThis makes real network requests with your active environment.',
    );
    // elicitation 的 schema 只能是一层基本类型的属性
    expect(elicitation.requestedSchema.type).toBe('object');
    expect(elicitation.requestedSchema.properties.allowAll?.type).toBe('boolean');
    expect(elicitation.requestedSchema).not.toHaveProperty('required');

    const withNote = buildElicitation({ tool: 'set_active_environment', title: 't', detail: 'Production', note: 'Requests use it.' });
    expect(withNote.message).toBe('Allow ApiKit to run set_active_environment?\nProduction\nRequests use it.');
  });

  it('MCP-CONFIRM-002 maps the client reply to an answer', () => {
    expect(interpretElicitation({ result: { action: 'accept', content: {} } })).toBe('allow');
    expect(interpretElicitation({ result: { action: 'accept' } })).toBe('allow');
    expect(interpretElicitation({ result: { action: 'accept', content: { allowAll: false } } })).toBe('allow');
    expect(interpretElicitation({ result: { action: 'accept', content: { allowAll: true } } })).toBe('allowAll');
    expect(interpretElicitation({ result: { action: 'decline' } })).toBe('deny');
    expect(interpretElicitation({ result: { action: 'cancel' } })).toBe('deny');
    // 客户端不支持或答复无法识别时回退到 ApiKit 的确认框
    expect(interpretElicitation({ error: { code: -32601, message: 'Method not found' } })).toBeNull();
    expect(interpretElicitation({ result: {} })).toBeNull();
    expect(interpretElicitation(undefined)).toBeNull();
  });

  it('MCP-CONFIRM-003 lists the tools that may ask the user', () => {
    expect(mcpConfirmToolNames().sort()).toEqual([
      'create_environment', 'delete_collection', 'delete_folder', 'delete_request', 'delete_workflow',
      'run_workflow', 'send_request', 'set_active_environment',
    ]);
  });

  it('MCP-CONFIRM-004 does not offer allow all for destructive actions', () => {
    const elicitation = buildElicitation({ tool: 'delete_request', title: 't', detail: 'GET Login', note: 'Deleted.', destructive: true });
    expect(elicitation.message).toBe('Allow ApiKit to run delete_request?\nGET Login\nDeleted.');
    expect(elicitation.requestedSchema).toEqual({ type: 'object', properties: {} });
  });
});
