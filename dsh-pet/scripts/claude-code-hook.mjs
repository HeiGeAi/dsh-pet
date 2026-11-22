#!/usr/bin/env node
/** Claude Code command hook. Forward only the session ID and a fixed status to the local pet. */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const states = new Map([
  ['UserPromptSubmit', 'thinking'],
  ['PreToolUse', 'working'],
  ['PermissionRequest', 'waiting'],
  ['PermissionDenied', 'thinking'],
  ['PostToolUse', 'thinking'],
  ['PostToolUseFailure', 'thinking'],
  ['Stop', 'success'],
  ['StopFailure', 'error'],
  ['SessionEnd', null],
]);

const defaultHome = process.env.DSH_HOME || join(homedir(), '.dsh');
const [, , action, directory] = process.argv;

if (action === '--print-hooks') {
  // Desktop sessions can have a different PATH from the user's terminal. Quote absolute paths for macOS.
  const command = [process.execPath, fileURLToPath(import.meta.url), resolve(directory || defaultHome)]
    .map((arg) => `'${arg.replaceAll("'", "'\\''")}'`)
    .join(' ');
  const hooks = Object.fromEntries(
    [...states.keys()].map((event) => [event, [{ hooks: [{ type: 'command', command, timeout: 2 }] }]]),
  );
  console.log(JSON.stringify({ hooks }, null, 2));
} else {
  try {
    const { session_id: sessionId, hook_event_name: event } = JSON.parse(readFileSync(0, 'utf8'));
    if (states.has(event) && typeof sessionId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(sessionId)) {
      const home = action || defaultHome;
      const { name, port, token } = JSON.parse(readFileSync(join(home, 'dsh-pet', 'standalone-runtime.json'), 'utf8'));
      if (
        name === 'dsh-pet-standalone' &&
        Number.isInteger(port) &&
        port >= 1 &&
        port <= 65535 &&
        typeof token === 'string' &&
        /^[A-Za-z0-9_-]{43}$/.test(token)
      ) {
        await fetch(`http://127.0.0.1:${port}/claude-code/status`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-dsh-pet-token': token },
          body: JSON.stringify({ sessionId, state: states.get(event) }),
          redirect: 'error',
          signal: AbortSignal.timeout(350),
        });
      }
    }
  } catch {
    // Closed or unavailable pet: no output or decision for Claude Code.
  }
}
