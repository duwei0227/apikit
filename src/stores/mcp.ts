import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { McpConfirmRequest } from '@/services/mcp/tools';
import { buildElicitation, interpretElicitation, type McpConfirmLocation } from '@/services/mcp/confirm';
import type { ConsoleLog } from '@/types/models';

/** Rust 端转发的一次 MCP 工具调用；arguments 是 AI 传来的 JSON，由各工具逐项校验 */
interface McpCallEvent {
  id: string;
  name: string;
  arguments: unknown;
  canElicit?: boolean;
}

export const DEFAULT_MCP_PORT = 27121;
const SETTINGS_KEY = 'apikit-mcp-settings';
const MAX_RECENT_CALLS = 50;

// 工具定义和处理函数较大，启动时用不到：服务启动或收到调用时再加载
const loadTools = () => import('@/services/mcp/tools');

export interface McpSettings {
  enabled: boolean;
  port: number;
  token: string;
  revealSecrets: boolean;
  /** 在哪里确认发送请求、运行 Workflow 和切换环境；client 表示客户端支持时在 AI 工具里确认 */
  confirmIn: McpConfirmLocation;
  /** AI 修改已有的请求和 Workflow 时存为未保存的修改，由用户在 ApiKit 中保存或丢弃 */
  stageEdits: boolean;
}

export interface McpCallRecord {
  id: string;
  time: string;
  tool: string;
  summary: string;
  ok: boolean | null;
  /** 正在等用户在 AI 工具里确认 */
  waitingInClient?: boolean;
  message?: string;
  durationMs?: number;
}

export interface McpPendingConfirmation extends McpConfirmRequest {
  id: string;
  resolve: (allowed: boolean) => void;
}

export interface McpBridgeOptions {
  onConsoleLog: (log: ConsoleLog) => void;
}

const generateToken = (): string => {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
};

const loadSettings = (): McpSettings => {
  const defaults: McpSettings = { enabled: false, port: DEFAULT_MCP_PORT, token: '', revealSecrets: false, confirmIn: 'client', stageEdits: true };
  try {
    const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    return {
      enabled: stored.enabled === true,
      port: Number.isInteger(stored.port) && stored.port > 0 && stored.port < 65536 ? stored.port : DEFAULT_MCP_PORT,
      token: typeof stored.token === 'string' && stored.token.length >= 32 ? stored.token : generateToken(),
      revealSecrets: stored.revealSecrets === true,
      confirmIn: stored.confirmIn === 'apikit' ? 'apikit' : 'client',
      stageEdits: stored.stageEdits !== false,
    };
  } catch {
    return { ...defaults, token: generateToken() };
  }
};

/** 调用记录里显示的简短说明 */
const summarizeArgs = (args: unknown): string => {
  if (!args || typeof args !== 'object') return '';
  const record = args as Record<string, unknown>;
  const request = record.request as Record<string, unknown> | undefined;
  const label = record.name ?? request?.name ?? record.requestId ?? record.workflowId ?? record.collectionId;
  return typeof label === 'string' ? label : '';
};

export const useMcpStore = defineStore('mcp', () => {
  const settings = ref<McpSettings>(loadSettings());
  const running = ref(false);
  const startError = ref('');
  const recentCalls = ref<McpCallRecord[]>([]);
  const pendingConfirmations = ref<McpPendingConfirmation[]>([]);
  // 本次运行期间允许所有执行类调用，重启 ApiKit 后恢复为逐次确认
  const allowAllExecute = ref(false);
  const dialogVisible = ref(false);

  let bridge: McpBridgeOptions | null = null;
  let unlisten: UnlistenFn | null = null;
  let confirmationSequence = 0;

  const endpoint = computed(() => `http://127.0.0.1:${settings.value.port}/mcp`);
  const currentConfirmation = computed(() => pendingConfirmations.value[0] || null);
  const status = computed<'running' | 'stopped' | 'error'>(() => {
    if (startError.value) return 'error';
    return running.value ? 'running' : 'stopped';
  });
  const statusText = computed(() => {
    if (status.value === 'error') return 'MCP server failed to start';
    if (status.value === 'running') return `MCP server running on 127.0.0.1:${settings.value.port}`;
    return 'MCP server is off';
  });

  function saveSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings.value));
    } catch (error) {
      console.error('Failed to save MCP settings:', error);
    }
  }

  function confirm(request: McpConfirmRequest): Promise<boolean> {
    if (allowAllExecute.value && !request.destructive) return Promise.resolve(true);
    return new Promise(resolve => {
      pendingConfirmations.value = [
        ...pendingConfirmations.value,
        { ...request, id: `confirm-${++confirmationSequence}`, resolve },
      ];
    });
  }

  function allowAllThisSession() {
    allowAllExecute.value = true;
    // 已在排队的请求一并放行；删除等不可撤销的操作仍逐个确认
    pendingConfirmations.value.filter(item => !item.destructive).forEach(item => item.resolve(true));
    pendingConfirmations.value = pendingConfirmations.value.filter(item => item.destructive);
  }

  /** 客户端支持并且设置允许时在 AI 工具里确认，否则（或客户端没法询问时）用 ApiKit 的确认框 */
  async function confirmCall(callId: string, canElicit: boolean, request: McpConfirmRequest): Promise<boolean> {
    if (allowAllExecute.value && !request.destructive) return true;
    if (canElicit && settings.value.confirmIn === 'client') {
      setWaitingInClient(callId, true);
      let answer = null;
      try {
        const { message, requestedSchema } = buildElicitation(request);
        answer = interpretElicitation(await invoke('mcp_elicit', { callId, message, requestedSchema }));
      } catch (error) {
        console.error('Failed to ask in the AI tool:', error);
      } finally {
        setWaitingInClient(callId, false);
      }
      if (answer === 'allowAll' && !request.destructive) allowAllThisSession();
      if (answer) return answer !== 'deny';
    }
    return confirm(request);
  }

  function setWaitingInClient(callId: string, waitingInClient: boolean) {
    recentCalls.value = recentCalls.value.map(item => (item.id === callId ? { ...item, waitingInClient } : item));
  }

  function answerConfirmation(id: string, answer: 'deny' | 'allow' | 'allowAll') {
    const pending = pendingConfirmations.value.find(item => item.id === id);
    if (!pending) return;
    if (answer === 'allowAll' && !pending.destructive) {
      allowAllThisSession();
      return;
    }
    pendingConfirmations.value = pendingConfirmations.value.filter(item => item.id !== id);
    pending.resolve(answer === 'allow');
  }

  function rejectPendingConfirmations() {
    pendingConfirmations.value.forEach(item => item.resolve(false));
    pendingConfirmations.value = [];
  }

  async function handleCall(event: McpCallEvent) {
    const { callMcpTool, getMcpTool } = await loadTools();
    if (!getMcpTool(event.name)) return;

    const record: McpCallRecord = {
      id: event.id,
      time: new Date().toISOString(),
      tool: event.name,
      summary: summarizeArgs(event.arguments),
      ok: null,
    };
    recentCalls.value = [record, ...recentCalls.value].slice(0, MAX_RECENT_CALLS);

    const started = Date.now();
    const result = await callMcpTool(event.name, event.arguments, {
      onConsoleLog: log => bridge?.onConsoleLog(log),
      confirm: request => confirmCall(event.id, event.canElicit === true, request),
      revealSecrets: () => settings.value.revealSecrets,
      stageEdits: () => settings.value.stageEdits,
    });

    recentCalls.value = recentCalls.value.map(item => (item.id === record.id
      ? {
        ...item,
        ok: !result.isError,
        message: result.isError ? result.content[0]?.text : undefined,
        durationMs: Date.now() - started,
      }
      : item));

    try {
      await invoke('mcp_respond', { id: event.id, result });
    } catch (error) {
      console.error('Failed to return MCP result:', error);
    }
  }

  async function start() {
    startError.value = '';
    try {
      const { mcpToolList, mcpConfirmToolNames } = await loadTools();
      await invoke('mcp_start', {
        port: settings.value.port,
        token: settings.value.token,
        tools: mcpToolList(),
        confirmTools: mcpConfirmToolNames(),
      });
      running.value = true;
    } catch (error) {
      running.value = false;
      startError.value = typeof error === 'string' ? error : ((error as Error | null)?.message || 'Failed to start the MCP server');
    }
  }

  async function stop() {
    rejectPendingConfirmations();
    try {
      await invoke('mcp_stop');
    } catch (error) {
      console.error('Failed to stop MCP server:', error);
    }
    running.value = false;
  }

  /** App 启动后调用一次：注册事件桥，按设置启动服务 */
  async function initialize(options: McpBridgeOptions) {
    bridge = options;
    saveSettings();
    if (!unlisten) {
      unlisten = await listen<McpCallEvent>('mcp://call', event => {
        void handleCall(event.payload);
      });
    }
    if (settings.value.enabled) await start();
  }

  async function setEnabled(enabled: boolean) {
    settings.value = { ...settings.value, enabled };
    saveSettings();
    if (enabled) {
      await start();
    } else {
      startError.value = '';
      await stop();
    }
  }

  async function setPort(port: number) {
    if (!Number.isInteger(port) || port < 1024 || port > 65535) {
      throw new Error('Port must be between 1024 and 65535');
    }
    if (port === settings.value.port) return;
    settings.value = { ...settings.value, port };
    saveSettings();
    if (settings.value.enabled) await start();
  }

  async function regenerateToken() {
    settings.value = { ...settings.value, token: generateToken() };
    saveSettings();
    if (settings.value.enabled) await start();
  }

  function setRevealSecrets(revealSecrets: boolean) {
    settings.value = { ...settings.value, revealSecrets };
    saveSettings();
  }

  function setConfirmIn(confirmIn: McpConfirmLocation) {
    settings.value = { ...settings.value, confirmIn };
    saveSettings();
  }

  function setStageEdits(stageEdits: boolean) {
    settings.value = { ...settings.value, stageEdits };
    saveSettings();
  }

  function clearRecentCalls() {
    recentCalls.value = [];
  }

  function openDialog() {
    dialogVisible.value = true;
  }

  return {
    settings,
    running,
    startError,
    recentCalls,
    pendingConfirmations,
    currentConfirmation,
    allowAllExecute,
    dialogVisible,
    status,
    statusText,
    endpoint,
    initialize,
    setEnabled,
    setPort,
    regenerateToken,
    setRevealSecrets,
    setConfirmIn,
    setStageEdits,
    answerConfirmation,
    clearRecentCalls,
    openDialog,
  };
});
