/**
 * kalam-mcp entry point. On stdio, stdout carries the MCP protocol, so every log line goes to stderr,
 * and console.log is pointed there too in case a dependency prints. Logs never hold specs, requests
 * or records: only what started, what is off and why something failed.
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { parseOptions, USAGE, type Options } from './config';
import { startHttp } from './http';
import { buildContext, createKalamServer, VERSION } from './server';

const log = (msg: string) => process.stderr.write(`[kalam-mcp] ${msg}\n`);
console.log = console.error;
console.info = console.error;
console.debug = console.error;
// A backstop: one bad request must not stop the server. Only the error kind is logged, never its text,
// which could quote a request.
process.on('unhandledRejection', (e: unknown) => log(`A request failed: ${e instanceof Error ? e.name : typeof e}.`));

async function main(): Promise<void> {
  let options: Options;
  try {
    options = parseOptions(process.argv.slice(2));
  } catch (e) {
    log(e instanceof Error ? e.message : String(e));
    process.stderr.write(USAGE);
    process.exitCode = 2;
    return;
  }
  if (options.help) return void process.stdout.write(USAGE);
  if (options.version) return void process.stdout.write(`${VERSION}\n`);

  const ctx = await buildContext(options, process.env, log);
  const extras = [
    ctx.workspace ? `workspace ${ctx.workspace.root}` : 'no file access',
    ctx.firebase ? `Firebase compile on, budget ${ctx.firebase.budget.left} calls` : 'no cloud calls',
  ].join(', ');

  if (options.http) {
    await startHttp(options.port, () => createKalamServer(ctx));
    log(`Kalam MCP ${VERSION} on http://127.0.0.1:${options.port}/mcp (${extras}).`);
    return;
  }
  await createKalamServer(ctx).connect(new StdioServerTransport());
  log(`Kalam MCP ${VERSION} ready on stdio (${extras}).`);
}

main().catch((e: unknown) => {
  log(`Stopped: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
