import type { ComposeEntry, HttpMethod } from '@/types/traffic';

export interface ParsedCurl {
  method: HttpMethod;
  url: string;
  headers: [string, string][];
  body: string | null;
}

const flagsWithValue = new Set([
  '-X', '--request',
  '-H', '--header',
  '-d', '--data', '--data-raw', '--data-binary',
  '--url',
  '-F', '--form', '--form-string',
  '-u', '--user',
  '-A', '--user-agent',
  '-b', '--cookie',
  '-c', '--cookie-jar',
  '-e', '--referer',
  '-o', '--output',
  '-w', '--write-out',
  '-m', '--max-time',
  '--connect-timeout',
  '-x', '--proxy',
]);

const booleanFlags = new Set([
  '-v', '--verbose',
  '-s', '--silent',
  '-L', '--location',
  '-k', '--insecure',
  '-i', '--include',
  '-I', '--head',
  '--compressed',
  '--progress-bar',
  '-n', '--netrc',
  '-f', '--fail',
  '--globoff',
  '--http1.0',
  '--http1.1',
  '--http2',
  '--http3',
]);

export function parseCurl(input: string): ParsedCurl | null {
  const trimmed = input.trim();

  if (!trimmed.startsWith('curl ')) return null;

  const joined = trimmed
    .replace(/\\\n/g, ' ')
    .replace(/\\\r\n/g, ' ');

  const tokens = tokenize(joined);

  if (tokens.length < 2) return null;

  const method = extractMethod(tokens);
  const headers = extractHeaders(tokens);
  const body = extractBody(tokens);
  const url = extractUrl(tokens);

  if (!url) return null;

  return { method, url, headers, body };
}

function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let i = 0;

  while (i < input.length) {
    if (input[i] === ' ' || input[i] === '\t' || input[i] === '\n' || input[i] === '\r') {
      i++;
      continue;
    }

    if (input[i] === "'") {
      let j = i + 1;
      while (j < input.length && input[j] !== "'") {
        if (input[j] === '\\') j++;
        j++;
      }
      tokens.push(input.substring(i + 1, j));
      i = j + 1;
      continue;
    }

    if (input[i] === '"') {
      let j = i + 1;
      while (j < input.length && input[j] !== '"') {
        if (input[j] === '\\') j++;
        j++;
      }
      tokens.push(input.substring(i + 1, j));
      i = j + 1;
      continue;
    }

    let j = i;
    while (j < input.length && input[j] !== ' ' && input[j] !== '\t' && input[j] !== '\n' && input[j] !== '\r') {
      j++;
    }
    tokens.push(input.substring(i, j));
    i = j;
  }

  return tokens;
}

function isFlag(token: string): boolean {
  return flagsWithValue.has(token) || booleanFlags.has(token);
}

function consumesNextToken(token: string): boolean {
  return flagsWithValue.has(token);
}

function extractMethod(tokens: string[]): HttpMethod {
  for (let i = 0; i < tokens.length; i++) {
    if ((tokens[i] === '-X' || tokens[i] === '--request') && i + 1 < tokens.length) {
      const method = tokens[i + 1].toUpperCase();
      if (isHttpMethod(method)) return method as HttpMethod;
    }
  }

  const hasData = tokens.some(
    (t) => t === '-d' || t === '--data' || t === '--data-raw' || t === '--data-binary' || t === '-F' || t === '--form'
  );

  return hasData ? 'POST' : 'GET';
}

function extractHeaders(tokens: string[]): [string, string][] {
  const headers: [string, string][] = [];
  let hasFormData = false;

  for (let i = 0; i < tokens.length; i++) {
    if ((tokens[i] === '-H' || tokens[i] === '--header') && i + 1 < tokens.length) {
      const headerStr = tokens[i + 1];
      const colonIdx = headerStr.indexOf(':');
      if (colonIdx > 0) {
        const name = headerStr.substring(0, colonIdx).trim();
        const value = headerStr.substring(colonIdx + 1).trim();
        if (name) headers.push([name, value]);
      }
    }
    if (tokens[i] === '-F' || tokens[i] === '--form') {
      hasFormData = true;
    }
  }

  if (hasFormData && !headers.some(([k]) => k.toLowerCase() === 'content-type')) {
    headers.push(['Content-Type', 'multipart/form-data']);
  }

  return headers;
}

function extractBody(tokens: string[]): string | null {
  for (let i = 0; i < tokens.length; i++) {
    if (
      (tokens[i] === '-d' ||
        tokens[i] === '--data' ||
        tokens[i] === '--data-raw' ||
        tokens[i] === '--data-binary') &&
      i + 1 < tokens.length
    ) {
      return tokens[i + 1];
    }
  }

  const formFields: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    if ((tokens[i] === '-F' || tokens[i] === '--form' || tokens[i] === '--form-string') && i + 1 < tokens.length) {
      const value = tokens[i + 1];
      const semicolonIdx = value.indexOf(';');
      const fieldPart = semicolonIdx > 0 ? value.substring(0, semicolonIdx) : value;
      formFields.push(fieldPart);
    }
  }

  if (formFields.length > 0) {
    return formFields.map((f) => {
      const eqIdx = f.indexOf('=');
      if (eqIdx > 0) {
        const key = f.substring(0, eqIdx);
        const val = f.substring(eqIdx + 1);
        if (val.startsWith('@')) {
          return `# ${key}=${val} (file upload)`;
        }
        return `${key}=${val}`;
      }
      return f;
    }).join('\n');
  }

  return null;
}

function extractUrl(tokens: string[]): string | null {
  for (let i = 1; i < tokens.length; i++) {
    if (tokens[i] === '--url' && i + 1 < tokens.length) {
      return tokens[i + 1];
    }
  }

  for (let i = 1; i < tokens.length; i++) {
    if (tokens[i].match(/^https?:\/\//i)) {
      return tokens[i];
    }
  }

  for (let i = 1; i < tokens.length; i++) {
    if (isFlag(tokens[i])) {
      if (consumesNextToken(tokens[i])) {
        i++;
      }
      continue;
    }
    if (tokens[i].startsWith('-')) continue;
    return tokens[i];
  }

  return null;
}

function isHttpMethod(s: string): boolean {
  return ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'].includes(s);
}

export function buildCurlFromCompose(entry: ComposeEntry): string {
  const parts: string[] = ['curl'];
  if (entry.method !== 'GET') {
    parts.push(`-X ${entry.method}`);
  }
  parts.push(`'${entry.url}'`);
  for (const [key, value] of entry.headers) {
    parts.push(`-H '${key}: ${value}'`);
  }
  if (entry.body) {
    parts.push(`-d '${entry.body.replace(/'/g, "\\'")}'`);
  }
  return parts.join(' \\\n  ');
}
