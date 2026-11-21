/**
 * The projects, through the bridge (task 5.3): what a folder says, the
 * projects, and a folder chosen by the person in the system's dialog. The
 * window never runs a folder: the core reads it, and works only inside it.
 */

import {
  projectsAddFolder,
  projectsChooseFolder,
  projectsCreate,
  projectsDetect,
  projectsFolderTaken,
  projectsList,
  projectsRemove,
  projectsUpdate,
} from '@aparte/bonaparte-shared';
import type { Core } from '@aparte/bonaparte-core';
import type { IpcRegistry } from './register.js';

export interface ProjectCore {
  projects: Core['projects'];
}

/** The system's folder dialog — or, in a test run, the test's folder. */
export type ChooseFolder = () => Promise<string | null>;

export function registerProjectChannels(ipc: IpcRegistry, core: ProjectCore, chooseFolder: ChooseFolder): void {
  ipc.handle(projectsList, () => core.projects.list());
  ipc.handle(projectsDetect, ({ folder }) => core.projects.detect(folder));
  ipc.handle(projectsFolderTaken, ({ id }) => core.projects.folderTaken(id));
  ipc.handle(projectsChooseFolder, async () => {
    const folder = await chooseFolder();
    return folder ? { folder } : null;
  });
  ipc.handle(projectsCreate, (input) => core.projects.create(input));
  ipc.handle(projectsUpdate, ({ id, changes }) => core.projects.update(id, changes));
  ipc.handle(projectsRemove, ({ id }) => core.projects.remove(id));
  // A folder for the project, chosen in the system's dialog: the window names none.
  ipc.handle(projectsAddFolder, async ({ id }) => {
    const folder = await chooseFolder();
    if (folder === null) return null;
    const project = await core.projects.get(id);
    if (!project) throw new Error(`Unknown project: ${id}`);
    return core.projects.update(id, { roots: [...project.roots, folder] });
  });
}
