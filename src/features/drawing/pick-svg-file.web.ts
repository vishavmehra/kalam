import { SVG_IMPORT_LIMITS } from './model';

const TOO_LARGE = 'That file is too large to open. The limit is about 1 MB.';

/** Web: lets the person choose an .svg file and returns its text, or undefined if they cancel. */
export function pickSvgFile(): Promise<string | undefined> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/svg+xml,.svg';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return resolve(undefined);
      if (file.size > SVG_IMPORT_LIMITS.maxChars) return reject(new Error(TOO_LARGE));
      file.text().then(resolve, reject);
    };
    input.addEventListener('cancel', () => resolve(undefined));
    input.click();
  });
}
