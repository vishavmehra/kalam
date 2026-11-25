/** Typed backup errors with plain-language messages the UI can show as they are (docs/11 §12.7-12.8). */

export type BackupErrorCode =
  | 'not_a_backup'
  | 'unsupported_version'
  | 'wrong_passphrase_or_damaged'
  | 'damaged'
  | 'too_large'
  | 'weak_passphrase'
  | 'conflict'
  | 'random_unavailable';

const MESSAGES: Record<BackupErrorCode, string> = {
  not_a_backup: 'This file is not a Kalam backup.',
  unsupported_version: 'This backup was made by a newer version of Kalam. Update Kalam, then try again.',
  // AES-GCM cannot tell a wrong passphrase from a changed file, so the message names both.
  wrong_passphrase_or_damaged:
    'Kalam could not open this backup. Check the passphrase and try again. If the passphrase is right, the file may be damaged.',
  damaged: 'This backup is damaged. Nothing was restored.',
  too_large: 'This file is too large to be a Kalam backup.',
  weak_passphrase: 'Use a passphrase of at least 10 characters.',
  conflict: 'Some apps in this backup are already on this device. Choose to keep them or replace them.',
  random_unavailable: 'This device cannot make the secure random numbers a backup needs, so no backup was made.',
};

export class BackupError extends Error {
  constructor(readonly code: BackupErrorCode, message: string = MESSAGES[code]) {
    super(message);
    this.name = 'BackupError';
  }
}

export interface BackupConflict {
  id: string;
  /** Name of the app inside the backup. */
  name: string;
  /** Name of the app already on this device. */
  localName: string;
}

/** Restoring would replace local apps and the caller did not say whether that is wanted. */
export class BackupConflictError extends BackupError {
  constructor(readonly conflicts: BackupConflict[]) {
    const names = conflicts.slice(0, 5).map((c) => c.localName).join(', ');
    super('conflict', `${MESSAGES.conflict} Already here: ${names}${conflicts.length > 5 ? ' and more' : ''}.`);
    this.name = 'BackupConflictError';
  }
}

export function isBackupError(error: unknown): error is BackupError {
  return error instanceof BackupError;
}
