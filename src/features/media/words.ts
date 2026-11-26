/**
 * Gives the core's media copy (src/core/media/copy.ts) the interface language. The core speaks English until
 * this runs; importing it once, from the media store, is enough for every message, label and question the
 * media inputs show.
 */
import { setMediaWords } from '@/core/media/copy';
import { td } from '@/i18n/active';

setMediaWords((key, params) => td(key, params));
