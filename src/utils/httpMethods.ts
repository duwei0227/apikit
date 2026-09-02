const REQUEST_BODY_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);

export const canSendRequestBody = (method: string): boolean => {
  return REQUEST_BODY_METHODS.has(String(method || '').toUpperCase());
};
