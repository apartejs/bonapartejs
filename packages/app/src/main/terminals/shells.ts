/**
 * The shells of the machine (task 6.6): found by the app, which alone names
 * an executable — a plugin and the window choose one by its id. Only those
 * present are offered, the first being the default.
 */

export interface ShellEntry {
  id: string;
  label: string;
  file: string;
  args: string[];
}

export function findShells(
  platform: NodeJS.Platform,
  env: Record<string, string | undefined>,
  exists: (path: string) => boolean,
): ShellEntry[] {
  const candidates: ShellEntry[] = [];
  if (platform === 'win32') {
    const root = env['SystemRoot'] ?? 'C:\\Windows';
    const programs = env['ProgramFiles'] ?? 'C:\\Program Files';
    candidates.push(
      { id: 'powershell', label: 'Windows PowerShell', file: `${root}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`, args: ['-NoLogo'] },
      { id: 'pwsh', label: 'PowerShell 7', file: `${programs}\\PowerShell\\7\\pwsh.exe`, args: ['-NoLogo'] },
      { id: 'cmd', label: 'cmd', file: env['ComSpec'] ?? `${root}\\System32\\cmd.exe`, args: [] },
      { id: 'gitbash', label: 'Git Bash', file: `${programs}\\Git\\bin\\bash.exe`, args: ['--login', '-i'] },
    );
  } else {
    const own = env['SHELL'];
    if (own) candidates.push({ id: own.split('/').pop() || 'shell', label: own.split('/').pop() || own, file: own, args: ['-i'] });
    for (const file of ['/bin/zsh', '/bin/bash', '/usr/bin/fish', '/bin/sh']) {
      const name = file.split('/').pop()!;
      candidates.push({ id: name, label: name, file, args: ['-i'] });
    }
  }
  const seen = new Set<string>();
  return candidates.filter((shell) => {
    if (seen.has(shell.file) || seen.has(shell.id) || !exists(shell.file)) return false;
    seen.add(shell.file);
    seen.add(shell.id);
    return true;
  });
}
