/** Device binding for share-logic.ts: the system share sheet and the clipboard. Both work on web, Android and iOS. */
import * as Clipboard from 'expo-clipboard';
import { Share } from 'react-native';

import { copyOnly, shareOrCopy, type ShareDeps } from './share-logic';

function depsFor(title: string): ShareDeps {
  return {
    async share(text) {
      try {
        const result = await Share.share({ message: text, title }, { dialogTitle: title });
        // Browsers resolve with nothing once the share is done (react-native-web returns navigator.share()).
        // Android always reports "shared", so a closed sheet cannot be told apart there; iOS reports both.
        if (!result) return 'shared';
        return result.action === Share.dismissedAction ? 'dismissed' : 'shared';
      } catch (error) {
        // Browsers reject with AbortError when the person closes the share sheet.
        if ((error as { name?: string } | undefined)?.name === 'AbortError') return 'dismissed';
        // Anything else (NotAllowedError, "Share is not supported in this browser") means no share sheet.
        throw error;
      }
    },
    async copy(text) {
      if (!(await Clipboard.setStringAsync(text))) throw new Error('The text could not be copied.');
    },
  };
}

/** Opens the share sheet, or copies the text when there is none. `title` names the shared item. */
export const shareText = (text: string, title: string) => shareOrCopy(text, depsFor(title));
export const copyText = (text: string) => copyOnly(text, depsFor(''));
