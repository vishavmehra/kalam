// jsdom ships no types and @types/jsdom is not installed. This is all the scoring-page test uses.
declare module 'jsdom' {
  export class JSDOM {
    constructor(
      html?: string,
      options?: { runScripts?: 'dangerously' | 'outside-only'; pretendToBeVisual?: boolean; url?: string },
    );
    readonly window: Window & typeof globalThis;
  }
}
