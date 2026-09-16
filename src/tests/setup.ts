import { config as loadDotenv } from 'dotenv';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Load isolated test environment before any test module initializes
const testEnvPath = resolve(__dirname, '../../.env.test');
if (existsSync(testEnvPath)) {
  loadDotenv({ path: testEnvPath, override: true });
}

// In-memory Storage polyfill for tests running in Node environment
function createMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => (store.has(String(key)) ? store.get(String(key))! : null),
    setItem: (key: string, value: string) => {
      store.set(String(key), String(value));
    },
    removeItem: (key: string) => {
      store.delete(String(key));
    },
    clear: () => {
      store.clear();
    },
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    },
  };
}

if (typeof globalThis.localStorage === 'undefined') {
  globalThis.localStorage = createMemoryStorage();
}

if (typeof globalThis.sessionStorage === 'undefined') {
  globalThis.sessionStorage = createMemoryStorage();
}
