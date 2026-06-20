import type { ComposeEntry } from '@/types/traffic';

let composes: ComposeEntry[] = [
  {
    id: 'c1',
    name: 'Get Users',
    method: 'GET',
    url: 'https://jsonplaceholder.typicode.com/users',
    headers: [['Accept', 'application/json']],
    body: null,
    timestamp: Date.now() - 3600000,
  },
  {
    id: 'c2',
    name: 'Create Post',
    method: 'POST',
    url: 'https://jsonplaceholder.typicode.com/posts',
    headers: [
      ['Content-Type', 'application/json'],
      ['Accept', 'application/json'],
    ],
    body: JSON.stringify({ title: 'foo', body: 'bar', userId: 1 }, null, 2),
    timestamp: Date.now() - 1800000,
  },
  {
    id: 'c3',
    name: 'GitHub API',
    method: 'GET',
    url: 'https://api.github.com/repos/expo/expo',
    headers: [
      ['Accept', 'application/vnd.github+json'],
      ['User-Agent', 'NetworkSpy'],
    ],
    body: null,
    timestamp: Date.now() - 600000,
  },
];

export function getComposes(): ComposeEntry[] {
  return [...composes];
}

export function getComposeById(id: string): ComposeEntry | undefined {
  return composes.find((c) => c.id === id);
}

export function saveCompose(entry: ComposeEntry): void {
  const idx = composes.findIndex((c) => c.id === entry.id);
  if (idx !== -1) {
    composes[idx] = { ...entry, timestamp: Date.now() };
  } else {
    composes.unshift({ ...entry, timestamp: Date.now() });
  }
}

export function deleteCompose(id: string): void {
  composes = composes.filter((c) => c.id !== id);
}

let nextId = 10;
export function generateId(): string {
  return `c${nextId++}`;
}
