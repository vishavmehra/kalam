import { SVG_MAX_INPUT } from '@/core/bazaar';

/** Web: lets the person choose an .svg file and returns its text (sanitised later by the caller). */
export function pickSvgText(): Promise<string | undefined> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/svg+xml,.svg';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return resolve(undefined);
      if (file.size > SVG_MAX_INPUT) return reject(new Error('The icon file is too large.'));
      file.text().then(resolve, reject);
    };
    input.addEventListener('cancel', () => resolve(undefined));
    input.click();
  });
}
