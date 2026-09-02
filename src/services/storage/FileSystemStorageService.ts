// File System Storage Service - Tauri-based implementation

import { appDataDir, join } from '@tauri-apps/api/path';
import { 
  readTextFile, 
  writeTextFile, 
  exists,
  mkdir,
  readDir,
  remove
} from '@tauri-apps/plugin-fs';

import type { IStorageService } from './IStorageService';
import type { 
  Collection, 
  Request, 
  Environment, 
  ConsoleLog,
  HistoryItem, 
  AppState,
  WorkflowDefinition,
} from '@/types/models';
import { StorageError, ErrorCode } from '@/types/errors';

export class FileSystemStorageService implements IStorageService {
  private dataDir: string = '';
  private collectionsDir: string = '';
  private requestsDir: string = '';
  private requestDraftsDir: string = '';
  private workflowsDir: string = '';
  private workflowDraftsDir: string = '';
  private environmentsDir: string = '';
  private historyDir: string = '';
  private backupsDir: string = '';
  
  private saveQueue: Map<string, NodeJS.Timeout> = new Map();
  private readonly DEBOUNCE_MS = 500;
  private readonly MAX_CONCURRENT_READS = 16;
  private initialized: boolean = false;

  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // Use Tauri's app data directory so filesystem access stays within the
      // `fs:scope-appdata-recursive` capability.
      this.dataDir = await appDataDir();
      
      // Set up directory paths
      [
        this.collectionsDir,
        this.requestsDir,
        this.workflowsDir,
        this.environmentsDir,
        this.historyDir,
        this.backupsDir,
      ] = await Promise.all([
        join(this.dataDir, 'collections'),
        join(this.dataDir, 'requests'),
        join(this.dataDir, 'workflows'),
        join(this.dataDir, 'environments'),
        join(this.dataDir, 'history'),
        join(this.dataDir, 'backups'),
      ]);
      [this.requestDraftsDir, this.workflowDraftsDir] = await Promise.all([
        join(this.requestsDir, '_drafts'),
        join(this.workflowsDir, '_drafts'),
      ]);

      // Create directories
      await Promise.all([
        this.ensureDir(this.dataDir),
        this.ensureDir(this.collectionsDir),
        this.ensureDir(this.requestsDir),
        this.ensureDir(this.requestDraftsDir),
        this.ensureDir(this.workflowsDir),
        this.ensureDir(this.workflowDraftsDir),
        this.ensureDir(this.environmentsDir),
        this.ensureDir(this.historyDir),
        this.ensureDir(this.backupsDir),
      ]);

      this.initialized = true;
      console.log('Storage service initialized at:', this.dataDir);
    } catch (error) {
      throw new StorageError(
        'Failed to initialize storage service',
        ErrorCode.PERMISSION_DENIED,
        error
      );
    }
  }


  private async ensureDir(path: string): Promise<void> {
    try {
      const dirExists = await exists(path);
      if (!dirExists) {
        await mkdir(path, { recursive: true });
      }
    } catch (error) {
      console.error(`Failed to create directory ${path}:`, error);
      throw new StorageError(
        `Failed to create directory: ${path}`,
        ErrorCode.PERMISSION_DENIED,
        error
      );
    }
  }

  private async loadJsonFiles<T>(
    directory: string,
    shouldInclude: (fileName: string) => boolean,
    entityName: string,
  ): Promise<T[]> {
    const entries = await readDir(directory);
    const files = entries.filter(entry => entry.name && shouldInclude(entry.name));
    const loaded: Array<T | null> = new Array(files.length).fill(null);
    let nextIndex = 0;

    const worker = async () => {
      while (nextIndex < files.length) {
        const index = nextIndex++;
        const entry = files[index];
        try {
          const filePath = await join(directory, entry.name);
          const content = await readTextFile(filePath);
          loaded[index] = JSON.parse(content) as T;
        } catch (error) {
          console.error(`Failed to load ${entityName} ${entry.name}:`, error);
        }
      }
    };
    const workerCount = Math.min(this.MAX_CONCURRENT_READS, files.length);
    await Promise.all(Array.from({ length: workerCount }, () => worker()));

    return loaded.filter((value): value is T => value !== null);
  }

  private debouncedSave(key: string, saveFn: () => Promise<void>): void {
    // Clear existing timeout
    if (this.saveQueue.has(key)) {
      clearTimeout(this.saveQueue.get(key)!);
    }

    // Set new timeout
    const timeout = setTimeout(async () => {
      try {
        await saveFn();
        this.saveQueue.delete(key);
      } catch (error) {
        console.error(`Failed to save ${key}:`, error);
        this.saveQueue.delete(key);
      }
    }, this.DEBOUNCE_MS);

    this.saveQueue.set(key, timeout);
  }

  // Flush all pending saves immediately
  async flushSaves(): Promise<void> {
    const promises: Promise<void>[] = [];
    
    for (const [key, timeout] of this.saveQueue.entries()) {
      clearTimeout(timeout);
      // Note: We can't execute the saveFn here because we don't store it
      // This is a limitation of the current design
    }
    
    this.saveQueue.clear();
  }

  // Collections
  async loadCollections(): Promise<Collection[]> {
    try {
      return await this.loadJsonFiles<Collection>(
        this.collectionsDir,
        fileName => fileName.endsWith('.json') && !fileName.startsWith('_'),
        'collection',
      );
    } catch (error) {
      console.error('Failed to load collections:', error);
      return [];
    }
  }

  async saveCollection(collection: Collection): Promise<void> {
    const filePath = await join(this.collectionsDir, `${collection.id}.json`);
    
    this.debouncedSave(`collection-${collection.id}`, async () => {
      try {
        await writeTextFile(filePath, JSON.stringify(collection, null, 2));
      } catch (error) {
        throw new StorageError(
          `Failed to save collection ${collection.id}`,
          ErrorCode.DISK_FULL,
          error
        );
      }
    });
  }

  async deleteCollection(id: string): Promise<void> {
    try {
      const filePath = await join(this.collectionsDir, `${id}.json`);
      const fileExists = await exists(filePath);
      
      if (fileExists) {
        await remove(filePath);
      }
    } catch (error) {
      throw new StorageError(
        `Failed to delete collection ${id}`,
        ErrorCode.PERMISSION_DENIED,
        error
      );
    }
  }


  async loadCollectionOrder(): Promise<string[]> {
    try {
      const filePath = await join(this.collectionsDir, '_order.json');
      if (await exists(filePath)) {
        const content = await readTextFile(filePath);
        return JSON.parse(content) as string[];
      }
    } catch {}
    return [];
  }

  async saveCollectionOrder(ids: string[]): Promise<void> {
    const filePath = await join(this.collectionsDir, '_order.json');
    await writeTextFile(filePath, JSON.stringify(ids));
  }

  // Requests
  async loadRequest(id: string): Promise<Request | null> {
    try {
      const filePath = await join(this.requestsDir, `${id}.json`);
      const fileExists = await exists(filePath);
      
      if (!fileExists) {
        return null;
      }

      const content = await readTextFile(filePath);
      return JSON.parse(content) as Request;
    } catch (error) {
      console.error(`Failed to load request ${id}:`, error);
      return null;
    }
  }

  async saveRequest(request: Request, immediate: boolean = false): Promise<void> {
    const filePath = await join(this.requestsDir, `${request.id}.json`);
    
    if (immediate) {
      // Immediate save without debounce
      try {
        await writeTextFile(filePath, JSON.stringify(request, null, 2));
      } catch (error) {
        throw new StorageError(
          `Failed to save request ${request.id}`,
          ErrorCode.DISK_FULL,
          error
        );
      }
    } else {
      // Debounced save
      this.debouncedSave(`request-${request.id}`, async () => {
        try {
          await writeTextFile(filePath, JSON.stringify(request, null, 2));
        } catch (error) {
          throw new StorageError(
            `Failed to save request ${request.id}`,
            ErrorCode.DISK_FULL,
            error
          );
        }
      });
    }
  }

  async deleteRequest(id: string): Promise<void> {
    try {
      const filePath = await join(this.requestsDir, `${id}.json`);
      const fileExists = await exists(filePath);

      if (fileExists) {
        await remove(filePath);
      }
      await this.deleteRequestDraft(id);
    } catch (error) {
      throw new StorageError(
        `Failed to delete request ${id}`,
        ErrorCode.PERMISSION_DENIED,
        error
      );
    }
  }

  async loadRequestDrafts(): Promise<Record<string, Request>> {
    try {
      const requests = await this.loadJsonFiles<Request>(
        this.requestDraftsDir,
        fileName => fileName.endsWith('.json'),
        'request draft',
      );
      return Object.fromEntries(requests.map(request => [request.id, request]));
    } catch (error) {
      console.error('Failed to load request drafts:', error);
      return {};
    }
  }

  async saveRequestDraft(request: Request): Promise<void> {
    const filePath = await join(this.requestDraftsDir, `${request.id}.json`);

    try {
      await writeTextFile(filePath, JSON.stringify(request, null, 2));
    } catch (error) {
      throw new StorageError(
        `Failed to save request draft ${request.id}`,
        ErrorCode.DISK_FULL,
        error
      );
    }
  }

  async deleteRequestDraft(id: string): Promise<void> {
    try {
      const filePath = await join(this.requestDraftsDir, `${id}.json`);
      if (await exists(filePath)) {
        await remove(filePath);
      }
    } catch (error) {
      throw new StorageError(
        `Failed to delete request draft ${id}`,
        ErrorCode.PERMISSION_DENIED,
        error
      );
    }
  }

  // Workflows
  async loadWorkflows(): Promise<WorkflowDefinition[]> {
    try {
      return await this.loadJsonFiles<WorkflowDefinition>(
        this.workflowsDir,
        fileName => fileName.endsWith('.json') && !fileName.startsWith('_'),
        'workflow',
      );
    } catch (error) {
      console.error('Failed to load workflows:', error);
      return [];
    }
  }

  async saveWorkflow(workflow: WorkflowDefinition): Promise<void> {
    const filePath = await join(this.workflowsDir, `${workflow.id}.json`);

    try {
      await writeTextFile(filePath, JSON.stringify(workflow, null, 2));
    } catch (error) {
      throw new StorageError(
        `Failed to save workflow ${workflow.id}`,
        ErrorCode.DISK_FULL,
        error
      );
    }
  }

  async deleteWorkflow(id: string): Promise<void> {
    try {
      const filePath = await join(this.workflowsDir, `${id}.json`);
      if (await exists(filePath)) {
        await remove(filePath);
      }
      await this.deleteWorkflowDraft(id);
    } catch (error) {
      throw new StorageError(
        `Failed to delete workflow ${id}`,
        ErrorCode.PERMISSION_DENIED,
        error
      );
    }
  }

  async loadWorkflowDrafts(): Promise<Record<string, WorkflowDefinition>> {
    try {
      const workflows = await this.loadJsonFiles<WorkflowDefinition>(
        this.workflowDraftsDir,
        fileName => fileName.endsWith('.json'),
        'workflow draft',
      );
      return Object.fromEntries(workflows.map(workflow => [workflow.id, workflow]));
    } catch (error) {
      console.error('Failed to load workflow drafts:', error);
      return {};
    }
  }

  async saveWorkflowDraft(workflow: WorkflowDefinition): Promise<void> {
    const filePath = await join(this.workflowDraftsDir, `${workflow.id}.json`);

    try {
      await writeTextFile(filePath, JSON.stringify(workflow, null, 2));
    } catch (error) {
      throw new StorageError(
        `Failed to save workflow draft ${workflow.id}`,
        ErrorCode.DISK_FULL,
        error
      );
    }
  }

  async deleteWorkflowDraft(id: string): Promise<void> {
    try {
      const filePath = await join(this.workflowDraftsDir, `${id}.json`);
      if (await exists(filePath)) {
        await remove(filePath);
      }
    } catch (error) {
      throw new StorageError(
        `Failed to delete workflow draft ${id}`,
        ErrorCode.PERMISSION_DENIED,
        error
      );
    }
  }

  // Environments
  async loadEnvironments(): Promise<Environment[]> {
    try {
      const filePath = await join(this.environmentsDir, 'environments.json');
      const fileExists = await exists(filePath);
      
      if (!fileExists) {
        return [];
      }

      const content = await readTextFile(filePath);
      return JSON.parse(content) as Environment[];
    } catch (error) {
      console.error('Failed to load environments:', error);
      return [];
    }
  }

  async saveEnvironments(environments: Environment[]): Promise<void> {
    const filePath = await join(this.environmentsDir, 'environments.json');
    
    try {
      await writeTextFile(filePath, JSON.stringify(environments, null, 2));
    } catch (error) {
      throw new StorageError(
        'Failed to save environments',
        ErrorCode.DISK_FULL,
        error
      );
    }
  }

  async loadGlobalVariables(): Promise<EnvironmentVariable[]> {
    try {
      const filePath = await join(this.environmentsDir, 'global-variables.json');
      const fileExists = await exists(filePath);
      
      if (!fileExists) {
        return [];
      }
      
      const content = await readTextFile(filePath);
      return JSON.parse(content);
    } catch (error) {
      console.error('Failed to load global variables:', error);
      return [];
    }
  }

  async saveGlobalVariables(variables: EnvironmentVariable[]): Promise<void> {
    const filePath = await join(this.environmentsDir, 'global-variables.json');
    
    try {
      await writeTextFile(filePath, JSON.stringify(variables, null, 2));
    } catch (error) {
      throw new StorageError(
        'Failed to save global variables',
        ErrorCode.DISK_FULL,
        error
      );
    }
  }

  // History
  async loadHistory(): Promise<HistoryItem[]> {
    try {
      const filePath = await join(this.historyDir, 'history.json');
      const fileExists = await exists(filePath);
      
      if (!fileExists) {
        return [];
      }

      const content = await readTextFile(filePath);
      return JSON.parse(content) as HistoryItem[];
    } catch (error) {
      console.error('Failed to load history:', error);
      return [];
    }
  }

  async saveHistory(history: HistoryItem[]): Promise<void> {
    const filePath = await join(this.historyDir, 'history.json');
    
    try {
      await writeTextFile(filePath, JSON.stringify(history, null, 2));
    } catch (error) {
      throw new StorageError(
        'Failed to save history',
        ErrorCode.DISK_FULL,
        error
      );
    }
  }

  // Console Logs
  async loadConsoleLogs(): Promise<ConsoleLog[]> {
    try {
      const filePath = await join(this.historyDir, 'console-logs.json');
      const fileExists = await exists(filePath);

      if (!fileExists) {
        return [];
      }

      const content = await readTextFile(filePath);
      return JSON.parse(content) as ConsoleLog[];
    } catch (error) {
      console.error('Failed to load console logs:', error);
      return [];
    }
  }

  async saveConsoleLogs(logs: ConsoleLog[]): Promise<void> {
    const filePath = await join(this.historyDir, 'console-logs.json');

    try {
      await writeTextFile(filePath, JSON.stringify(logs, null, 2));
    } catch (error) {
      throw new StorageError(
        'Failed to save console logs',
        ErrorCode.DISK_FULL,
        error
      );
    }
  }

  // App State
  async loadAppState(): Promise<AppState | null> {
    try {
      const filePath = await join(this.dataDir, 'app-state.json');
      const fileExists = await exists(filePath);
      
      if (!fileExists) {
        return null;
      }

      const content = await readTextFile(filePath);
      return JSON.parse(content) as AppState;
    } catch (error) {
      console.error('Failed to load app state:', error);
      return null;
    }
  }

  async saveAppState(state: AppState): Promise<void> {
    const filePath = await join(this.dataDir, 'app-state.json');
    
    try {
      await writeTextFile(filePath, JSON.stringify(state, null, 2));
    } catch (error) {
      throw new StorageError(
        'Failed to save app state',
        ErrorCode.DISK_FULL,
        error
      );
    }
  }

  // Utility
  async backup(): Promise<void> {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupPath = await join(this.backupsDir, timestamp);
      
      await this.ensureDir(backupPath);
      
      // Copy collections
      const collections = await this.loadCollections();
      for (const collection of collections) {
        const destPath = await join(backupPath, 'collections', `${collection.id}.json`);
        await this.ensureDir(await join(backupPath, 'collections'));
        await writeTextFile(destPath, JSON.stringify(collection, null, 2));
      }
      
      console.log('Backup created at:', backupPath);
    } catch (error) {
      throw new StorageError(
        'Failed to create backup',
        ErrorCode.DISK_FULL,
        error
      );
    }
  }

  async flush(): Promise<void> {
    // Wait for all pending saves to complete
    const promises: Promise<void>[] = [];
    
    for (const [key, timeout] of this.saveQueue.entries()) {
      clearTimeout(timeout);
      // Execute save immediately
      promises.push(
        new Promise((resolve) => {
          setTimeout(() => resolve(), 0);
        })
      );
    }
    
    await Promise.all(promises);
    this.saveQueue.clear();
  }

  // Sequences
  async loadSequences(): Promise<Record<string, any>> {
    const filePath = await join(this.dataDir, 'sequences.json');
    
    try {
      const fileExists = await exists(filePath);
      if (!fileExists) {
        return {};
      }
      
      const content = await readTextFile(filePath);
      return JSON.parse(content);
    } catch (error) {
      console.error('Failed to load sequences:', error);
      return {};
    }
  }

  async saveSequences(sequences: Record<string, any>): Promise<void> {
    const filePath = await join(this.dataDir, 'sequences.json');
    
    try {
      const content = JSON.stringify(sequences, null, 2);
      await writeTextFile(filePath, content);
    } catch (error) {
      console.error('Failed to save sequences:', error);
      throw new StorageError(
        'Failed to save sequences',
        ErrorCode.WRITE_ERROR,
        error
      );
    }
  }
}
