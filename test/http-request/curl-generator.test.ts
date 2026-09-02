import { describe, expect, it } from 'vitest';
import { generateCurlCommand } from '@/utils/curl-generator';
import { makeRequest } from '../helpers/workflowFactory';

const settings = {
  followRedirects: true,
  maxRedirectCount: 10,
  verifySsl: true,
  autoEncodeUrl: true,
  acceptEncoding: true,
};

const resolverFor = (variables: Record<string, string>) => (value: string) =>
  value.replace(/\{\{([^}]+)\}\}/g, (match, variableName) => {
    const key = variableName.trim();
    return variables[key] !== undefined ? variables[key] : match;
  });

describe('cURL command generation', () => {
  it('resolves variables across URL, params, headers, auth, and body', () => {
    const request = makeRequest({
      method: 'POST',
      url: '{{BASE_URL}}/users',
      params: [{ key: '{{QUERY_KEY}}', value: '{{QUERY_VALUE}}', enabled: true }],
      headers: [{ key: '{{HEADER_NAME}}', value: '{{HEADER_VALUE}}', enabled: true }],
      auth: { type: 'bearer', token: '{{TOKEN}}', username: '', password: '' },
      body: {
        type: 'json',
        raw: '{"name":"{{NAME}}","missing":"{{MISSING}}"}',
        formData: [],
        urlencoded: [],
      },
    });

    const command = generateCurlCommand(request, settings, resolverFor({
      BASE_URL: 'https://api.example.com',
      QUERY_KEY: 'search',
      QUERY_VALUE: 'hello world',
      HEADER_NAME: 'X-Client',
      HEADER_VALUE: 'ApiKit',
      TOKEN: 'secret-token',
      NAME: 'Alice',
    }));

    expect(command).toContain("'https://api.example.com/users?search=hello%20world'");
    expect(command).toContain("-H 'X-Client: ApiKit'");
    expect(command).toContain("-H 'Authorization: Bearer secret-token'");
    expect(command).toContain("-d '{\"name\":\"Alice\",\"missing\":\"{{MISSING}}\"}'");
  });

  it('resolves urlencoded, form-data, and file path values', () => {
    const urlencoded = makeRequest({
      method: 'POST',
      body: {
        type: 'x-www-form-urlencoded',
        raw: '',
        formData: [],
        urlencoded: [{ key: '{{KEY}}', value: '{{VALUE}}', enabled: true }],
      },
    });
    const formData = makeRequest({
      method: 'POST',
      body: {
        type: 'form-data',
        raw: '',
        urlencoded: [],
        formData: [
          { key: '{{FIELD}}', value: '{{TEXT}}', type: 'text', enabled: true },
          { key: '{{FILE_FIELD}}', value: '', filePath: '{{DIR}}/payload.bin', type: 'file', enabled: true },
        ],
      },
    });
    const resolve = resolverFor({
      KEY: 'mode', VALUE: 'hello world', FIELD: 'name', TEXT: 'ApiKit',
      FILE_FIELD: 'payload', DIR: '/tmp/files',
    });

    expect(generateCurlCommand(urlencoded, settings, resolve)).toContain("-d 'mode=hello%20world'");
    const formCommand = generateCurlCommand(formData, settings, resolve);
    expect(formCommand).toContain("-F 'name=ApiKit'");
    expect(formCommand).toContain("-F 'payload=@/tmp/files/payload.bin'");
  });

  it('resolves binary file paths', () => {
    const request = makeRequest({
      method: 'POST',
      body: {
        type: 'binary',
        raw: '',
        filePath: '{{DIR}}/archive.bin',
        formData: [],
        urlencoded: [],
      },
    });

    const command = generateCurlCommand(request, settings, resolverFor({ DIR: '/tmp/data' }));
    expect(command).toContain("--data-binary '@/tmp/data/archive.bin'");
  });
});
