// Headers 编辑器的补全选项

// 常用 HTTP Headers
export const COMMON_HEADERS: string[] = [
  'Accept',
  'Accept-Encoding',
  'Accept-Language',
  'Authorization',
  'Cache-Control',
  'Connection',
  'Content-Type',
  'Cookie',
  'Host',
  'Origin',
  'Referer',
  'User-Agent',
  'X-Requested-With',
  'X-Forwarded-For',
  'X-Forwarded-Proto',
  'X-Api-Key',
  'X-Auth-Token'
];

// Header 值的预设选项
export const HEADER_VALUE_OPTIONS: Record<string, string[]> = {
  'Content-Type': [
    'application/json',
    'application/xml',
    'application/soap+xml',
    'application/x-www-form-urlencoded',
    'multipart/form-data',
    'text/plain',
    'text/html',
    'text/xml',
    'application/javascript',
    'application/pdf',
    'image/png',
    'image/jpeg',
    'image/gif'
  ],
  'Accept': [
    'application/json',
    'application/xml',
    'text/html',
    'text/plain',
    '*/*'
  ],
  'Accept-Encoding': [
    'gzip',
    'deflate',
    'br',
    'gzip, deflate, br'
  ],
  'Accept-Language': [
    'en-US',
    'en',
    'zh-CN',
    'zh',
    'en-US,en;q=0.9',
    'zh-CN,zh;q=0.9,en;q=0.8'
  ],
  'Cache-Control': [
    'no-cache',
    'no-store',
    'max-age=0',
    'max-age=3600',
    'public',
    'private'
  ],
  'Connection': [
    'keep-alive',
    'close'
  ]
};
