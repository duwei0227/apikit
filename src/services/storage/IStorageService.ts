// Storage Service Interface - Abstract contract for data persistence

import type { 
  Collection, 
  Request, 
  Environment, 
  EnvironmentVariable,
  ConsoleLog,
  HistoryItem, 
  AppState,
  WorkflowDefinition,
} from '@/types/models';

/**
 * Interface for storage service implementations
 * Provides methods for persisting and retrieving application data
 */
export interface IStorageService {
  /**
   * Initialize the storage service
   * Creates necessary directories and performs setup
   */
  initialize(): Promise<void>;

  // Collections
  /**
   * Load all collections from storage
   * @returns Array of collections
   */
  loadCollections(): Promise<Collection[]>;

  /**
   * Save a collection to storage
   * @param collection - The collection to save
   */
  saveCollection(collection: Collection): Promise<void>;

  /**
   * Delete a collection from storage
   * @param id - The collection ID to delete
   */
  deleteCollection(id: string): Promise<void>;

  /**
   * Load the persisted collection ordering
   * @returns Ordered array of collection IDs
   */
  loadCollectionOrder(): Promise<string[]>;

  /**
   * Save the collection ordering
   * @param ids - Ordered array of collection IDs
   */
  saveCollectionOrder(ids: string[]): Promise<void>;

  // Requests
  /**
   * Load a single request from storage
   * @param id - The request ID to load
   * @returns The request or null if not found
   */
  loadRequest(id: string): Promise<Request | null>;

  /**
   * Save a request to storage
   * @param request - The request to save
   */
  saveRequest(request: Request): Promise<void>;

  /**
   * Delete a request from storage
   * @param id - The request ID to delete
   */
  deleteRequest(id: string): Promise<void>;

  /**
   * Load all request drafts (staged, unsaved edits) from storage
   * @returns Map of request id to draft request
   */
  loadRequestDrafts(): Promise<Record<string, Request>>;

  /**
   * Save a request draft without replacing the saved request
   * @param request - The draft request to save
   */
  saveRequestDraft(request: Request): Promise<void>;

  /**
   * Delete a request draft
   * @param id - The request ID whose draft to delete
   */
  deleteRequestDraft(id: string): Promise<void>;

  // Workflows
  /**
   * Load all workflow definitions from storage
   */
  loadWorkflows(): Promise<WorkflowDefinition[]>;

  /**
   * Save a workflow definition to storage
   */
  saveWorkflow(workflow: WorkflowDefinition): Promise<void>;

  /**
   * Delete a workflow definition from storage
   */
  deleteWorkflow(id: string): Promise<void>;

  /**
   * Load all workflow drafts from storage
   */
  loadWorkflowDrafts(): Promise<Record<string, WorkflowDefinition>>;

  /**
   * Save a workflow draft without replacing the saved workflow
   */
  saveWorkflowDraft(workflow: WorkflowDefinition): Promise<void>;

  /**
   * Delete a workflow draft
   */
  deleteWorkflowDraft(id: string): Promise<void>;

  // Environments
  /**
   * Load all environments from storage
   * @returns Array of environments
   */
  loadEnvironments(): Promise<Environment[]>;

  /**
   * Save environments to storage
   * @param environments - Array of environments to save
   */
  saveEnvironments(environments: Environment[]): Promise<void>;

  /**
   * Load global variables from storage
   * @returns Array of global variables
   */
  loadGlobalVariables(): Promise<EnvironmentVariable[]>;

  /**
   * Save global variables to storage
   * @param variables - Array of global variables to save
   */
  saveGlobalVariables(variables: EnvironmentVariable[]): Promise<void>;

  // History
  /**
   * Load history items from storage
   * @returns Array of history items
   */
  loadHistory(): Promise<HistoryItem[]>;

  /**
   * Save history items to storage
   * @param history - Array of history items to save
   */
  saveHistory(history: HistoryItem[]): Promise<void>;

  // Console Logs
  /**
   * Load persisted console logs
   */
  loadConsoleLogs(): Promise<ConsoleLog[]>;

  /**
   * Save console logs
   */
  saveConsoleLogs(logs: ConsoleLog[]): Promise<void>;

  // App State
  /**
   * Load application state from storage
   * @returns The app state or null if not found
   */
  loadAppState(): Promise<AppState | null>;

  /**
   * Save application state to storage
   * @param state - The app state to save
   */
  saveAppState(state: AppState): Promise<void>;

  // Sequences
  /**
   * Load sequences from storage
   * @returns Object mapping sequence names to sequence data
   */
  loadSequences(): Promise<Record<string, any>>;

  /**
   * Save sequences to storage
   * @param sequences - Object mapping sequence names to sequence data
   */
  saveSequences(sequences: Record<string, any>): Promise<void>;

  // Utility
  /**
   * Create a backup of all data
   */
  backup(): Promise<void>;

  /**
   * Flush any pending writes to disk
   */
  flush(): Promise<void>;
}
