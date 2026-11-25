/** Largest JSON file Kalam will read (backups, shared apps). Bigger files are refused before reading. */
export const MAX_IMPORT_BYTES = 10 * 1024 * 1024;

export const TOO_LARGE_MESSAGE = 'That file is bigger than 10 MB, so it is not a Kalam backup this device can open.';
