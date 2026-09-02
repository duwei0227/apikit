import type {
  AppState,
  Collection,
  ConsoleLog,
  Environment,
  EnvironmentVariable,
  HistoryItem,
  Request,
  WorkflowDefinition,
} from '@/types/models';
import type { IStorageService } from '@/services/storage/IStorageService';

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

class MockStorageService implements IStorageService {
  collections = new Map<string, Collection>();
  requests = new Map<string, Request>();
  requestDrafts = new Map<string, Request>();
  workflows = new Map<string, WorkflowDefinition>();
  workflowDrafts = new Map<string, WorkflowDefinition>();
  environments: Environment[] = [];
  globalVariables: EnvironmentVariable[] = [];
  history: HistoryItem[] = [];
  consoleLogs: ConsoleLog[] = [];
  appState: AppState | null = null;
  sequences: Record<string, any> = {};
  collectionOrder: string[] = [];

  reset() {
    this.collections.clear();
    this.requests.clear();
    this.requestDrafts.clear();
    this.workflows.clear();
    this.workflowDrafts.clear();
    this.environments = [];
    this.globalVariables = [];
    this.history = [];
    this.consoleLogs = [];
    this.appState = null;
    this.sequences = {};
    this.collectionOrder = [];
  }

  async initialize() {}

  async loadCollections() {
    return Array.from(this.collections.values()).map(clone);
  }

  async saveCollection(collection: Collection) {
    this.collections.set(collection.id, clone(collection));
  }

  async deleteCollection(id: string) {
    this.collections.delete(id);
  }

  async loadCollectionOrder() {
    return [...this.collectionOrder];
  }

  async saveCollectionOrder(ids: string[]) {
    this.collectionOrder = [...ids];
  }

  async loadRequest(id: string) {
    const request = this.requests.get(id);
    return request ? clone(request) : null;
  }

  async saveRequest(request: Request) {
    this.requests.set(request.id, clone(request));
  }

  async deleteRequest(id: string) {
    this.requests.delete(id);
    this.requestDrafts.delete(id);
  }

  async loadRequestDrafts() {
    return Object.fromEntries(Array.from(this.requestDrafts.entries()).map(([key, value]) => [key, clone(value)]));
  }

  async saveRequestDraft(request: Request) {
    this.requestDrafts.set(request.id, clone(request));
  }

  async deleteRequestDraft(id: string) {
    this.requestDrafts.delete(id);
  }

  async loadWorkflows() {
    return Array.from(this.workflows.values()).map(clone);
  }

  async saveWorkflow(workflow: WorkflowDefinition) {
    this.workflows.set(workflow.id, clone(workflow));
  }

  async deleteWorkflow(id: string) {
    this.workflows.delete(id);
  }

  async loadWorkflowDrafts() {
    return Object.fromEntries(Array.from(this.workflowDrafts.entries()).map(([key, value]) => [key, clone(value)]));
  }

  async saveWorkflowDraft(workflow: WorkflowDefinition) {
    this.workflowDrafts.set(workflow.id, clone(workflow));
  }

  async deleteWorkflowDraft(id: string) {
    this.workflowDrafts.delete(id);
  }

  async loadEnvironments() {
    return clone(this.environments);
  }

  async saveEnvironments(environments: Environment[]) {
    this.environments = clone(environments);
  }

  async loadGlobalVariables() {
    return clone(this.globalVariables);
  }

  async saveGlobalVariables(variables: EnvironmentVariable[]) {
    this.globalVariables = clone(variables);
  }

  async loadHistory() {
    return clone(this.history);
  }

  async saveHistory(history: HistoryItem[]) {
    this.history = clone(history);
  }

  async loadConsoleLogs() {
    return clone(this.consoleLogs);
  }

  async saveConsoleLogs(logs: ConsoleLog[]) {
    this.consoleLogs = clone(logs);
  }

  async loadAppState() {
    return this.appState ? clone(this.appState) : null;
  }

  async saveAppState(state: AppState) {
    this.appState = clone(state);
  }

  async loadSequences() {
    return clone(this.sequences);
  }

  async saveSequences(sequences: Record<string, any>) {
    this.sequences = clone(sequences);
  }

  async backup() {}

  async flush() {}
}

export const mockStorageService = new MockStorageService();

export const resetMockStorage = () => {
  mockStorageService.reset();
};
