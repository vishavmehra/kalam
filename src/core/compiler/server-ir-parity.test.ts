import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { IR_JSON_SCHEMA } from '../../../functions/src/ir';
import { compilerIRSchema } from './ir';

describe('server IR copy (functions/src/ir.ts)', () => {
  it('matches the client compiler IR exactly, so the callable pins the same shape (SECURITY_REVIEW R-01)', () => {
    expect(IR_JSON_SCHEMA).toEqual(z.toJSONSchema(compilerIRSchema, { io: 'input' }));
  });
});
