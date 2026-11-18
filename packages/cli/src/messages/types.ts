/** What the command says, in the person's language (one file per language, their keys checked equal). */
export interface CliMessages {
  units: { mb: string; gb: string };
  help(version: string): string;
  unknownCommand(command: string): string;
  doctor: {
    title: string;
    node(version: string, min: number): string;
    nodeTooOld(version: string, min: number): string;
    llamaMissing: string;
    llama(command: string, build: string, source: 'configured' | 'managed' | 'path'): string;
    llamaSilent(command: string): string;
    llamaTooOld(command: string, build: string, min: number): string;
    llamaUnknownBuild(command: string, build: string): string;
    slots(dir: string, free: string | null): string;
    slotsLowDisk(dir: string, free: string): string;
    slotsNotWritable(dir: string): string;
    gpu(memory: string): string;
    gpuNone: string;
    allGood: string;
    blocking: string;
  };
}
