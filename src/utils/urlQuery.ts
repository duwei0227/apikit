import type { KeyValue } from '@/types/models';

export interface ParsedRequestUrl {
  baseUrl: string;
  params: KeyValue[];
  fragment: string;
  hasQuery: boolean;
}

export interface SerializeRequestUrlOptions {
  autoEncode?: boolean;
  fragment?: string;
}

export interface BuildRequestUrlOptions extends SerializeRequestUrlOptions {
  transform?: (value: string) => string;
  normalizeBaseUrl?: (value: string) => string;
}

const VARIABLE_PATTERN = /\{\{[^{}]+\}\}/g;
const VALID_PERCENT_ESCAPE = /^[0-9A-Fa-f]{2}$/;

const toWellFormedUnicode = (value: string): string => {
  let result = '';

  for (let index = 0; index < value.length; index++) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const nextCodeUnit = value.charCodeAt(index + 1);
      if (nextCodeUnit >= 0xdc00 && nextCodeUnit <= 0xdfff) {
        result += value[index] + value[index + 1];
        index++;
      } else {
        result += '\ufffd';
      }
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      result += '\ufffd';
    } else {
      result += value[index];
    }
  }

  return result;
};

const encodeUtf8 = (value: string): string => encodeURIComponent(toWellFormedUnicode(value))
  .replace(/[!'()*]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);

const shouldAutoEncodeQueryCharacter = (character: string): boolean => {
  const codePoint = character.codePointAt(0) || 0;
  return codePoint <= 0x20
    || codePoint >= 0x7f
    || character === '"'
    || character === "'"
    || character === '<'
    || character === '>'
    || character === '{'
    || character === '}'
    || character === '=';
};

const encodeQueryText = (value: string, encodeEquals: boolean, autoEncode: boolean): string => {
  let result = '';
  const safeValue = toWellFormedUnicode(value);

  for (let index = 0; index < safeValue.length;) {
    if (safeValue[index] === '%' && VALID_PERCENT_ESCAPE.test(safeValue.slice(index + 1, index + 3))) {
      result += safeValue.slice(index, index + 3);
      index += 3;
      continue;
    }

    const character = String.fromCodePoint(safeValue.codePointAt(index) || 0);
    index += character.length;

    if (character === '&' || character === '#' || (encodeEquals && character === '=')) {
      result += encodeUtf8(character);
    } else if (autoEncode && shouldAutoEncodeQueryCharacter(character)) {
      result += encodeUtf8(character);
    } else if (autoEncode && character === '%') {
      result += '%25';
    } else {
      result += character;
    }
  }

  return result;
};

const transformOutsideVariables = (
  value: string,
  transform: (text: string) => string,
): string => {
  let result = '';
  let pointer = 0;

  for (const match of value.matchAll(VARIABLE_PATTERN)) {
    const index = match.index || 0;
    result += transform(value.slice(pointer, index));
    result += match[0];
    pointer = index + match[0].length;
  }

  return result + transform(value.slice(pointer));
};

export const normalizeQueryKey = (value: string, autoEncode = false): string =>
  transformOutsideVariables(String(value ?? ''), text => encodeQueryText(text, true, autoEncode));

export const normalizeQueryValue = (value: string, autoEncode = false): string =>
  transformOutsideVariables(String(value ?? ''), text => encodeQueryText(text, false, autoEncode));

export const parseQueryString = (query: string): KeyValue[] => {
  if (!query) return [];

  return query
    .split('&')
    .filter(pair => pair !== '')
    .map(pair => {
      const separatorIndex = pair.indexOf('=');
      return {
        key: separatorIndex < 0 ? pair : pair.slice(0, separatorIndex),
        value: separatorIndex < 0 ? '' : pair.slice(separatorIndex + 1),
        enabled: true,
        hasEquals: separatorIndex >= 0,
      };
    });
};

export const parseRequestUrl = (url: string): ParsedRequestUrl => {
  const rawUrl = String(url || '');
  const fragmentIndex = rawUrl.indexOf('#');
  const fragment = fragmentIndex >= 0 ? rawUrl.slice(fragmentIndex + 1) : '';
  const withoutFragment = fragmentIndex >= 0 ? rawUrl.slice(0, fragmentIndex) : rawUrl;
  const queryIndex = withoutFragment.indexOf('?');

  if (queryIndex < 0) {
    return { baseUrl: withoutFragment, params: [], fragment, hasQuery: false };
  }

  return {
    baseUrl: withoutFragment.slice(0, queryIndex),
    params: parseQueryString(withoutFragment.slice(queryIndex + 1)),
    fragment,
    hasQuery: true,
  };
};

export const serializeQuery = (params: KeyValue[], autoEncode = false): string =>
  (params || [])
    .filter(param => param.enabled !== false && (param.key !== '' || param.value !== ''))
    .map(param => {
      const key = normalizeQueryKey(param.key, autoEncode);
      if (param.hasEquals === false && param.value === '') return key;
      return `${key}=${normalizeQueryValue(param.value, autoEncode)}`;
    })
    .join('&');

const encodeUrlPreservingEscapes = (url: string): string => {
  return transformOutsideVariables(toWellFormedUnicode(url), text => {
    let result = '';
    let pointer = 0;
    const percentEscapePattern = /%[0-9A-Fa-f]{2}/g;

    for (const match of text.matchAll(percentEscapePattern)) {
      const index = match.index || 0;
      result += encodeURI(text.slice(pointer, index));
      result += match[0];
      pointer = index + match[0].length;
    }

    return result + encodeURI(text.slice(pointer));
  });
};

export const serializeRequestUrl = (
  baseUrl: string,
  params: KeyValue[],
  options: SerializeRequestUrlOptions = {},
): string => {
  const autoEncode = options.autoEncode === true;
  // A variable used as the base URL can resolve to a URL that already contains
  // query parameters. Parse it after variable resolution and prepend those
  // parameters instead of producing a second `?`.
  const parsedBaseUrl = parseRequestUrl(baseUrl);
  const encodedBaseUrl = autoEncode
    ? encodeUrlPreservingEscapes(parsedBaseUrl.baseUrl)
    : parsedBaseUrl.baseUrl;
  const query = serializeQuery([...parsedBaseUrl.params, ...(params || [])], autoEncode);
  const fragment = options.fragment ?? parsedBaseUrl.fragment;
  const encodedFragment = autoEncode ? encodeUrlPreservingEscapes(fragment) : fragment;

  return `${encodedBaseUrl}${query ? `?${query}` : ''}${fragment ? `#${encodedFragment}` : ''}`;
};

export const buildRequestUrl = (
  url: string,
  params: KeyValue[],
  options: BuildRequestUrlOptions = {},
): string => {
  const parsedUrl = parseRequestUrl(url);
  const transform = options.transform || ((value: string) => value);
  const normalizeBaseUrl = options.normalizeBaseUrl || ((value: string) => value);
  const hasStructuredParams = (params || []).some(param => param.key !== '' || param.value !== '');
  const sourceParams = hasStructuredParams ? params : parsedUrl.params;
  const resolvedParams = sourceParams
    .filter(param => param.enabled !== false && param.key)
    .map(param => ({
      ...param,
      key: transform(param.key),
      value: transform(param.value),
    }));

  return serializeRequestUrl(
    normalizeBaseUrl(transform(parsedUrl.baseUrl)),
    resolvedParams,
    {
      autoEncode: options.autoEncode,
      fragment: parsedUrl.fragment ? transform(parsedUrl.fragment) : undefined,
    },
  );
};
