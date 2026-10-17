// 内置动态变量：{{$timestamp}}、{{$randomInt(1, 100)}} 等

import { BUILT_IN_VARIABLE_NAMES, LOOP_INDEX_VARIABLE } from '@/services/variables/dynamicVariables';
import { createVariableResolver } from '@/services/variables/resolver';
import { BUILT_IN_VARIABLE_SYNTAX, PARAMETER_HINTS } from '@/utils/templateVariables';
import type { McpToolHandler } from '../types';

export const variableHandlers: Record<string, McpToolHandler> = {
  async list_builtin_variables() {
    // 预览模式：示例值不推进真实的 $sequence 序列
    const resolve = createVariableResolver({ consumeSequences: false });
    return {
      variables: [
        ...BUILT_IN_VARIABLE_NAMES.map((name): Record<string, unknown> => {
          const hint = PARAMETER_HINTS[name];
          return {
            name,
            description: hint?.description ?? BUILT_IN_VARIABLE_SYNTAX[name],
            usage: BUILT_IN_VARIABLE_SYNTAX[name],
            exampleValue: resolve(`{{${name}}}`),
            ...(hint ? {
              examples: hint.examples.map(example => ({ syntax: `{{${example.syntax}}}`, description: example.desc })),
              params: hint.params.map(param => ({ name: param.name, type: param.type, default: param.default, description: param.desc })),
            } : {}),
          };
        }),
        {
          name: LOOP_INDEX_VARIABLE,
          description: BUILT_IN_VARIABLE_SYNTAX[LOOP_INDEX_VARIABLE],
          usage: '{{$loopIndex}}, for example {{baseUrl}}/orders?page={{$loopIndex}} in a request inside a for loop',
          exampleValue: '1',
          workflowLoopsOnly: true,
        },
      ],
    };
  },
};
