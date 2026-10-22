// Shared tail of the QA sessions: print how to attach, then either a REPL (interactive terminal) or
// wait for a signal (stdin is not a terminal, e.g. a QA agent running the session in the background).

import repl from 'node:repl';

export interface QaSession {
  banner: string[];
  /** Globals for the REPL. */
  globals: Record<string, unknown>;
  close: () => Promise<void>;
}

export function runSession({ banner, globals, close }: QaSession): void {
  console.log(banner.join('\n'));
  let closing = false;
  const shutdown = () => {
    if (closing) return;
    closing = true;
    close().then(
      () => process.exit(0),
      (error: unknown) => {
        console.error(error);
        process.exit(1);
      },
    );
  };
  process.once('SIGTERM', shutdown);
  if (!process.stdin.isTTY) {
    process.once('SIGINT', shutdown);
    console.log('\nstdin is not a terminal: no REPL. Stop with Ctrl-C or SIGTERM.');
    return;
  }
  console.log('\nREPL ready (top-level await works). .exit or Ctrl-D closes the browser.');
  const session = repl.start({ prompt: 'qa> ' });
  Object.assign(session.context, globals);
  session.on('exit', shutdown);
}
