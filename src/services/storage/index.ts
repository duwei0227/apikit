// Storage Service - Singleton export

import { FileSystemStorageService } from './FileSystemStorageService';
import type { IStorageService } from './IStorageService';

// Create singleton instance
export const storageService: IStorageService = new FileSystemStorageService();

// Export types
export type { IStorageService } from './IStorageService';
export { FileSystemStorageService } from './FileSystemStorageService';
