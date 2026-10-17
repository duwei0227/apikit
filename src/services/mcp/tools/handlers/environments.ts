// 环境和全局变量

import { useEnvironmentsStore } from '@/stores/environments';
import type { Environment, EnvironmentVariable } from '@/types/models';
import { isRecord, fail, requireString, optionalString, stringValue, confirmOrThrow } from '../shared';
import { type McpToolContext, MCP_HIDDEN_VALUE, type McpToolHandler } from '../types';

function describeVariables(list: EnvironmentVariable[], reveal: boolean) {
  return list.map(variable => ({
    key: variable.key,
    value: reveal ? variable.value : (variable.value ? MCP_HIDDEN_VALUE : ''),
    enabled: variable.enabled !== false,
    ...(variable.description ? { description: variable.description } : {}),
  }));
}

function describeEnvironment(environment: Environment, reveal: boolean) {
  return {
    id: environment.id,
    name: environment.name,
    isActive: environment.id === useEnvironmentsStore().activeEnvironmentId,
    variables: describeVariables(environment.variables, reveal),
  };
}

function requireEnvironment(environmentId: string): Environment {
  const environment = useEnvironmentsStore().environments.find(item => item.id === environmentId);
  return environment || fail(`Environment not found: ${environmentId}`);
}

/** 环境名不能为空，也不能和其它环境重名 */
function requireEnvironmentName(value: unknown, ownId?: string): string {
  if (typeof value !== 'string' || !value.trim()) fail('name is required');
  const name = value.trim();
  if (useEnvironmentsStore().environments.some(item => item.id !== ownId && item.name === name)) {
    fail(`An environment named "${name}" already exists`);
  }
  return name;
}

/** 按 key 新增或更新变量、移除变量；没提到的变量保持不变 */
function mergeVariables(current: EnvironmentVariable[], updates: unknown, removals: unknown): EnvironmentVariable[] {
  const result: EnvironmentVariable[] = current.map(variable => ({ ...variable }));
  const seen = new Set<string>();

  if (removals !== undefined) {
    if (!Array.isArray(removals)) fail('removeVariables must be an array of keys');
    removals.forEach((key: unknown, index: number) => {
      if (typeof key !== 'string' || !key.trim()) fail(`removeVariables[${index}] must be a key`);
      const position = result.findIndex(variable => variable.key === key.trim());
      if (position === -1) fail(`Variable not found: ${key.trim()}`);
      result.splice(position, 1);
      seen.add(key.trim());
    });
  }

  if (updates !== undefined) {
    if (!Array.isArray(updates)) fail('variables must be an array of { key, value, enabled, description }');
    updates.forEach((item: unknown, index: number) => {
      if (!isRecord(item) || typeof item.key !== 'string' || !item.key.trim()) fail(`variables[${index}].key is required`);
      const key = item.key.trim();
      if (seen.has(key)) fail(`variables[${index}].key "${key}" is used more than once`);
      seen.add(key);
      if (item.enabled !== undefined && typeof item.enabled !== 'boolean') fail(`variables[${index}].enabled must be a boolean`);
      const description = optionalString(item.description, `variables[${index}].description`);

      const existing = result.find(variable => variable.key === key);
      const keepValue = item.value === undefined || item.value === MCP_HIDDEN_VALUE;
      if (!existing && item.value === MCP_HIDDEN_VALUE) fail(`variables[${index}].value: "${key}" has no current value to keep`);
      if (existing) {
        if (!keepValue) existing.value = stringValue(item.value);
        if (item.enabled !== undefined) existing.enabled = item.enabled;
        if (description !== undefined) existing.description = description;
      } else {
        result.push({
          key,
          value: stringValue(item.value),
          enabled: item.enabled !== false,
          ...(description ? { description } : {}),
        });
      }
    });
  }
  return result;
}

async function confirmEnvironmentSwitch(context: McpToolContext, tool: string, environmentName: string) {
  await confirmOrThrow(context, {
    tool,
    title: 'AI wants to switch the active environment',
    detail: environmentName,
    note: 'Requests you and the AI send next will use this environment.',
  });
}

export const environmentHandlers: Record<string, McpToolHandler> = {
  async list_environments(_args, context) {
    const store = useEnvironmentsStore();
    const reveal = context.revealSecrets();
    return {
      valuesHidden: !reveal,
      activeEnvironmentId: store.activeEnvironmentId,
      environments: store.environments.map(environment => describeEnvironment(environment, reveal)),
      globalVariables: describeVariables(store.globalVariables, reveal),
    };
  },

  async create_environment(args, context) {
    const store = useEnvironmentsStore();
    const name = requireEnvironmentName(args.name);
    const variables = mergeVariables([], args.variables, undefined);
    if (args.activate === true) await confirmEnvironmentSwitch(context, 'create_environment', name);

    const environment = await store.createEnvironment(name);
    if (variables.length > 0) await store.updateEnvironment(environment.id, { variables });
    if (args.activate === true) await store.setActiveEnvironment(environment.id);
    return describeEnvironment(requireEnvironment(environment.id), context.revealSecrets());
  },

  async update_environment(args, context) {
    const store = useEnvironmentsStore();
    const environment = requireEnvironment(requireString(args, 'environmentId'));
    if (args.name === undefined && args.variables === undefined && args.removeVariables === undefined) {
      fail('Pass name, variables and/or removeVariables');
    }
    const name = args.name === undefined ? environment.name : requireEnvironmentName(args.name, environment.id);
    const variables = mergeVariables(environment.variables, args.variables, args.removeVariables);
    await store.updateEnvironment(environment.id, { name, variables });
    return describeEnvironment(requireEnvironment(environment.id), context.revealSecrets());
  },

  async set_global_variables(args, context) {
    const store = useEnvironmentsStore();
    if (args.variables === undefined && args.removeVariables === undefined) fail('Pass variables and/or removeVariables');
    store.globalVariables = mergeVariables(store.globalVariables, args.variables, args.removeVariables);
    await store.saveEnvironments();
    return { globalVariables: describeVariables(store.globalVariables, context.revealSecrets()) };
  },

  async set_active_environment(args, context) {
    const store = useEnvironmentsStore();
    if (args.environmentId !== null && typeof args.environmentId !== 'string') {
      fail('environmentId must be an environment id or null');
    }
    const environment = args.environmentId === null ? null : requireEnvironment(requireString(args, 'environmentId'));
    const targetId = environment?.id ?? null;
    if (targetId !== (store.activeEnvironmentId ?? null)) {
      await confirmEnvironmentSwitch(context, 'set_active_environment', environment?.name ?? 'No environment');
      await store.setActiveEnvironment(targetId);
    }
    return { activeEnvironmentId: targetId, name: environment?.name ?? null };
  },
};
