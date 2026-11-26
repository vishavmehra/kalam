import { describe, expect, it } from 'vitest';
import { blurAction } from './text-edit-focus';

describe('what the text box does when it loses focus', () => {
  it('ends the edit when the person simply leaves the box', () => {
    expect(blurAction({ holdFocus: false, asking: false })).toBe('commit');
  });

  it('takes focus back when the microphone button was just pressed', () => {
    expect(blurAction({ holdFocus: true, asking: false })).toBe('refocus');
  });

  it('keeps the edit open while the online speech question is showing, whatever else is true', () => {
    // The question is a sheet, and a sheet takes focus from the box. Ending the edit there would remove the box
    // and leave the microphone press waiting for an answer nobody can give.
    expect(blurAction({ holdFocus: false, asking: true })).toBe('wait');
    expect(blurAction({ holdFocus: true, asking: true })).toBe('wait');
  });
});
