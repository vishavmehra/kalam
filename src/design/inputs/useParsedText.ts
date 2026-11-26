import { useEffect, useRef, useState } from 'react';

import type { Parsed } from './logic';

interface Binding<T, E extends string> {
  value: T | null;
  parse: (text: string) => Parsed<T, E>;
  format: (value: T) => string;
  onChange: (value: T | null) => void;
}

/**
 * Keeps a text box and a typed value (number, date) in step. Typing reports the parsed value, or null while the
 * text is empty or not valid yet; leaving the box tidies the text to its canonical form and starts showing the
 * error. A value that did not come from this box's own typing (a stepper, a Today button, the parent) replaces
 * the text.
 */
export function useParsedText<T, E extends string>(b: Binding<T, E>) {
  const [text, setText] = useState(() => (b.value === null ? '' : b.format(b.value)));
  const [touched, setTouched] = useState(false);
  const latest = useRef(b);
  latest.current = b;
  const emitted = useRef<T | null>(b.value);

  useEffect(() => {
    if (b.value === emitted.current) return;
    emitted.current = b.value;
    setText(b.value === null ? '' : latest.current.format(b.value));
  }, [b.value]);

  const emit = (v: T | null) => {
    emitted.current = v;
    b.onChange(v);
  };
  const parsed = b.parse(text);

  return {
    text,
    /** The error reason once the box has been left, else null. */
    error: touched && parsed.kind === 'error' ? parsed.reason : null,
    onChangeText(next: string) {
      setText(next);
      const p = b.parse(next);
      emit(p.kind === 'ok' ? p.value : null);
    },
    onBlur() {
      setTouched(true);
      if (parsed.kind === 'ok') {
        const canonical = b.format(parsed.value);
        if (canonical !== text) setText(canonical);
      }
    },
    /** Sets text and value together (stepper, Today). */
    set(v: T) {
      setText(b.format(v));
      setTouched(true);
      emit(v);
    },
  };
}
