import { useState } from 'react';

/**
 * The latest value that was not null. A sheet that closes by being given null keeps showing what it had while it slides
 * away, instead of going blank for the length of the animation.
 */
export function useLast<T>(value: T | null): T | null {
  const [last, setLast] = useState<T | null>(value);
  if (value !== null && value !== last) setLast(value);
  return value ?? last;
}
