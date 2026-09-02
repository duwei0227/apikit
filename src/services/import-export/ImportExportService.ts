import { save, open } from '@tauri-apps/plugin-dialog';
import { writeTextFile, readTextFile } from '@tauri-apps/plugin-fs';
import type { AuthConfig, Collection, Environment, Folder, HttpMethod, KeyValue, Request, RequestBody, RequestReference } from '@/types/models';
import { generateId } from '@/utils/id-generator';
import { isValidJsonSyntax } from '@/utils/jsonSyntax';
import { parseRequestUrl, serializeRequestUrl } from '@/utils/urlQuery';

export interface ExportFormat {
  version: string;
  exportedAt: string;
  collection: Collection;
  requests: Request[];
}

export interface MultiExportFormat {
  version: string;
  exportedAt: string;
  collections: Collection[];
  requests: Request[];
}

export interface EnvironmentExportFormat {
  version: string;
  exportedAt: string;
  environment?: Environment;
  environments?: Environment[];
}

export type CollectionExportTarget = 'apikit' | 'postman';
export type EnvironmentExportTarget = 'apikit' | 'postman';

export class ImportExportService {
  private readonly EXPORT_VERSION = '1.0.0';
  private readonly POSTMAN_SCHEMA = 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json';
  private readonly EXPORT_TOOL = 'ApiKit';
  private readonly MAX_INFERRED_JSON_BODY_LENGTH = 64 * 1024;

  async exportCollection(
    collection: Collection,
    requests: Request[],
    format: CollectionExportTarget = 'apikit'
  ): Promise<boolean> {
    try {
      const exportData = format === 'postman'
        ? this.toPostmanCollection([collection], requests)
        : {
            version: this.EXPORT_VERSION,
            exportedAt: new Date().toISOString(),
            collection,
            requests
          } satisfies ExportFormat;

      // Show save dialog
      const filePath = await save({
        defaultPath: format === 'postman'
          ? `${collection.name}.postman_collection.json`
          : `${collection.name}.json`,
        filters: [{
          name: 'JSON',
          extensions: ['json']
        }]
      });

      if (!filePath) {
        return false; // User cancelled
      }

      // Write to file
      await writeTextFile(filePath, JSON.stringify(exportData, null, 2));

      console.log('Collection exported successfully:', filePath);
      return true;
    } catch (error) {
      console.error('Failed to export collection:', error);
      throw new Error('Failed to export collection');
    }
  }

  async exportCollections(
    collections: Collection[],
    requests: Request[],
    format: CollectionExportTarget = 'apikit'
  ): Promise<boolean> {
    try {
      const exportData = format === 'postman'
        ? this.toPostmanCollection(collections, requests)
        : {
            version: this.EXPORT_VERSION,
            exportedAt: new Date().toISOString(),
            collections,
            requests
          } satisfies MultiExportFormat;

      const filePath = await save({
        defaultPath: format === 'postman'
          ? (collections.length === 1 ? `${collections[0].name}.postman_collection.json` : 'apikit-export.postman_collection.json')
          : (collections.length === 1 ? `${collections[0].name}.json` : 'apikit-export.json'),
        filters: [{
          name: 'JSON',
          extensions: ['json']
        }]
      });

      if (!filePath) {
        return false;
      }

      await writeTextFile(filePath, JSON.stringify(exportData, null, 2));

      console.log('Collections exported successfully:', filePath);
      return true;
    } catch (error) {
      console.error('Failed to export collections:', error);
      throw new Error('Failed to export collections');
    }
  }

  async importCollection(): Promise<{
    collection?: Collection;
    collections?: Collection[];
    requests: Request[];
  } | null> {
    try {
      // Show open dialog
      const filePath = await open({
        multiple: false,
        filters: [{
          name: 'JSON',
          extensions: ['json']
        }]
      });

      if (!filePath) {
        return null; // User cancelled
      }

      // Read file
      const content = await readTextFile(filePath as string);
      const importData = JSON.parse(content);

      if (this.isPostmanCollection(importData)) {
        console.log('Postman collection imported successfully');
        return this.fromPostmanCollection(importData);
      }

      // Validate format
      if (!this.validateImportData(importData)) {
        throw new Error('Invalid import file format');
      }

      if ('collections' in importData && Array.isArray(importData.collections)) {
        const { collections, requests } = this.remapCollections(
          importData.collections,
          importData.requests
        );

        console.log('Collections imported successfully');
        return { collections, requests };
      }

      const { collection, requests } = this.remapIds(
        importData.collection,
        importData.requests
      );

      console.log('Collection imported successfully');
      return { collection, requests };
    } catch (error) {
      console.error('Failed to import collection:', error);
      throw new Error('Failed to import collection');
    }
  }

  async exportEnvironment(
    environment: Environment,
    format: EnvironmentExportTarget = 'apikit'
  ): Promise<boolean> {
    try {
      const exportData = format === 'postman'
        ? this.toPostmanEnvironment(environment)
        : {
            version: this.EXPORT_VERSION,
            exportedAt: new Date().toISOString(),
            environment
          } satisfies EnvironmentExportFormat;

      const filePath = await save({
        defaultPath: format === 'postman'
          ? `${environment.name}.postman_environment.json`
          : `apikit-environment-${environment.name}.json`,
        filters: [{
          name: 'JSON',
          extensions: ['json']
        }]
      });

      if (!filePath) {
        return false;
      }

      await writeTextFile(filePath, JSON.stringify(exportData, null, 2));
      console.log('Environment exported successfully:', filePath);
      return true;
    } catch (error) {
      console.error('Failed to export environment:', error);
      throw new Error('Failed to export environment');
    }
  }

  async exportEnvironments(environments: Environment[]): Promise<boolean> {
    try {
      const exportData: EnvironmentExportFormat = {
        version: this.EXPORT_VERSION,
        exportedAt: new Date().toISOString(),
        environments
      };

      const filePath = await save({
        defaultPath: environments.length === 1
          ? `apikit-environment-${environments[0].name}.json`
          : 'apikit-environments.json',
        filters: [{
          name: 'JSON',
          extensions: ['json']
        }]
      });

      if (!filePath) {
        return false;
      }

      await writeTextFile(filePath, JSON.stringify(exportData, null, 2));
      console.log('Environments exported successfully:', filePath);
      return true;
    } catch (error) {
      console.error('Failed to export environments:', error);
      throw new Error('Failed to export environments');
    }
  }

  async importEnvironments(): Promise<Environment[] | null> {
    try {
      const filePath = await open({
        multiple: false,
        filters: [{
          name: 'JSON',
          extensions: ['json']
        }]
      });

      if (!filePath) {
        return null;
      }

      const content = await readTextFile(filePath as string);
      const importData = JSON.parse(content);

      if (this.isPostmanEnvironment(importData)) {
        console.log('Postman environment imported successfully');
        return [this.remapEnvironment(this.fromPostmanEnvironment(importData))];
      }

      if (!this.validateEnvironmentImportData(importData)) {
        throw new Error('Invalid environment import file format');
      }

      const environments = importData.environments || [importData.environment as Environment];
      return environments.map(environment => this.remapEnvironment(environment));
    } catch (error) {
      console.error('Failed to import environments:', error);
      throw new Error('Failed to import environments');
    }
  }

  private validateImportData(data: any): data is ExportFormat | MultiExportFormat {
    return (
      data &&
      typeof data.version === 'string' &&
      typeof data.exportedAt === 'string' &&
      (data.collection || Array.isArray(data.collections)) &&
      Array.isArray(data.requests)
    );
  }

  private validateEnvironmentImportData(data: any): data is EnvironmentExportFormat {
    return (
      data &&
      typeof data.version === 'string' &&
      typeof data.exportedAt === 'string' &&
      (
        this.isEnvironment(data.environment) ||
        (Array.isArray(data.environments) && data.environments.every((environment: any) => this.isEnvironment(environment)))
      )
    );
  }

  private isEnvironment(environment: any): environment is Environment {
    return (
      environment &&
      typeof environment.id === 'string' &&
      typeof environment.name === 'string' &&
      Array.isArray(environment.variables)
    );
  }

  private remapEnvironment(environment: Environment): Environment {
    return {
      ...environment,
      id: generateId(),
      isActive: false,
      variables: (environment.variables || [])
        .filter(variable => variable && typeof variable.key === 'string')
        .map(variable => ({
          ...variable,
          value: variable.value ?? '',
          enabled: variable.enabled !== false
        }))
    };
  }

  /**
   * 判断给定数据是否为 Postman 环境文件（单环境/文件格式）。
   * 优先识别官方标记 `_postman_variable_scope`，并兼容仅含 `name` + `values` 的文件。
   */
  private isPostmanEnvironment(data: any): boolean {
    return (
      data &&
      (
        data._postman_variable_scope === 'environment' ||
        (typeof data.name === 'string' && Array.isArray(data.values))
      )
    );
  }

  /**
   * 将 Postman 环境文件转换为内部 Environment 结构。
   * 仅做结构映射；id 重置、isActive 与变量归一化交由 remapEnvironment 处理。
   * Postman 的 secret 变量按普通变量处理（取 value）。
   */
  private fromPostmanEnvironment(data: any): Environment {
    const values = Array.isArray(data.values) ? data.values : [];

    return {
      id: data.id || generateId(),
      name: typeof data.name === 'string' && data.name.trim() ? data.name : 'Imported Environment',
      isActive: false,
      variables: values
        .filter((value: any) => value && typeof value.key === 'string')
        .map((value: any) => ({
          key: value.key,
          value: String(value.value ?? ''),
          enabled: value.enabled !== false
        }))
    };
  }

  /**
   * 将内部 Environment 转换为标准 Postman 环境文件（单环境/文件格式）。
   * 过滤掉无 key 的变量，统一标记为 default 类型。
   */
  private toPostmanEnvironment(environment: Environment): any {
    return {
      id: environment.id || generateId(),
      name: environment.name,
      values: (environment.variables || [])
        .filter(variable => variable && variable.key)
        .map(variable => ({
          key: variable.key,
          value: variable.value ?? '',
          type: 'default',
          enabled: variable.enabled !== false
        })),
      _postman_variable_scope: 'environment',
      _postman_exported_at: new Date().toISOString(),
      _postman_exported_using: this.EXPORT_TOOL
    };
  }

  private remapCollections(
    collections: Collection[],
    requests: Request[]
  ): { collections: Collection[]; requests: Request[] } {
    const remappedCollections: Collection[] = [];
    const remappedRequests: Request[] = [];

    for (const collection of collections) {
      const requestIds = new Set<string>();
      this.collectCollectionRequestIds(collection, requestIds);
      const collectionRequests = requests.filter(request => requestIds.has(request.id));
      const remapped = this.remapIds(collection, collectionRequests);

      remappedCollections.push(remapped.collection);
      remappedRequests.push(...remapped.requests);
    }

    return { collections: remappedCollections, requests: remappedRequests };
  }

  private collectCollectionRequestIds(collection: Collection, ids: Set<string>): void {
    collection.requests?.forEach(request => ids.add(request.id));
    collection.folders?.forEach(folder => this.collectFolderRequestIds(folder, ids));
  }

  private collectFolderRequestIds(folder: any, ids: Set<string>): void {
    folder.requests?.forEach((request: any) => ids.add(request.id));
    folder.folders?.forEach((child: any) => this.collectFolderRequestIds(child, ids));
  }

  private remapIds(
    collection: Collection,
    requests: Request[]
  ): { collection: Collection; requests: Request[] } {
    const idMap = new Map<string, string>();
    const folderIdMap = new Map<string, string>();
    const requestIdMap = new Map<string, string>();

    // Generate new collection ID
    const newCollectionId = generateId();
    idMap.set(collection.id, newCollectionId);

    // First pass: generate all folder IDs
    const generateFolderIds = (folders: any[]) => {
      for (const folder of folders) {
        const newFolderId = generateId();
        folderIdMap.set(folder.id, newFolderId);
        if (folder.folders && folder.folders.length > 0) {
          generateFolderIds(folder.folders);
        }
      }
    };
    
    if (collection.folders && collection.folders.length > 0) {
      generateFolderIds(collection.folders);
    }

    // Second pass: generate all request IDs
    for (const request of requests) {
      const newRequestId = generateId();
      requestIdMap.set(request.id, newRequestId);
    }

    // Remap folders with new IDs
    const remapFolders = (folders: any[]): any[] => {
      return folders.map(folder => ({
        ...folder,
        id: folderIdMap.get(folder.id) || folder.id,
        folders: folder.folders ? remapFolders(folder.folders) : [],
        requests: folder.requests ? folder.requests.map((req: any) => ({
          ...req,
          id: requestIdMap.get(req.id) || req.id
        })) : []
      }));
    };

    // Remap collection
    const newCollection: Collection = {
      ...collection,
      id: newCollectionId,
      folders: collection.folders ? remapFolders(collection.folders) : [],
      requests: collection.requests ? collection.requests.map(req => ({
        ...req,
        id: requestIdMap.get(req.id) || req.id
      })) : [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    // Remap requests
    const newRequests: Request[] = requests.map(request => ({
      ...request,
      id: requestIdMap.get(request.id) || request.id,
      collectionId: newCollectionId,
      folderId: request.folderId ? folderIdMap.get(request.folderId) || null : null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }));

    return { collection: newCollection, requests: newRequests };
  }

  private isPostmanCollection(data: any): boolean {
    return (
      data &&
      data.info &&
      typeof data.info.name === 'string' &&
      Array.isArray(data.item)
    );
  }

  private fromPostmanCollection(data: any): { collection: Collection; requests: Request[] } {
    const collectionId = generateId();
    const now = new Date().toISOString();
    const parsed = this.fromPostmanItems(data.item, collectionId, null, data.auth);

    return {
      collection: {
        id: collectionId,
        name: data.info.name || 'Imported Postman Collection',
        description: this.postmanDescriptionToString(data.info.description),
        folders: parsed.folders,
        requests: parsed.requestRefs,
        createdAt: now,
        updatedAt: now
      },
      requests: parsed.requests
    };
  }

  private fromPostmanItems(items: any[], collectionId: string, folderId: string | null, inheritedAuth: any): {
    folders: Folder[];
    requestRefs: RequestReference[];
    requests: Request[];
  } {
    const folders: Folder[] = [];
    const requestRefs: RequestReference[] = [];
    const requests: Request[] = [];

    // 用 Postman item 数组下标作为 order，folder 与 request 共用同一索引，
    // 从而保留同层级内 folder 与 request 的交错顺序。
    const list = items || [];
    for (let i = 0; i < list.length; i++) {
      const item = list[i];
      if (Array.isArray(item.item)) {
        const id = generateId();
        const parsed = this.fromPostmanItems(item.item, collectionId, id, item.auth || inheritedAuth);
        folders.push({
          id,
          name: item.name || 'Folder',
          description: this.postmanDescriptionToString(item.description),
          order: i,
          folders: parsed.folders,
          requests: parsed.requestRefs
        });
        requests.push(...parsed.requests);
        continue;
      }

      if (!item.request) continue;

      const request = this.fromPostmanRequest(item, collectionId, folderId, inheritedAuth);
      requests.push(request);
      requestRefs.push({
        id: request.id,
        name: request.name,
        method: request.method,
        url: request.url,
        order: i
      });
    }

    return { folders, requestRefs, requests };
  }

  private fromPostmanRequest(item: any, collectionId: string, folderId: string | null, inheritedAuth: any): Request {
    const postmanRequest = typeof item.request === 'string'
      ? { url: item.request, method: 'GET' }
      : item.request;
    const { url, params } = this.parsePostmanUrl(postmanRequest.url);
    const headers = this.fromPostmanKeyValues(postmanRequest.header);
    const now = new Date().toISOString();

    return {
      id: generateId(),
      name: item.name || 'Untitled Request',
      method: this.normalizeMethod(postmanRequest.method),
      url,
      params,
      headers,
      body: this.fromPostmanBody(postmanRequest.body, headers),
      auth: this.fromPostmanAuth(postmanRequest.auth || item.auth || inheritedAuth),
      tests: {
        statusCodeTests: [{ enabled: true, operator: 'equals', expectedValue: '200', description: '' }],
        jsonFieldTests: [],
        globalVariables: []
      },
      collectionId,
      folderId: folderId || undefined,
      createdAt: now,
      updatedAt: now
    };
  }

  private parsePostmanUrl(url: any): { url: string; params: KeyValue[] } {
    if (typeof url === 'string') {
      return this.splitUrlAndParams(url);
    }

    const raw = typeof url?.raw === 'string' ? url.raw : this.stringifyPostmanUrl(url);
    const parsed = this.splitUrlAndParams(raw);
    const query = Array.isArray(url?.query)
      ? url.query
          .filter((item: any) => item && typeof item.key === 'string')
          .map((item: any) => ({
            key: item.key,
            value: String(item.value ?? ''),
            enabled: item.disabled !== true,
            hasEquals: item.value !== undefined && item.value !== null
          }))
      : parsed.params;

    return {
      url: parsed.url,
      params: query
    };
  }

  private stringifyPostmanUrl(url: any): string {
    if (!url) return '';

    const protocol = typeof url.protocol === 'string' ? `${url.protocol}://` : '';
    const host = Array.isArray(url.host) ? url.host.join('.') : String(url.host ?? '');
    const path = Array.isArray(url.path) ? url.path.join('/') : String(url.path ?? '');
    const basePath = path ? `/${path}` : '';
    const params = Array.isArray(url.query)
      ? url.query.map((item: any) => ({
          key: String(item?.key ?? ''),
          value: String(item?.value ?? ''),
          enabled: item?.disabled !== true,
          hasEquals: item?.value !== undefined && item?.value !== null,
        }))
      : [];

    return serializeRequestUrl(`${protocol}${host}${basePath}`, params, { autoEncode: false });
  }

  private splitUrlAndParams(rawUrl: string): { url: string; params: KeyValue[] } {
    const parsed = parseRequestUrl(rawUrl);
    return {
      url: serializeRequestUrl(parsed.baseUrl, [], { fragment: parsed.fragment }),
      params: parsed.params,
    };
  }

  private fromPostmanKeyValues(values: any): KeyValue[] {
    if (!Array.isArray(values)) return [];

    return values
      .filter(item => item && typeof item.key === 'string')
      .map(item => ({
        key: item.key,
        value: String(item.value ?? ''),
        enabled: item.disabled !== true
      }));
  }

  private fromPostmanBody(body: any, headers: KeyValue[]): RequestBody {
    const requestBody: RequestBody = {
      type: 'none',
      raw: '',
      formData: [],
      urlencoded: []
    };

    if (!body || !body.mode) return requestBody;

    if (body.mode === 'urlencoded') {
      return {
        ...requestBody,
        type: 'x-www-form-urlencoded',
        urlencoded: this.fromPostmanKeyValues(body.urlencoded)
      };
    }

    if (body.mode === 'formdata') {
      return {
        ...requestBody,
        type: 'form-data',
        formData: (Array.isArray(body.formdata) ? body.formdata : [])
          .filter((item: any) => item && typeof item.key === 'string')
          .flatMap((item: any) => {
            if (item.type !== 'file') {
              return [{
                key: item.key,
                value: String(item.value ?? ''),
                type: 'text' as const,
                enabled: item.disabled !== true,
              }];
            }

            const filePaths = Array.isArray(item.src) ? item.src : [item.src];
            return filePaths.map((source: unknown) => {
              const filePath = String(source ?? '');
              return {
                key: item.key,
                value: filePath.replace(/\\/g, '/').split('/').pop() || '',
                type: 'file' as const,
                enabled: item.disabled !== true,
                filePath,
              };
            });
          })
      };
    }

    const contentType = headers.find(header =>
      header.enabled !== false && header.key.toLowerCase() === 'content-type'
    )?.value || '';

    if (body.mode === 'raw') {
      const rawLanguage = String(body.options?.raw?.language || '').toLowerCase();
      const raw = String(body.raw ?? '');
      const isXml = rawLanguage === 'xml' || /(?:^|[+/])xml(?:$|[;\s])/i.test(contentType);
      let isJson = rawLanguage === 'json' || /(?:^|[+/])json(?:$|[;\s])/i.test(contentType);
      if (!isJson) {
        if (raw.length <= this.MAX_INFERRED_JSON_BODY_LENGTH) {
          try {
            JSON.parse(raw);
            isJson = true;
          } catch { /* Treat unlabelled non-JSON bodies as text. */ }
        } else {
          isJson = isValidJsonSyntax(raw);
        }
      }
      return {
        ...requestBody,
        type: isXml ? 'xml' : (isJson ? 'json' : 'text'),
        raw
      };
    }

    if (body.mode === 'file') {
      const filePath = Array.isArray(body.file?.src)
        ? String(body.file.src[0] ?? '')
        : String(body.file?.src ?? '');
      return {
        ...requestBody,
        type: 'binary',
        filePath
      };
    }

    if (body.mode === 'graphql') {
      return {
        ...requestBody,
        type: 'json',
        raw: JSON.stringify(body.graphql || {}, null, 2)
      };
    }

    if (contentType.includes('application/json')) {
      return {
        ...requestBody,
        type: 'json',
        raw: String(body.raw ?? '')
      };
    }

    return requestBody;
  }

  private fromPostmanAuth(auth: any): AuthConfig {
    const emptyAuth: AuthConfig = {
      type: 'none',
      token: '',
      username: '',
      password: ''
    };

    if (!auth || auth.type === 'noauth') return emptyAuth;

    if (auth.type === 'bearer') {
      const token = this.findPostmanAuthValue(auth.bearer, 'token');
      return { ...emptyAuth, type: 'bearer', token };
    }

    if (auth.type === 'basic') {
      return {
        ...emptyAuth,
        type: 'basic',
        username: this.findPostmanAuthValue(auth.basic, 'username'),
        password: this.findPostmanAuthValue(auth.basic, 'password')
      };
    }

    return emptyAuth;
  }

  private findPostmanAuthValue(values: any, key: string): string {
    if (!Array.isArray(values)) return '';
    const item = values.find(value => value?.key === key);
    return String(item?.value ?? '');
  }

  private normalizeMethod(method: string): HttpMethod {
    const normalized = String(method || 'GET').toUpperCase();
    return ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'].includes(normalized)
      ? normalized as HttpMethod
      : 'GET';
  }

  private postmanDescriptionToString(description: any): string {
    if (!description) return '';
    if (typeof description === 'string') return description;
    if (typeof description.content === 'string') return description.content;
    return '';
  }

  private toPostmanCollection(collections: Collection[], requests: Request[]): any {
    const name = collections.length === 1 ? collections[0].name : 'ApiKit Export';
    const description = collections.length === 1 ? collections[0].description : '';
    const requestMap = new Map(requests.map(request => [request.id, request]));

    return {
      info: {
        _postman_id: generateId(),
        name,
        description: description || undefined,
        schema: this.POSTMAN_SCHEMA
      },
      item: collections.length === 1
        ? this.collectionItemsToPostman(collections[0], requestMap)
        : collections.map(collection => ({
            name: collection.name,
            description: collection.description || undefined,
            item: this.collectionItemsToPostman(collection, requestMap)
          }))
    };
  }

  private collectionItemsToPostman(collection: Collection, requestMap: Map<string, Request>): any[] {
    return this.mergeChildrenToPostman(collection.folders, collection.requests, requestMap);
  }

  private folderToPostman(folder: Folder, requestMap: Map<string, Request>): any {
    return {
      name: folder.name,
      description: folder.description || undefined,
      item: this.mergeChildrenToPostman(folder.folders, folder.requests, requestMap)
    };
  }

  /**
   * 将同层级的 folders 与 requests 合并为 Postman item 数组。
   * 当所有子项都带 order 时按 order 升序排列以保留交错顺序；
   * 否则回退到「folders 在前、requests 在后」（与渲染回退规则一致）。
   */
  private mergeChildrenToPostman(
    folders: Folder[] | undefined,
    requests: RequestReference[] | undefined,
    requestMap: Map<string, Request>
  ): any[] {
    const folderList = folders || [];
    const requestList = requests || [];

    // 先按「folders 在前、requests 在后」构建（即回退顺序），每个子项只映射一次。
    const entries: Array<{ order: number | undefined; item: any }> = [
      ...folderList.map(folder => ({
        order: folder.order,
        item: this.folderToPostman(folder, requestMap)
      })),
      ...requestList.map(requestRef => ({
        order: requestRef.order,
        item: this.requestRefToPostman(requestRef, requestMap)
      }))
    ].filter(entry => entry.item != null);

    // 仅当所有子项都带 order 时才按 order 重排以保留交错顺序；否则保持回退顺序。
    const allOrdered = entries.length > 0 && entries.every(entry => typeof entry.order === 'number');
    if (allOrdered) {
      entries.sort((a, b) => (a.order as number) - (b.order as number));
    }

    return entries.map(entry => entry.item);
  }

  private requestRefToPostman(requestRef: RequestReference, requestMap: Map<string, Request>): any | null {
    const request = requestMap.get(requestRef.id);
    if (!request) return null;

    return {
      name: request.name || requestRef.name,
      request: {
        method: request.method,
        header: this.toPostmanKeyValues(request.headers),
        url: this.toPostmanUrl(request),
        auth: this.toPostmanAuth(request.auth),
        body: this.toPostmanBody(request.body)
      }
    };
  }

  private toPostmanKeyValues(values: KeyValue[]): any[] {
    return (values || [])
      .filter(item => item.key || item.value)
      .map(item => ({
        key: item.key,
        value: item.value,
        disabled: item.enabled === false ? true : undefined
      }));
  }

  private toPostmanUrl(request: Request): any {
    const parsedUrl = parseRequestUrl(request.url);
    const baseUrl = parsedUrl.baseUrl;
    const query = this.mergeRequestQueryParams(request.url, request.params || [])
      .filter(param => param.key || param.value)
      .map(param => ({
        key: param.key,
        value: param.hasEquals === false && param.value === '' ? undefined : param.value,
        disabled: param.enabled === false ? true : undefined
      }));
    const raw = serializeRequestUrl(
      baseUrl,
      query.map(param => ({
        key: param.key,
        value: String(param.value ?? ''),
        enabled: param.disabled !== true,
        hasEquals: param.value !== undefined,
      })),
      { autoEncode: false, fragment: parsedUrl.fragment },
    );
    const urlParts = this.toPostmanUrlParts(baseUrl);

    return {
      raw,
      ...urlParts,
      query
    };
  }

  private mergeRequestQueryParams(url: string, params: KeyValue[]): KeyValue[] {
    const urlParams = this.splitUrlAndParams(url).params;
    if (params.some(param => param.key || param.value)) {
      return params;
    }

    return urlParams;
  }

  private toPostmanUrlParts(baseUrl: string): any {
    const protocolMatch = baseUrl.match(/^([a-z][a-z0-9+.-]*):\/\//i);
    const protocol = protocolMatch?.[1];
    const withoutProtocol = protocol ? baseUrl.slice(protocolMatch![0].length) : baseUrl;
    const slashIndex = withoutProtocol.indexOf('/');
    const hostText = slashIndex === -1 ? withoutProtocol : withoutProtocol.slice(0, slashIndex);
    const pathText = slashIndex === -1 ? '' : withoutProtocol.slice(slashIndex + 1);

    return {
      ...(protocol ? { protocol } : {}),
      host: hostText ? hostText.split('.') : [],
      path: pathText ? pathText.split('/').filter(Boolean) : []
    };
  }

  private toPostmanBody(body: RequestBody): any | undefined {
    if (!body) return undefined;

    const hasRawBody = Boolean(body.raw);
    const hasFormData = (body.formData || []).some(item => item.key || item.value);
    const hasUrlencoded = (body.urlencoded || []).some(item => item.key || item.value);

    if (body.type === 'none' && !hasRawBody && !hasFormData && !hasUrlencoded) {
      return undefined;
    }

    if (body.type === 'x-www-form-urlencoded' || (body.type === 'none' && hasUrlencoded)) {
      return {
        mode: 'urlencoded',
        urlencoded: this.toPostmanKeyValues(body.urlencoded)
      };
    }

    if (body.type === 'form-data' || (body.type === 'none' && hasFormData)) {
      return {
        mode: 'formdata',
        formdata: (body.formData || [])
          .filter(item => item.key || item.value)
          .map(item => ({
            key: item.key,
            value: item.type === 'file' ? undefined : item.value,
            src: item.type === 'file' ? (item.filePath || item.value) : undefined,
            type: item.type,
            disabled: item.enabled === false ? true : undefined
          }))
      };
    }

    if (body.type === 'binary') {
      return {
        mode: 'file',
        file: { src: body.filePath || '' }
      };
    }

    return {
      mode: 'raw',
      raw: body.raw || '',
      options: {
        raw: {
          language: body.type === 'xml' ? 'xml' : (body.type === 'text' ? 'text' : 'json')
        }
      }
    };
  }

  private toPostmanAuth(auth: AuthConfig): any | undefined {
    if (!auth || auth.type === 'none') return undefined;

    if (auth.type === 'bearer') {
      return {
        type: 'bearer',
        bearer: [{ key: 'token', value: auth.token || '', type: 'string' }]
      };
    }

    if (auth.type === 'basic') {
      return {
        type: 'basic',
        basic: [
          { key: 'username', value: auth.username || '', type: 'string' },
          { key: 'password', value: auth.password || '', type: 'string' }
        ]
      };
    }

    return undefined;
  }
}

export const importExportService = new ImportExportService();
