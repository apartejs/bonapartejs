/** The branch a repository's folder is on; '' when it is detached. */

import { git } from './git.js';

export async function currentBranch(dir: string): Promise<string> {
  const result = await git(['branch', '--show-current'], dir);
  return result.code === 0 ? result.stdout.trim() : '';
}
