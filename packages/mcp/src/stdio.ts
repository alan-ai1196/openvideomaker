import { createInterface } from 'node:readline';
import type { McpServer } from './server.js';

/**
 * stdio transport per the MCP specification: newline-delimited JSON.
 * Binary media never travels here - only JSON-RPC and text results.
 */
export function attachStdio(server: McpServer, options?: { input?: NodeJS.ReadableStream; output?: NodeJS.WritableStream }): void {
  const input = options?.input ?? process.stdin;
  const output = options?.output ?? process.stdout;
  const write = (line: string): void => {
    (output as NodeJS.WritableStream & { write(chunk: string): boolean }).write(line + '\n');
  };
  const lines = createInterface({ input });
  lines.on('line', (line) => {
    void server
      .handleLine(line)
      .then((response) => {
        if (response !== null) write(response);
      })
      .catch((err) => {
        write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32603, message: String((err as Error).message) } }));
      });
  });
}
