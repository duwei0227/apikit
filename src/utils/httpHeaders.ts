export const hasHeader = (headers: Record<string, string>, name: string): boolean => {
  const normalizedName = name.toLowerCase();
  return Object.keys(headers).some(key => key.toLowerCase() === normalizedName);
};

export const setDefaultHeader = (
  headers: Record<string, string>,
  name: string,
  value: string,
): void => {
  if (!hasHeader(headers, name)) {
    headers[name] = value;
  }
};

export const removeHttpHeader = (headers: Record<string, string>, name: string): void => {
  const normalizedName = name.toLowerCase();
  const key = Object.keys(headers).find(headerName => headerName.toLowerCase() === normalizedName);
  if (key) {
    delete headers[key];
  }
};
