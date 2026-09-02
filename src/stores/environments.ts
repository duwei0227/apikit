import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { storageService } from '@/services/storage';
import type { Environment, EnvironmentVariable } from '@/types/models';
import { generateId } from '@/utils/id-generator';

export const useEnvironmentsStore = defineStore('environments', () => {
  // State
  const environments = ref<Environment[]>([]);
  const activeEnvironmentId = ref<string | null>(null);
  const globalVariables = ref<EnvironmentVariable[]>([]);
  const isLoading = ref(false);

  // Getters
  const activeEnvironment = computed(() => {
    if (!activeEnvironmentId.value) return null;
    return environments.value.find(e => e.id === activeEnvironmentId.value);
  });

  const getAllAvailableVariables = computed(() => {
    const vars: Record<string, string> = {};
    
    // Add global variables first
    globalVariables.value.forEach(v => {
      if (v.enabled !== false) {
        vars[v.key] = v.value;
      }
    });
    
    // Override with active environment variables
    if (activeEnvironment.value) {
      activeEnvironment.value.variables.forEach(v => {
        if (v.enabled !== false) {
          vars[v.key] = v.value;
        }
      });
    }
    
    return vars;
  });

  // Actions
  async function loadEnvironments() {
    isLoading.value = true;
    try {
      const loaded = await storageService.loadEnvironments();
      environments.value = loaded;
      
      // Set active environment
      const active = loaded.find(e => e.isActive);
      if (active) {
        activeEnvironmentId.value = active.id;
      }
      
      // 加载全局变量
      await loadGlobalVariables();
    } catch (e) {
      console.error('Failed to load environments:', e);
    } finally {
      isLoading.value = false;
    }
  }

  async function saveEnvironments() {
    try {
      await storageService.saveEnvironments(environments.value);
      // 同时保存全局变量
      await saveGlobalVariables();
    } catch (e) {
      console.error('Failed to save environments:', e);
      throw e;
    }
  }

  async function loadGlobalVariables() {
    try {
      const loaded = await storageService.loadGlobalVariables();
      globalVariables.value = loaded;
    } catch (e) {
      console.error('Failed to load global variables:', e);
      globalVariables.value = [];
    }
  }

  async function saveGlobalVariables() {
    try {
      await storageService.saveGlobalVariables(globalVariables.value);
    } catch (e) {
      console.error('Failed to save global variables:', e);
      throw e;
    }
  }

  async function createEnvironment(name: string) {
    const environment: Environment = {
      id: generateId(),
      name,
      variables: [],
      isActive: false
    };
    
    environments.value.push(environment);
    await saveEnvironments();
    return environment;
  }

  async function updateEnvironment(id: string, updates: Partial<Environment>) {
    const env = environments.value.find(e => e.id === id);
    if (!env) {
      throw new Error(`Environment ${id} not found`);
    }
    
    Object.assign(env, updates);
    await saveEnvironments();
  }

  async function deleteEnvironment(id: string) {
    const index = environments.value.findIndex(e => e.id === id);
    if (index === -1) {
      throw new Error(`Environment ${id} not found`);
    }
    
    // If deleting active environment, clear active
    if (activeEnvironmentId.value === id) {
      activeEnvironmentId.value = null;
    }
    
    environments.value.splice(index, 1);
    await saveEnvironments();
  }

  async function setActiveEnvironment(id: string | null) {
    // Clear previous active
    environments.value.forEach(e => {
      e.isActive = false;
    });
    
    // Set new active
    if (id) {
      const env = environments.value.find(e => e.id === id);
      if (env) {
        env.isActive = true;
        activeEnvironmentId.value = id;
      }
    } else {
      activeEnvironmentId.value = null;
    }
    
    await saveEnvironments();
  }

  function setGlobalVariable(key: string, value: string, enabled: boolean = true, description?: string) {
    const existing = globalVariables.value.find(v => v.key === key);
    if (existing) {
      existing.value = value;
      existing.enabled = enabled;
      if (description !== undefined) existing.description = description;
      existing.createdAt = new Date().toISOString();
    } else {
      globalVariables.value.push({ key, value, enabled, description, createdAt: new Date().toISOString() });
    }
    saveGlobalVariables();
  }

  function updateGlobalVariable(key: string, updates: Partial<EnvironmentVariable>) {
    const existing = globalVariables.value.find(v => v.key === key);
    if (existing) {
      Object.assign(existing, updates, { createdAt: new Date().toISOString() });
      saveGlobalVariables();
    }
  }

  function deleteGlobalVariable(key: string) {
    const index = globalVariables.value.findIndex(v => v.key === key);
    if (index !== -1) {
      globalVariables.value.splice(index, 1);
      saveGlobalVariables();
    }
  }

  function replaceVariables(text: string): string {
    const vars = getAllAvailableVariables.value;
    let result = text;
    
    // Replace {{variable}} patterns
    Object.entries(vars).forEach(([key, value]) => {
      const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
      result = result.replace(regex, value);
    });
    
    return result;
  }

  return {
    // State
    environments,
    activeEnvironmentId,
    globalVariables,
    isLoading,
    
    // Getters
    activeEnvironment,
    getAllAvailableVariables,
    
    // Actions
    loadEnvironments,
    saveEnvironments,
    createEnvironment,
    updateEnvironment,
    deleteEnvironment,
    setActiveEnvironment,
    setGlobalVariable,
    updateGlobalVariable,
    deleteGlobalVariable,
    replaceVariables
  };
});
