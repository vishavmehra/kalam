import { DRAWING_FILE_MAX_CHARS } from './model';

/** Web: lets the person choose a .kalamdraw file and returns its text, or undefined if they cancel. */
export function pickDrawingFile(): Promise<string | undefined> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.kalamdraw,application/json';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return resolve(undefined);
      // Refuse before reading: a huge file would be read into memory only to be turned down.
      if (file.size > DRAWING_FILE_MAX_CHARS) return reject(new RangeError('too_large'));
      file.text().then(resolve, reject);
    };
    input.addEventListener('cancel', () => resolve(undefined));
    input.click();
  });
}
