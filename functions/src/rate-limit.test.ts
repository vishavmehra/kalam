import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRateLimiter } from './rate-limit.js';

test('rate limiter: limits per key inside the window, then forgets', () => {
  const rl = createRateLimiter({ windowMs: 1_000, maxPerWindow: 2, maxKeys: 100 });
  assert.equal(rl.limited('a', 0), false);
  assert.equal(rl.limited('a', 10), false);
  assert.equal(rl.limited('a', 20), true);
  assert.equal(rl.limited('a', 2_000), false, 'window slid past the old calls');
});

test('rate limiter: a full table evicts the least recently seen keys, never a busy caller (R-02)', () => {
  const rl = createRateLimiter({ windowMs: 60_000, maxPerWindow: 3, maxKeys: 10 });
  for (let i = 0; i < 3; i += 1) rl.limited('busy', i);
  assert.equal(rl.limited('busy', 3), true);
  // An attacker rotates 50 keys; "busy" keeps calling, so it stays recent and keeps its history.
  for (let i = 0; i < 50; i += 1) {
    rl.limited(`rotating-${i}`, 10 + i);
    if (i % 5 === 0) assert.equal(rl.limited('busy', 10 + i), true);
  }
  assert.equal(rl.size(), 10);
});
