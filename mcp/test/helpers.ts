import { readFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

const FIXTURES = new URL('../../tests/fixtures/', import.meta.url);

export const fixture = (name: string): Record<string, unknown> =>
  JSON.parse(readFileSync(new URL(`specs/valid/${name}.json`, FIXTURES), 'utf8')) as Record<string, unknown>;
export const invalidFixture = (name: string): Record<string, unknown> =>
  JSON.parse(readFileSync(new URL(`specs/invalid/${name}.json`, FIXTURES), 'utf8')) as Record<string, unknown>;
export const tailorIR = (): unknown => JSON.parse(readFileSync(new URL('compiler/tailor-shop.ir.json', FIXTURES), 'utf8'));

/** The structured result of a tool call. */
// Tests read tool results loosely; the tools' own types are checked in src.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = Record<string, any>;
export const data = (r: unknown): Loose => ((r as { structuredContent?: unknown }).structuredContent ?? {}) as Loose;
export const text = (r: unknown): string =>
  ((r as CallToolResult).content ?? []).map((c) => (c.type === 'text' ? c.text : '')).join('\n');
/** Text of the first item of a resources/read result. */
export const resourceText = (r: { contents: ReadonlyArray<object> }): string => {
  const c = r.contents[0];
  return c && 'text' in c ? String(c.text) : '';
};

/** The SDK's documented in-process pair: one transport for the client, one for the server. */
export async function connect(server: McpServer): Promise<Client> {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'kalam-test', version: '1.0.0' });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  return client;
}

/** Copy rule: no em dash (U+2014) and no exclamation mark in generated text. */
export const NO_DASH_OR_BANG = new RegExp(`${String.fromCharCode(0x2014)}|!`);
