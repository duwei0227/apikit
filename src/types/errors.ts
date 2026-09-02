// Error types for storage and data operations

export enum ErrorCode {
  FILE_NOT_FOUND = 'FILE_NOT_FOUND',
  PERMISSION_DENIED = 'PERMISSION_DENIED',
  DISK_FULL = 'DISK_FULL',
  INVALID_FORMAT = 'INVALID_FORMAT',
  CORRUPTED_DATA = 'CORRUPTED_DATA',
  NETWORK_ERROR = 'NETWORK_ERROR',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR'
}

export class StorageError extends Error {
  public code: ErrorCode;
  public details?: any;

  constructor(message: string, code: ErrorCode = ErrorCode.UNKNOWN_ERROR, details?: any) {
    super(message);
    this.name = 'StorageError';
    this.code = code;
    this.details = details;
    
    // Maintains proper stack trace for where our error was thrown (only available on V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, StorageError);
    }
  }
}

export function isStorageError(error: any): error is StorageError {
  return error instanceof StorageError;
}
