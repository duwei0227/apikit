import type { Request } from '@/types/models';
import { canSendRequestBody } from '@/utils/httpMethods';
import { setDefaultHeader } from '@/utils/httpHeaders';
import { buildRequestUrl } from '@/utils/urlQuery';

export interface CurlGenerationSettings {
  followRedirects: boolean;
  maxRedirectCount: number;
  verifySsl: boolean;
  autoEncodeUrl: boolean;
  acceptEncoding: boolean;
}

export type VariableResolver = (value: string) => string;

const identityResolver: VariableResolver = value => value;
const escapeShellSingleQuotes = (value: string): string => value.replace(/'/g, "'\\''");

export const generateCurlCommand = (
  request: Request,
  settings: CurlGenerationSettings,
  resolveVariables: VariableResolver = identityResolver,
): string => {
  let curl = `curl -X ${request.method}`;

  if (settings.followRedirects) curl += ` \\\n  --location`;
  curl += ` \\\n  --max-redirs ${settings.maxRedirectCount}`;
  if (!settings.verifySsl) curl += ` \\\n  --insecure`;
  if (settings.acceptEncoding) curl += ` \\\n  --compressed`;

  const url = buildRequestUrl(request.url, request.params, {
    autoEncode: settings.autoEncodeUrl,
    transform: resolveVariables,
  });
  curl += ` '${url}'`;

  const headers: Record<string, string> = {};
  request.headers
    .filter(header => header.enabled && header.key)
    .forEach(header => {
      headers[resolveVariables(header.key)] = resolveVariables(header.value);
    });

  if (request.auth.type === 'bearer' && request.auth.token) {
    const token = resolveVariables(request.auth.token);
    headers.Authorization = token.toLowerCase().startsWith('bearer ') ? token : `Bearer ${token}`;
  } else if (request.auth.type === 'basic' && request.auth.username) {
    const credentials = btoa(
      `${resolveVariables(request.auth.username)}:${resolveVariables(request.auth.password)}`,
    );
    headers.Authorization = `Basic ${credentials}`;
  }

  if (canSendRequestBody(request.method)) {
    if (request.body.type === 'json') {
      setDefaultHeader(headers, 'Content-Type', 'application/json');
    } else if (request.body.type === 'xml') {
      setDefaultHeader(headers, 'Content-Type', 'application/xml');
    } else if (request.body.type === 'text') {
      setDefaultHeader(headers, 'Content-Type', 'text/plain');
    } else if (request.body.type === 'binary') {
      setDefaultHeader(headers, 'Content-Type', 'application/octet-stream');
    } else if (request.body.type === 'x-www-form-urlencoded') {
      setDefaultHeader(headers, 'Content-Type', 'application/x-www-form-urlencoded');
    }
  }

  Object.entries(headers).forEach(([key, value]) => {
    curl += ` \\\n  -H '${key}: ${value}'`;
  });

  if (!canSendRequestBody(request.method)) return curl;

  if (request.body.type === 'json' && request.body.raw) {
    curl += ` \\\n  -d '${escapeShellSingleQuotes(resolveVariables(request.body.raw))}'`;
  } else if (request.body.type === 'xml' && request.body.raw) {
    curl += ` \\\n  -d '${escapeShellSingleQuotes(resolveVariables(request.body.raw))}'`;
  } else if (request.body.type === 'text' && request.body.raw) {
    curl += ` \\\n  --data-raw '${escapeShellSingleQuotes(resolveVariables(request.body.raw))}'`;
  } else if (request.body.type === 'binary' && request.body.filePath) {
    const filePath = escapeShellSingleQuotes(resolveVariables(request.body.filePath));
    curl += ` \\\n  --data-binary '@${filePath}'`;
  } else if (request.body.type === 'x-www-form-urlencoded') {
    const body = request.body.urlencoded
      .filter(item => item.enabled && item.key)
      .map(item => `${encodeURIComponent(resolveVariables(item.key))}=${encodeURIComponent(resolveVariables(item.value))}`)
      .join('&');
    curl += ` \\\n  -d '${body}'`;
  } else if (request.body.type === 'form-data') {
    const enabledData = request.body.formData.filter(item => item.enabled && item.key);
    enabledData.forEach(item => {
      const key = resolveVariables(item.key);
      if (item.type === 'text') {
        curl += ` \\\n  -F '${key}=${resolveVariables(item.value)}'`;
      } else if (item.file || item.filePath) {
        const filePath = resolveVariables(item.filePath || item.value);
        curl += ` \\\n  -F '${key}=@${filePath}'`;
      }
    });
  }

  return curl;
};
