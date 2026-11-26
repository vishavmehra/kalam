/**
 * Streamable HTTP, only with --http. Bound to 127.0.0.1, never another interface. Stateless: a fresh
 * server and transport per POST, as the SDK documents for servers without sessions. The Host and
 * Origin checks stop DNS rebinding (a web page making the browser talk to this port). There is no
 * login, so any program on this computer can call it: config.ts refuses --http with --workspace or
 * --firebase.
 */
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

export const HOST = '127.0.0.1';
export const MAX_BODY_BYTES = 4 * 1024 * 1024;

class HttpError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, 'The request is larger than 4 MB.');
    chunks.push(chunk as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'The request body is not JSON.');
  }
}

export function startHttp(port: number, makeServer: () => McpServer): Promise<Server> {
  const hosts = new Set([`${HOST}:${port}`, `localhost:${port}`]);
  const origins = new Set([`http://${HOST}:${port}`, `http://localhost:${port}`]);

  const http = createServer(async (req, res) => {
    const reply = (status: number, message: string, headers: Record<string, string> = {}) => {
      if (res.headersSent) return;
      res.writeHead(status, { 'content-type': 'application/json', ...headers });
      res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message }, id: null }));
    };
    // Nothing in a request may throw out of this handler: an unhandled rejection would stop the process.
    try {
      if (!hosts.has(req.headers.host ?? '')) return reply(403, 'This host name is not allowed.');
      const origin = req.headers.origin;
      if (origin !== undefined && !origins.has(origin)) return reply(403, 'This origin is not allowed.');
      // A plain string compare: `new URL()` throws on targets such as `//`.
      if ((req.url ?? '').split('?')[0] !== '/mcp') return reply(404, 'Not found. The endpoint is /mcp.');
      if (req.method !== 'POST') return reply(405, 'This server has no sessions, so only POST is used.', { allow: 'POST' });

      let body: unknown;
      try {
        body = await readJson(req);
      } catch (e) {
        return reply(e instanceof HttpError ? e.status : 400, e instanceof Error ? e.message : 'Bad request.');
      }
      const server = makeServer();
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      res.on('close', () => {
        void transport.close().catch(() => {});
        void server.close().catch(() => {});
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch {
      reply(500, 'The server could not handle this request.');
    }
  });

  return new Promise((resolve, reject) => {
    http.once('error', reject);
    http.listen(port, HOST, () => resolve(http));
  });
}
