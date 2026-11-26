/**
 * What the in-place text box does when it loses focus (TextEditOverlay). Pure, so it can be tested without a
 * screen. Three things take focus away from the box without meaning "done typing":
 *  - the microphone button was just pressed (`holdFocus`), so the box takes focus back;
 *  - the "use online speech?" sheet is open (`asking`), so the edit stays open and waits for the answer;
 *  - anything else is the person leaving the box, which ends the edit.
 */
export type BlurAction = 'commit' | 'refocus' | 'wait';

export function blurAction(state: { holdFocus: boolean; asking: boolean }): BlurAction {
  if (state.asking) return 'wait';
  return state.holdFocus ? 'refocus' : 'commit';
}
