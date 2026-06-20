import type { ComposeEntry, HttpMethod } from '@/types/traffic';

export interface ParsedCurl {
  method: HttpMethod;
  url: string;
  headers: [string, string][];
  body: string | null;
}

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

function extractMethod(tokens: string[]): HttpMethod {
  for (let i = 0; i < tokens.length; i++) {
    if ((tokens[i] === '-X' || tokens[i] === '--request') && i + 1 < tokens.length) {
      const method = tokens[i + 1].toUpperCase();
      if (isHttpMethod(method)) return method as HttpMethod;
    }
  }

  const hasData = tokens.some(
    (t) => t === '-d' || t === '--data' || t === '--data-raw' || t === '--data-binary'
  );

  return hasData ? 'POST' : 'GET';
}

function extractHeaders(tokens: string[]): [string, string][] {
  const headers: [string, string][] = [];

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
  return null;
}

function extractUrl(tokens: string[]): string | null {
  const flagSet = new Set([
    '-X', '--request', '-H', '--header', '-d', '--data',
    '--data-raw', '--data-binary', '-v', '--verbose', '-s',
    '--silent', '-L', '--location', '-o', '--output',
    '-u', '--user', '-A', '--user-agent', '-b', '--cookie',
    '-c', '--cookie-jar', '-e', '--referer', '-k', '--insecure',
    '-i', '--include', '-I', '--head', '-w', '--write-out',
    '--compressed', '-m', '--max-time', '--connect-timeout',
    '-x', '--proxy', '-n', '--netrc', '--url',
  ]);

  for (let i = 1; i < tokens.length; i++) {
    if (flagSet.has(tokens[i])) {
      i++;
      continue;
    }
    if (tokens[i].match(/^https?:\/\//i)) {
      return tokens[i];
    }
  }

  for (let i = 1; i < tokens.length; i++) {
    if (flagSet.has(tokens[i])) {
      i++;
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
