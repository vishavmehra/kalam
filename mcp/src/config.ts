import { parseArgs } from 'node:util';

export interface Options {
  /** Streamable HTTP on 127.0.0.1 instead of stdio. Off unless --http is given. */
  http: boolean;
  port: number;
  /** Folder for *.kalam.json files. No file access at all without it. */
  workspace?: string;
  /** Register kalam_compile_with_firebase (still needs the Firebase env variables). */
  firebase: boolean;
  /** Origin of a hosted Kalam web app, e.g. https://kalam.example.com. Adds a web link next to kalam://import. */
  appUrl?: string;
  /** Model calls this process may make. Each compile uses one, or two with a repair. */
  cloudCalls: number;
  help: boolean;
  version: boolean;
}

export const DEFAULT_PORT = 3917;
export const DEFAULT_CLOUD_CALLS = 5;
const MAX_CLOUD_CALLS = 50;

export const USAGE = `Usage: kalam-mcp [options]

Runs the Kalam MCP server. By default it talks over stdio and touches no files and no network.

  --http                Serve Streamable HTTP on http://127.0.0.1:<port>/mcp instead of stdio.
                        No login, so it cannot be combined with --workspace or --firebase
  --port <n>            Port for --http (default ${DEFAULT_PORT})
  --workspace <dir>     Allow reading and writing *.kalam.json files in this folder only
  --app-url <url>       Your hosted Kalam web app, for web "Open in Kalam" links
  --firebase            Allow kalam_compile_with_firebase (needs the Firebase variables, see README)
  --cloud-calls <n>     Most model calls this process may make with --firebase (default ${DEFAULT_CLOUD_CALLS}, at most ${MAX_CLOUD_CALLS})
  -h, --help            Show this help
  --version             Show the version
`;

function int(value: string | undefined, name: string, min: number, max: number, fallback: number): number {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${name} must be a whole number from ${min} to ${max}.`);
  return n;
}

/** https anywhere, or http on this computer. No path, query or fragment: the server adds /import#... */
function appUrl(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('--app-url must be a full URL such as https://kalam.example.com.'); }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) throw new Error('--app-url must use https.');
  if (url.username || url.password || url.search || url.hash) throw new Error('--app-url must not hold a login, a query or a #.');
  return url.origin + url.pathname.replace(/\/+$/, '');
}

export function parseOptions(argv: string[]): Options {
  const { values } = parseArgs({
    args: argv,
    strict: true,
    allowPositionals: false,
    options: {
      http: { type: 'boolean' },
      port: { type: 'string' },
      workspace: { type: 'string' },
      firebase: { type: 'boolean' },
      'app-url': { type: 'string' },
      'cloud-calls': { type: 'string' },
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean' },
    },
  });
  // The HTTP endpoint has no login: any program on this computer could reach it. Writing files and
  // spending the cloud budget stay on stdio, where only the host that started the server can call.
  if (values.http && (values.workspace !== undefined || values.firebase)) {
    throw new Error('--http cannot be combined with --workspace or --firebase. The HTTP endpoint has no login, so any program on this computer could use those tools. Use stdio for them.');
  }
  return {
    http: values.http ?? false,
    port: int(values.port, '--port', 1024, 65535, DEFAULT_PORT),
    workspace: values.workspace,
    firebase: values.firebase ?? false,
    appUrl: appUrl(values['app-url']),
    cloudCalls: int(values['cloud-calls'], '--cloud-calls', 0, MAX_CLOUD_CALLS, DEFAULT_CLOUD_CALLS),
    help: values.help ?? false,
    version: values.version ?? false,
  };
}
