import type { Server } from 'node:http';
import { connect } from 'node:net';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startHttp } from '../src/http';
import { createKalamServer } from '../src/server';
import { data } from './helpers';

const port = 39_000 + Math.floor(Math.random() * 900);
let http: Server;

beforeAll(async () => {
  http = await startHttp(port, () => createKalamServer());
});
afterAll(() => new Promise<void>((resolve) => http.close(() => resolve())));

describe('Streamable HTTP', () => {
  it('listens on 127.0.0.1 only', () => {
    const addr = http.address();
    expect(typeof addr === 'object' && addr?.address).toBe('127.0.0.1');
  });

  it('serves MCP to a client', async () => {
    const client = new Client({ name: 'kalam-test', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)));
    const r = await client.callTool({ name: 'kalam_check_formula', arguments: { formula: '1 + 2', sample: {} } });
    expect(data(r).result).toEqual({ value: 3 });
    await client.close();
  });

  it('blocks other hosts and origins, other paths and methods, and huge bodies', async () => {
    const url = `http://127.0.0.1:${port}`;
    const post = (path: string, headers: Record<string, string> = {}, body = '{}') =>
      fetch(url + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body });
    expect((await post('/mcp', { origin: 'https://evil.example.com' })).status).toBe(403);
    expect((await post('/other')).status).toBe(404);
    expect((await fetch(`${url}/mcp`)).status).toBe(405);
    expect((await post('/mcp', {}, 'x'.repeat(5 * 1024 * 1024))).status).toBe(413);
    expect((await post('/mcp', {}, 'not json')).status).toBe(400);
    // A DNS-rebinding page arrives with its own host name.
    const rebinding = await new Promise<number>((resolve, reject) => {
      import('node:http').then(({ request }) => {
        const req = request({ host: '127.0.0.1', port, path: '/mcp', method: 'POST', headers: { host: `evil.example.com:${port}` } }, (res) => resolve(res.statusCode ?? 0));
        req.on('error', reject);
        req.end('{}');
      }, reject);
    });
    expect(rebinding).toBe(403);
  });

  it('survives request targets that are not URLs, sent with no Origin', async () => {
    // `new URL('//', base)` throws. A local program, or a page with <img src="http://127.0.0.1:port//">, can send it.
    const raw = (target: string) => new Promise<string>((resolve, reject) => {
      let out = '';
      const s = connect(port, '127.0.0.1', () => s.write(`GET ${target} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: close\r\n\r\n`));
      s.on('data', (d) => (out += String(d)));
      s.on('end', () => resolve(out));
      s.on('error', reject);
    });
    for (const target of ['//', '/\\', '//mcp', '/mcp/..', '*']) {
      expect(await raw(target), target).toMatch(/^HTTP\/1\.1 4\d\d /);
    }
    // Still up and answering. (A raw socket: fetch could reuse a keep-alive socket the server already closed.)
    expect(await raw('/mcp')).toMatch(/^HTTP\/1\.1 405 /);
  }, 20_000);
});

const dist = fileURLToPath(new URL('../dist/server.js', import.meta.url));

// test/global-setup.ts builds the bundle first, so this never skips and never tests a stale file.
describe('stdio, built bundle', () => {
  it('keeps stdout for the protocol and answers a client', async () => {
    const client = new Client({ name: 'kalam-test', version: '1.0.0' });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [dist], stderr: 'ignore' }));
    const tools = (await client.listTools()).tools.map((t) => t.name);
    expect(tools).toContain('kalam_validate_spec');
    expect(tools).not.toContain('kalam_workspace_write');
    await client.close();
  }, 20_000);
});
