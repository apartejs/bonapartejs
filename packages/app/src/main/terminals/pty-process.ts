/**
 * The terminals' own process (an Electron utility process, task 6.6): it
 * holds node-pty, so that a native crash in it never takes the app, nor the
 * model, down. It opens a pseudo-terminal on the shell the main process
 * names — never a shell string —, passes what is typed and the size in, and
 * what the shell prints out, raw: the view's emulator reads the escapes. On
 * Windows the pseudo-console has no window of its own.
 */

import { spawn, type IPty } from 'node-pty';
import type { FromPty, ToPty } from './pty-host.js';

const ptys = new Map<string, IPty>();
const port = process.parentPort;
const say = (message: FromPty): void => port.postMessage(message);

port.on('message', (event) => {
  const message = event.data as ToPty;
  switch (message.type) {
    case 'open': {
      const { id } = message;
      try {
        const pty = spawn(message.file, message.args, {
          name: 'xterm-256color',
          cols: message.cols,
          rows: message.rows,
          cwd: message.cwd,
          env: message.env,
        });
        ptys.set(id, pty);
        pty.onData((data) => say({ type: 'data', id, data }));
        pty.onExit(({ exitCode }) => {
          ptys.delete(id);
          say({ type: 'exit', id, code: exitCode });
        });
      } catch (error) {
        say({ type: 'data', id, data: `\r\n${error instanceof Error ? error.message : String(error)}\r\n` });
        say({ type: 'exit', id, code: null });
      }
      break;
    }
    case 'write':
      ptys.get(message.id)?.write(message.data);
      break;
    case 'resize':
      ptys.get(message.id)?.resize(message.cols, message.rows);
      break;
    case 'kill':
      ptys.get(message.id)?.kill();
      break;
    // Held while its view is behind: node-pty stops reading, and the shell stops at its next write.
    case 'pause':
      ptys.get(message.id)?.pause();
      break;
    case 'resume':
      ptys.get(message.id)?.resume();
      break;
  }
});
