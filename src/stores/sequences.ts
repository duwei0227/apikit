import { defineStore } from 'pinia';
import { ref } from 'vue';
import { storageService } from '@/services/storage';

export interface Sequence {
  name: string;
  currentValue: number;
  startValue: number;
  step: number;
  padding: number;
  createdAt: string;
  updatedAt: string;
}

export interface SequencePreviewCursor {
  currentValue: number;
  step: number;
  padding: number;
}

export const useSequencesStore = defineStore('sequences', () => {
  // State
  const sequences = ref<Map<string, Sequence>>(new Map());
  const isLoading = ref(false);

  // Actions
  async function loadSequences() {
    isLoading.value = true;
    try {
      const data = await storageService.loadSequences();
      sequences.value = new Map(Object.entries(data));
    } catch (error) {
      console.error('Failed to load sequences:', error);
    } finally {
      isLoading.value = false;
    }
  }

  async function saveSequences() {
    try {
      const plain: Record<string, Sequence> = {};
      sequences.value.forEach((v, k) => { plain[k] = { ...v }; });
      await storageService.saveSequences(plain);
    } catch (error) {
      console.error('Failed to save sequences:', error);
      throw error;
    }
  }

  function getNextValue(
    name: string = 'default',
    padding: number | null = null,
    startValue: number = 1,
    step: number = 1
  ): string {
    let sequence = sequences.value.get(name);

    if (!sequence) {
      // Create new sequence
      sequence = {
        name,
        currentValue: startValue,
        startValue,
        step,
        padding: padding ?? 0, // 首次创建时使用传入的 padding
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      sequences.value.set(name, sequence);
    }

    const value = sequence.currentValue;
    
    // Increment for next use (使用序列自己的 step)
    sequence.currentValue += sequence.step;
    sequence.updatedAt = new Date().toISOString();

    // Save to storage
    saveSequences();

    // Format with padding
    // 如果传入了 padding 参数，使用传入的（仅用于格式化）
    // 否则使用序列配置中的 padding
    const effectivePadding = padding !== null ? padding : sequence.padding;
    
    if (effectivePadding > 0) {
      return value.toString().padStart(effectivePadding, '0');
    }
    return value.toString();
  }

  function getSequenceSnapshot(name: string = 'default'): Sequence | undefined {
    const sequence = sequences.value.get(name);
    return sequence ? { ...sequence } : undefined;
  }

  function getPreviewNextValue(
    cursors: Map<string, SequencePreviewCursor>,
    name: string = 'default',
    padding: number | null = null,
    startValue: number = 1,
    step: number = 1,
  ): string {
    let cursor = cursors.get(name);
    if (!cursor) {
      const sequence = getSequenceSnapshot(name);
      cursor = sequence
        ? { currentValue: sequence.currentValue, step: sequence.step, padding: sequence.padding }
        : { currentValue: startValue, step, padding: padding ?? 0 };
      cursors.set(name, cursor);
    }

    const value = cursor.currentValue;
    cursor.currentValue += cursor.step;
    const effectivePadding = padding !== null ? padding : cursor.padding;
    return effectivePadding > 0
      ? value.toString().padStart(effectivePadding, '0')
      : value.toString();
  }

  async function resetSequence(name: string, value: number) {
    const sequence = sequences.value.get(name);
    if (sequence) {
      sequence.currentValue = value;
      sequence.updatedAt = new Date().toISOString();
      await saveSequences();
    }
  }

  async function updateSequence(name: string, updates: Partial<Sequence>) {
    const sequence = sequences.value.get(name);
    
    if (sequence) {
      Object.assign(sequence, updates);
      sequence.updatedAt = new Date().toISOString();
      await saveSequences();
    } else {
      // 如果序列不存在，创建一个新的
      const newSequence: Sequence = {
        name,
        currentValue: updates.currentValue ?? 1,
        startValue: updates.startValue ?? updates.currentValue ?? 1,
        step: updates.step ?? 1,
        padding: updates.padding ?? 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      sequences.value.set(name, newSequence);
      await saveSequences();
    }
  }

  async function deleteSequence(name: string) {
    const newMap = new Map(sequences.value);
    newMap.delete(name);
    sequences.value = newMap;
    await saveSequences();
  }

  function getAllSequences(): Sequence[] {
    return Array.from(sequences.value.values());
  }

  return {
    sequences,
    isLoading,
    loadSequences,
    saveSequences,
    getNextValue,
    getSequenceSnapshot,
    getPreviewNextValue,
    resetSequence,
    updateSequence,
    deleteSequence,
    getAllSequences
  };
});
