import type { RequestBody, RequestSettings } from '@/types/models';

export interface CurlParseWarning {
  option?: string;
  message: string;
}

export interface ParsedCurl {
  method: string;
  url: string;
  headers: { key: string; value: string; enabled: boolean }[];
  body: RequestBody;
  auth: {
    type: string;
    token: string;
    username: string;
    password: string;
  };
  settings: Required<RequestSettings>;
  warnings: CurlParseWarning[];
}

type DataEntry = { value: string; option: string };
type FormEntry = { value: string; forceText: boolean };

const unsupportedOptionsWithValue = new Set([
  '--cacert', '--capath', '--cert', '--connect-timeout', '--connect-to', '--dns-interface',
  '--interface', '--key', '--limit-rate', '--max-time', '--output', '--proxy', '--request-target',
  '--resolve', '--retry', '--retry-delay', '--retry-max-time', '--upload-file',
  '-E', '-m', '-o', '-T', '-x',
]);

/** Tokenize a shell-style curl command while preserving quoted whitespace. */
function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];

    if (ch === '\\' && !inSingle) {
      const next = input[i + 1];
      if (!inDouble || ['"', '\\', '$', '`'].includes(next)) {
        if (next !== undefined) current += input[++i];
        continue;
      }
      current += ch;
      continue;
    }

    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }

    if (/\s/.test(ch) && !inSingle && !inDouble) {
      if (current) tokens.push(current);
      current = '';
      continue;
    }

    current += ch;
  }

  if (current) tokens.push(current);
  return tokens;
}

const stripWrappingDoubleQuotes = (value: string): string => {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1);
  }
  return value;
};

const splitFormModifiers = (value: string): string => {
  let quoted = false;
  for (let i = 0; i < value.length; i++) {
    if (value[i] === '"') quoted = !quoted;
    if (value[i] === ';' && !quoted) return value.slice(0, i);
  }
  return value;
};

const fileNameFromPath = (filePath: string): string => {
  const normalized = filePath.replace(/\\/g, '/');
  return normalized.split('/').pop() || normalized;
};

const decodeFormComponent = (value: string): string => {
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '));
  } catch {
    return value;
  }
};

const parseUrlencodedBody = (raw: string) => raw.split('&').map(pair => {
  const equalsIndex = pair.indexOf('=');
  const key = equalsIndex === -1 ? pair : pair.slice(0, equalsIndex);
  const value = equalsIndex === -1 ? '' : pair.slice(equalsIndex + 1);
  return {
    key: decodeFormComponent(key),
    value: decodeFormComponent(value),
    enabled: true,
  };
});

const looksLikeUrl = (value: string): boolean =>
  /^(?:[a-z][a-z\d+.-]*:\/\/|\{\{[^}]+\}\}|localhost(?::|\/|$))/i.test(value);

const optionWithValue = (token: string): { option: string; inlineValue?: string } => {
  if (token.startsWith('--')) {
    const equalsIndex = token.indexOf('=');
    if (equalsIndex > 2) {
      return { option: token.slice(0, equalsIndex), inlineValue: token.slice(equalsIndex + 1) };
    }
  }

  if (/^-[XHdFucbxEmAeoT]/.test(token) && token.length > 2) {
    return { option: token.slice(0, 2), inlineValue: token.slice(2) };
  }
  return { option: token };
};

export function parseCurl(curlCommand: string): ParsedCurl {
  const command = curlCommand
    .replace(/\\\r?\n/g, ' ')
    .replace(/\^\r?\n/g, ' ')
    .replace(/\r?\n/g, ' ')
    .trim()
    .replace(/^\$\s+/, '')
    .replace(/^curl(?:\.exe)?\s+/i, '');
  const tokens = tokenize(command);

  let method = '';
  let explicitUrl = '';
  const positional: string[] = [];
  const headers: { key: string; value: string; enabled: boolean }[] = [];
  const dataEntries: DataEntry[] = [];
  const dataUrlencode: string[] = [];
  const formEntries: FormEntry[] = [];
  const warnings: CurlParseWarning[] = [];
  let hasLocation = false;
  let hasLocationTrusted = false;
  let maxRedirectCount: number | null = null;
  let hasInsecure = false;
  let hasCompressed = false;
  let authUser = '';

  const consumeValue = (index: number, inlineValue?: string): { value: string; index: number } => {
    if (inlineValue !== undefined) return { value: inlineValue, index };
    return { value: tokens[index + 1] || '', index: index + 1 };
  };

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];

    if (/^-[Lksv]{2,}$/.test(token)) {
      for (const flag of token.slice(1)) {
        if (flag === 'L') hasLocation = true;
        else if (flag === 'k') hasInsecure = true;
      }
      continue;
    }

    const { option, inlineValue } = optionWithValue(token);
    const take = () => {
      const consumed = consumeValue(i, inlineValue);
      i = consumed.index;
      return consumed.value;
    };

    if (option === '-X' || option === '--request') {
      method = (take() || 'GET').toUpperCase();
    } else if (option === '-H' || option === '--header') {
      const header = take();
      const colonIndex = header.indexOf(':');
      if (colonIndex > 0) {
        headers.push({
          key: header.slice(0, colonIndex).trim(),
          value: header.slice(colonIndex + 1).trim(),
          enabled: true,
        });
      }
    } else if (['-d', '--data', '--data-raw', '--data-binary'].includes(option)) {
      dataEntries.push({ value: take(), option });
    } else if (option === '--data-urlencode') {
      dataUrlencode.push(take());
    } else if (option === '-F' || option === '--form' || option === '--form-string') {
      formEntries.push({ value: take(), forceText: option === '--form-string' });
    } else if (option === '-u' || option === '--user') {
      authUser = take();
    } else if (option === '-e' || option === '--referer') {
      headers.push({ key: 'Referer', value: take(), enabled: true });
    } else if (option === '-A' || option === '--user-agent') {
      headers.push({ key: 'User-Agent', value: take(), enabled: true });
    } else if (option === '--url') {
      explicitUrl = take();
    } else if (option === '-c' || option === '--cookie-jar') {
      take();
      warnings.push({ option, message: 'Cookie jar files are not supported.' });
    } else if (option === '-b' || option === '--cookie') {
      const cookie = take();
      if (cookie.includes('=')) {
        headers.push({ key: 'Cookie', value: cookie, enabled: true });
      } else {
        warnings.push({ option, message: 'Cookie files and cookie-engine-only options are not supported.' });
      }
    } else if (option === '-L' || option === '--location') {
      hasLocation = true;
    } else if (option === '--no-location') {
      hasLocation = false;
    } else if (option === '--no-location-trusted') {
      hasLocationTrusted = false;
    } else if (option === '--location-trusted') {
      hasLocationTrusted = true;
    } else if (option === '--max-redirs') {
      const value = Number.parseInt(take(), 10);
      if (Number.isFinite(value) && value >= 0) {
        maxRedirectCount = Math.min(value, 50);
        if (value > 50) {
          warnings.push({ option, message: 'ApiKit supports at most 50 redirects; the value was limited to 50.' });
        }
      } else if (value < 0) {
        warnings.push({ option, message: 'Unlimited redirects are not supported; the limit was set to 50.' });
        maxRedirectCount = 50;
      }
    } else if (option === '-k' || option === '--insecure') {
      hasInsecure = true;
    } else if (option === '--no-insecure') {
      hasInsecure = false;
    } else if (option === '--compressed') {
      hasCompressed = true;
    } else if (option === '--no-compressed') {
      hasCompressed = false;
    } else if (['--globoff', '--http1.0', '--http1.1', '--http2', '--http2-prior-knowledge', '-s', '--silent', '-v', '--verbose'].includes(option)) {
      // Known behavior-only flags do not own the next positional argument.
    } else if (unsupportedOptionsWithValue.has(option)) {
      take();
      warnings.push({ option, message: `${option} is not represented by ApiKit request settings.` });
    } else if (option.startsWith('-')) {
      warnings.push({ option, message: `Unsupported cURL option ${option} was ignored.` });
    } else {
      positional.push(token);
    }
  }

  const url = explicitUrl
    || positional.find(looksLikeUrl)
    || positional[0]
    || '';
  if (!url) warnings.push({ message: 'No request URL was found in the cURL command.' });

  let body: RequestBody = {
    type: 'none',
    raw: '',
    formData: [],
    urlencoded: [],
  };
  const contentType = headers.find(header => header.key.toLowerCase() === 'content-type')?.value || '';

  if (dataUrlencode.length > 0) {
    body.type = 'x-www-form-urlencoded';
    body.urlencoded = dataUrlencode.map(entry => {
      const equalsIndex = entry.indexOf('=');
      return {
        key: equalsIndex === -1 ? entry : entry.slice(0, equalsIndex),
        value: equalsIndex === -1 ? '' : entry.slice(equalsIndex + 1),
        enabled: true,
      };
    });
  } else if (dataEntries.length > 0) {
    const binaryFile = dataEntries.length === 1
      && dataEntries[0].option === '--data-binary'
      && dataEntries[0].value.startsWith('@');

    if (binaryFile) {
      const filePath = stripWrappingDoubleQuotes(dataEntries[0].value.slice(1));
      body.type = 'binary';
      body.filePath = filePath;
    } else {
      const raw = dataEntries.map(entry => entry.value).join('&');
      const isXml = /(?:^|[+/])xml(?:$|[;\s])/i.test(contentType)
        || /^\s*(?:<\?xml\b|<[A-Za-z_][\w:.-]*(?:\s|\/?>))/i.test(raw);
      const isExplicitForm = /application\/x-www-form-urlencoded/i.test(contentType);

      if (isXml) {
        body.type = 'xml';
        body.raw = raw;
      } else if (isExplicitForm) {
        body.type = 'x-www-form-urlencoded';
        body.urlencoded = parseUrlencodedBody(raw);
      } else {
        try {
          JSON.parse(raw);
          body.type = 'json';
        } catch {
          if (!contentType && raw.includes('=')) {
            body.type = 'x-www-form-urlencoded';
            body.urlencoded = parseUrlencodedBody(raw);
          } else {
            body.type = /(?:^|[+/])json(?:$|[;\s])/i.test(contentType) ? 'json' : 'text';
          }
        }
        if (body.type !== 'x-www-form-urlencoded') body.raw = raw;
      }
    }
  } else if (formEntries.length > 0) {
    body.type = 'form-data';
    body.formData = formEntries.map(({ value: entry, forceText }) => {
      const equalsIndex = entry.indexOf('=');
      const key = equalsIndex === -1 ? entry : entry.slice(0, equalsIndex);
      const rawValue = equalsIndex === -1 ? '' : entry.slice(equalsIndex + 1);

      if (!forceText && rawValue.startsWith('@')) {
        const filePath = stripWrappingDoubleQuotes(splitFormModifiers(rawValue.slice(1)));
        return { key, value: fileNameFromPath(filePath), filePath, type: 'file', enabled: true };
      }
      if (!forceText && rawValue.startsWith('<')) {
        warnings.push({ option: '--form', message: `Form field ${key} reads content from a file, which is not supported.` });
      }
      return { key, value: stripWrappingDoubleQuotes(rawValue), type: 'text', enabled: true };
    });
  }

  if (!method) method = body.type === 'none' ? 'GET' : 'POST';

  if (hasLocationTrusted) {
    warnings.push({
      option: '--location-trusted',
      message: 'Redirects are enabled, but forwarding credentials to other hosts is not supported.',
    });
  }

  const followsRedirects = hasLocation || hasLocationTrusted;
  const hasAcceptEncodingHeader = headers.some(header => header.key.toLowerCase() === 'accept-encoding');
  const settings: Required<RequestSettings> = {
    followRedirects: followsRedirects && maxRedirectCount !== 0,
    maxRedirectCount: maxRedirectCount && maxRedirectCount <= 50
      ? maxRedirectCount
      : (followsRedirects ? 50 : 10),
    verifySsl: !hasInsecure,
    autoEncodeUrl: true,
    acceptEncoding: hasCompressed || hasAcceptEncodingHeader,
  };

  const auth = { type: 'none' as string, token: '', username: '', password: '' };
  if (authUser) {
    const colonIndex = authUser.indexOf(':');
    auth.type = 'basic';
    auth.username = colonIndex === -1 ? authUser : authUser.slice(0, colonIndex);
    auth.password = colonIndex === -1 ? '' : authUser.slice(colonIndex + 1);
  }

  const authHeaderIndex = headers.findIndex(header => header.key.toLowerCase() === 'authorization');
  if (authHeaderIndex >= 0) {
    const authValue = headers[authHeaderIndex].value;
    if (authValue.toLowerCase().startsWith('bearer ')) {
      auth.type = 'bearer';
      auth.token = authValue.slice(7);
      headers.splice(authHeaderIndex, 1);
    } else if (authValue.toLowerCase().startsWith('basic ')) {
      try {
        const decoded = atob(authValue.slice(6));
        const colonIndex = decoded.indexOf(':');
        auth.type = 'basic';
        auth.username = colonIndex === -1 ? decoded : decoded.slice(0, colonIndex);
        auth.password = colonIndex === -1 ? '' : decoded.slice(colonIndex + 1);
      } catch { /* Keep an invalid Basic header as a regular header. */ }
      if (auth.type === 'basic') headers.splice(authHeaderIndex, 1);
    }
  }

  headers.push({ key: '', value: '', enabled: true });
  body.formData.push({ key: '', value: '', type: 'text', enabled: true });
  body.urlencoded.push({ key: '', value: '', enabled: true });

  return { method, url, headers, body, auth, settings, warnings };
}
