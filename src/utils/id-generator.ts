// ID generation utility using nanoid

import { nanoid } from 'nanoid';

/**
 * Generate a unique ID for collections, requests, folders, etc.
 * Uses nanoid for URL-safe, collision-resistant IDs
 * 
 * @param size - Length of the ID (default: 21 characters)
 * @returns A unique ID string
 */
export function generateId(size: number = 21): string {
  return nanoid(size);
}

/**
 * Generate a shorter ID for less critical items
 * 
 * @returns A 10-character unique ID
 */
export function generateShortId(): string {
  return nanoid(10);
}

/**
 * Generate a timestamp-based ID (useful for sorting by creation time)
 * Format: {timestamp}-{random}
 * 
 * @returns A timestamp-prefixed unique ID
 */
export function generateTimestampId(): string {
  return `${Date.now()}-${nanoid(8)}`;
}
