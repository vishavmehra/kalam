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
export const data = (r: CallToolResult | { structuredContent?: unknown }): Record<string, any> =>
  (r.structuredContent ?? {}) as Record<string, any>;
export const text = (r: CallToolResult): string =>
  r.content.map((c) => (c.type === 'text' ? c.text : '')).join('\n');

/** The SDK's documented in-process pair: one transport for the client, one for the server. */
export async function connect(server: McpServer): Promise<Client> {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'kalam-test', version: '1.0.0' });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  return client;
}
