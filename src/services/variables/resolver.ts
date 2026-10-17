// {{变量}} 解析服务：合并全局变量、当前环境变量和内置动态变量。
// 请求编辑器、Workflow、MCP 等都通过这里替换变量，不再依赖 EnvironmentManager 组件实例。

import { useEnvironmentsStore } from '@/stores/environments';
import { useSequencesStore, type SequencePreviewCursor } from '@/stores/sequences';
import { createBuiltInValues, LOOP_INDEX_VARIABLE, parseSequenceCall, resolveDynamicFunction } from './dynamicVariables';

export type VariableResolver = (value: string) => string;

interface ResolutionContext {
  now: Date;
  allVars: Record<string, string>;
  /** false 表示预览：只在本次会话内模拟序列步进，不推进真实序列 */
  consumeSequences: boolean;
  /** 同一会话内同名变量取同一个值（$sequence 除外，每次出现都步进） */
  resolvedValues: Map<string, string> | null;
  sequenceStates: Map<string, SequencePreviewCursor>;
}

const VARIABLE_PATTERN = /\{\{([^}]+)\}\}/g;

/** 当前可用的全部变量：内置变量 > 当前环境变量 > 全局变量。$loopIndex 只用于补全提示，由 Workflow 引擎替换 */
export const getAvailableVariables = (now: Date = new Date()): Record<string, string> => ({
  ...useEnvironmentsStore().getAllAvailableVariables,
  ...createBuiltInValues(now),
  [LOOP_INDEX_VARIABLE]: '1',
});

const resolveSequence = (name: string, context: ResolutionContext): string | undefined => {
  const call = parseSequenceCall(name);
  if (!call) return undefined;
  const sequences = useSequencesStore();

  if (!context.consumeSequences) {
    return sequences.getPreviewNextValue(context.sequenceStates, call.name, call.padding, call.startValue, call.step);
  }

  const existing = sequences.getSequenceSnapshot(call.name);
  if (existing) {
    // 序列已存在：沿用它的起始值和步长，padding 未指定时用序列配置
    return sequences.getNextValue(call.name, call.padding, existing.startValue, existing.step);
  }
  // 序列不存在：按参数创建，padding 未指定时不填充
  return sequences.getNextValue(call.name, call.padding ?? 0, call.startValue, call.step);
};

const resolveText = (text: string, context: ResolutionContext): string => text.replace(VARIABLE_PATTERN, (match, rawName) => {
  const name = rawName.trim();
  // Workflow 循环外没有序号，保持原样（发送后列为未解析的变量）
  if (name === LOOP_INDEX_VARIABLE) return match;

  const sequenceValue = resolveSequence(name, context);
  if (sequenceValue !== undefined) return sequenceValue;

  const cached = context.resolvedValues?.get(name);
  if (cached !== undefined) return cached;

  const value = resolveDynamicFunction(name, context.now) ?? context.allVars[name];
  if (value === undefined) return match;
  context.resolvedValues?.set(name, value);
  return value;
});

/** 替换文本中的变量；每次调用单独生成动态值，未定义的变量保留原样 */
export const replaceVariables = (text: string): string => {
  if (!text || typeof text !== 'string') return text;
  const now = new Date();
  return resolveText(text, {
    now,
    allVars: getAvailableVariables(now),
    consumeSequences: true,
    resolvedValues: null,
    sequenceStates: new Map(),
  });
};

/**
 * 创建一次解析会话：同一会话内同名动态变量取同一个值。
 * consumeSequences 为 false 时用于预览（如 cURL），不推进真实序列。
 */
export const createVariableResolver = ({ consumeSequences = true }: { consumeSequences?: boolean } = {}): VariableResolver => {
  const now = new Date();
  const context: ResolutionContext = {
    now,
    allVars: getAvailableVariables(now),
    consumeSequences,
    resolvedValues: new Map(),
    sequenceStates: new Map(),
  };
  return (value: string) => (!value || typeof value !== 'string' ? value : resolveText(value, context));
};

/** 由请求测试提取的变量写入全局变量 */
export const setGlobalVariable = (key: string, value: unknown, _enabled?: boolean, description?: string): void => {
  useEnvironmentsStore().setGlobalVariable(key, String(value), true, description);
};

/** 请求执行、Workflow、MCP 共用的变量上下文 */
export const variableContext = () => ({ replaceVariables, setGlobalVariable });
