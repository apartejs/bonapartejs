/**
 * Checks on what a setting names before the engine runs it (security rule 1:
 * the window never chooses an executable). The window is ours, but it renders
 * model output: if anything ever got a script into it, the bridge must not
 * hand over "run this program".
 */

/**
 * The engine binary is a llama.cpp server — `llama-server`, the unified
 * `llama` CLI, or a variant build named after them — never an arbitrary
 * program, nor a script that borrows the name. The name is the only thing
 * that can be checked before running it; a wrong binary that passes this is
 * still asked for `/health` and `/props`.
 */
export function assertLlamaBinary(binPath: string): void {
  const file = binPath.replace(/\\/g, '/').split('/').pop() ?? '';
  const name = file.replace(/\.exe$/i, '');
  // No other extension: `.cmd`, `.bat`, `.ps1`, `.sh` are scripts.
  const scripted = /\.(?:cmd|bat|com|ps1|psm1|vbs|vbe|js|jse|wsf|wsh|msc|sh|bash|py)$/i.test(name);
  if (scripted || !/^llama(?:[-_][\w.-]+)?$/i.test(name)) {
    throw new Error(
      `The engine must be a llama.cpp server binary (llama-server, or the llama CLI): ${binPath || '(empty)'}`,
    );
  }
}
