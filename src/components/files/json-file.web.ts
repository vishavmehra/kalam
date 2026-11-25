/** Web JSON file I/O: Blob download and a hidden file input. Parsed content is untrusted. */
import { MAX_IMPORT_BYTES, TOO_LARGE_MESSAGE } from './limits';

export async function saveJsonFile(filename: string, data: unknown): Promise<boolean> {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}


export function pickJsonFile(): Promise<unknown | undefined> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return resolve(undefined);
      if (file.size > MAX_IMPORT_BYTES) return reject(new Error(TOO_LARGE_MESSAGE));
      file.text().then((t) => resolve(JSON.parse(t) as unknown), reject);
    };
    // Some browsers fire `cancel`; others never resolve — callers must not block on it.
    input.addEventListener('cancel', () => resolve(undefined));
    input.click();
  });
}

export function safeFilename(name: string, ext: string): string {
  const base = name.trim().replace(/[^\p{L}\p{N}\-_ ]+/gu, '').replace(/\s+/g, '-').slice(0, 60) || 'kalam';
  return `${base}.${ext}`;
}
