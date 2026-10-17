import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useEnvironmentsStore } from '@/stores/environments';
import { useSequencesStore } from '@/stores/sequences';
import {
  createVariableResolver,
  getAvailableVariables,
  replaceVariables,
  setGlobalVariable,
} from '@/services/variables/resolver';
import { BUILT_IN_VARIABLE_NAMES, findSequenceCalls, parseParameters, parseSequenceCall } from '@/services/variables/dynamicVariables';
import { mockStorageService } from '../helpers/mockStorage';

const useEnvironment = async (variables: Record<string, string>) => {
  const environments = useEnvironmentsStore();
  const environment = await environments.createEnvironment('Dev');
  await environments.updateEnvironment(environment.id, {
    variables: Object.entries(variables).map(([key, value]) => ({ key, value, enabled: true })),
  });
  await environments.setActiveEnvironment(environment.id);
};

describe('variable resolver', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('VAR-001 resolves environment over global variables and keeps unknown ones', async () => {
    setGlobalVariable('host', 'global.example.com');
    setGlobalVariable('token', 'from-global');
    await useEnvironment({ host: 'dev.example.com' });

    expect(replaceVariables('https://{{host}}/x?t={{ token }}&u={{missing}}'))
      .toBe('https://dev.example.com/x?t=from-global&u={{missing}}');
    expect(replaceVariables('')).toBe('');
  });

  it('VAR-002 treats variable names literally, including regex characters', () => {
    setGlobalVariable('a.b', 'dot');
    setGlobalVariable('price$', 'dollar');
    expect(replaceVariables('{{a.b}} {{aXb}} {{price$}}')).toBe('dot {{aXb}} dollar');
  });

  it('VAR-003 resolves built-in dynamic variables and their parameters', () => {
    expect(replaceVariables('{{$timestamp}}')).toMatch(/^\d{13}$/);
    expect(replaceVariables('{{$guid}}')).toMatch(/^[0-9a-f-]{36}$/);
    expect(replaceVariables('{{$randomInt(5, 5)}}')).toBe('5');
    expect(replaceVariables('{{$randomInt(min=3, max=3)}}')).toBe('3');
    expect(Number(replaceVariables('{{$randomInt}}'))).toBeLessThanOrEqual(1000);
    expect(replaceVariables('{{$randomAlpha(4)}}')).toMatch(/^[A-Za-z]{4}$/);
    expect(replaceVariables('{{$randomNumeric(length=6)}}')).toMatch(/^\d{6}$/);
    expect(replaceVariables('{{$randomUppercase(3)}}')).toMatch(/^[A-Z]{3}$/);
    expect(replaceVariables('{{$randomLowercase}}')).toMatch(/^[a-z]{10}$/);
    expect(replaceVariables('{{$randomAlphanumeric(len=8)}}')).toMatch(/^[A-Za-z0-9]{8}$/);
    expect([...replaceVariables('{{$randomChinese(3)}}')]).toHaveLength(3);
    expect(replaceVariables('{{$date(yyyy-MM-dd)}}')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(replaceVariables('{{$time(format="HH:mm")}}')).toMatch(/^\d{2}:\d{2}$/);
    expect(replaceVariables('{{$datetime}}')).toMatch(/^\d{14}$/);
    expect(replaceVariables('{{$date}}')).toMatch(/^\d{8}$/);
  });

  it('VAR-004 generates new dynamic values per call but keeps them within one resolver session', () => {
    expect(replaceVariables('{{$guid}}')).not.toBe(replaceVariables('{{$guid}}'));

    const resolve = createVariableResolver();
    const first = resolve('{{$guid}}|{{$randomInt}}');
    expect(resolve('{{$guid}}|{{$randomInt}}')).toBe(first);
  });

  it('VAR-005 advances sequences, but not in previews', () => {
    const sequences = useSequencesStore();
    expect(replaceVariables('{{$sequence(order, 3, 5, 2)}}')).toBe('005');
    // 已存在的序列沿用自己的起始值和步长
    expect(replaceVariables('{{$sequence(order, 3, 100, 10)}}')).toBe('007');
    expect(replaceVariables('{{$sequence}}-{{$sequence}}')).toBe('1-2');

    const preview = createVariableResolver({ consumeSequences: false });
    expect(preview('{{$sequence(order)}} {{$sequence(order)}}')).toBe('009 011');
    expect(sequences.getSequenceSnapshot('order')?.currentValue).toBe(9);

    // 同一会话中每次出现都会步进
    const session = createVariableResolver();
    expect(session('{{$sequence(name=order, padding=4)}} {{$sequence(name=order, padding=4)}}')).toBe('0009 0011');
  });

  it('VAR-006 exposes every built-in variable for completion', async () => {
    await useEnvironment({ baseUrl: 'https://x' });
    const variables = getAvailableVariables();
    expect(variables.baseUrl).toBe('https://x');
    for (const name of BUILT_IN_VARIABLE_NAMES) expect(variables).toHaveProperty(name);
  });

  it('VAR-007 parses positional and named parameters', () => {
    expect(parseParameters('$date', '$date')).toBeNull();
    expect(parseParameters('$date()', '$date')).toEqual({});
    expect(parseParameters('$randomInt(1, "9")', '$randomInt')).toEqual({ _positional: ['1', '9'] });
    expect(parseParameters('$randomInt(Min=1, max=9)', '$randomInt')).toEqual({ min: '1', max: '9' });
    expect(parseSequenceCall('$sequence(10)')).toEqual({ name: 'default', padding: null, startValue: 10, step: 1 });
    expect(parseSequenceCall('$sequenceX')).toBeNull();
  });

  it('VAR-010 finds the sequences used in a text with their settings', () => {
    const text = '{{baseUrl}}/o/{{$sequence(name=order, start=100, padding=5)}}?a={{ $sequence }}&b={{$sequence(order)}}&c={{$sequence(7)}}';
    expect(findSequenceCalls(text)).toEqual([
      { name: 'order', padding: 5, startValue: 100, step: 1 },
      { name: 'default', padding: null, startValue: 1, step: 1 },
    ]);
    expect(findSequenceCalls('{{$sequenceX}} {{token}}')).toEqual([]);
  });

  it('VAR-008 stores extracted values as enabled global variables', () => {
    setGlobalVariable('count', 42, false, 'from test');
    expect(useEnvironmentsStore().globalVariables).toContainEqual(
      expect.objectContaining({ key: 'count', value: '42', enabled: true, description: 'from test' }),
    );
  });
});

describe('sequence persistence', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('VAR-009 saves sequence and global variable changes together instead of on every request', async () => {
    vi.useFakeTimers();
    try {
      const saveSequences = vi.spyOn(mockStorageService, 'saveSequences');
      const saveGlobals = vi.spyOn(mockStorageService, 'saveGlobalVariables');
      for (let i = 0; i < 5; i++) {
        replaceVariables('{{$sequence(batch)}}');
        setGlobalVariable('n', i);
      }
      expect(saveSequences).not.toHaveBeenCalled();
      expect(saveGlobals).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(500);
      expect(saveSequences).toHaveBeenCalledTimes(1);
      expect(saveGlobals).toHaveBeenCalledTimes(1);
      expect(mockStorageService.sequences.batch.currentValue).toBe(6);

      // flush 写完尚未保存的内容
      replaceVariables('{{$sequence(batch)}}');
      await useSequencesStore().flush();
      expect(mockStorageService.sequences.batch.currentValue).toBe(7);
    } finally {
      vi.useRealTimers();
    }
  });
});
