/**
 * The models bonaparte recommends (task 9.5): read on the official
 * repositories of the hub (Google's and Qwen's own GGUF files, Apache 2.0,
 * no licence to accept), never from the person's disk. Only the families the
 * built-in engine runs, and only the model file: no vision projector, there
 * is no vision in v1. A tier is the video memory of the machine, from which
 * the model, 32k of context and the margin fit.
 */

export interface CatalogueEntry {
  id: string;
  family: 'gemma' | 'qwen';
  /** Its name, as its publisher writes it. */
  name: string;
  /** The repository on the hub, `owner/name`. */
  repo: string;
  file: string;
  bytes: number;
  /** The SHA-256 the hub publishes for the file (its LFS object id), in hex. */
  sha256: string;
  /** The context it is recommended with, in tokens. */
  context: number;
  /** The video memory (GiB) from which it is the one recommended for its family. */
  fromGiB: number;
  /**
   * The files of the same model it is a new version of (task 13.1): one of
   * them on the disk, this one offered as an update — never in silence.
   */
  replaces?: readonly string[];
}

export const CATALOGUE: readonly CatalogueEntry[] = [
  {
    id: 'gemma-4-e2b',
    family: 'gemma',
    name: 'Gemma 4 E2B',
    repo: 'google/gemma-4-E2B-it-qat-q4_0-gguf',
    file: 'gemma-4-E2B_q4_0-it.gguf',
    bytes: 3_349_516_256,
    sha256: 'fa401b55b07ee70a54c6dae3903c783a6e65064312529ea57175cb5f8dec6634',
    context: 32_768,
    fromGiB: 0,
  },
  {
    id: 'gemma-4-e4b',
    family: 'gemma',
    name: 'Gemma 4 E4B',
    repo: 'google/gemma-4-E4B-it-qat-q4_0-gguf',
    file: 'gemma-4-E4B_q4_0-it.gguf',
    bytes: 5_154_941_280,
    sha256: '676c35070db6dbe52f93e9c864ee0fba4eddea94b9c875d9cb10daff453fbaee',
    context: 32_768,
    fromGiB: 8,
  },
  {
    id: 'gemma-4-12b',
    family: 'gemma',
    name: 'Gemma 4 12B',
    repo: 'google/gemma-4-12B-it-qat-q4_0-gguf',
    file: 'gemma-4-12b-it-qat-q4_0.gguf',
    bytes: 6_975_879_296,
    sha256: '93567e57a8fe10b23569b9d9ec38cd005deedf71e29477c421a4b83f418a538b',
    context: 32_768,
    fromGiB: 12,
  },
  {
    id: 'gemma-4-26b-a4b',
    family: 'gemma',
    name: 'Gemma 4 26B-A4B',
    repo: 'google/gemma-4-26B-A4B-it-qat-q4_0-gguf',
    file: 'gemma-4-26B_q4_0-it.gguf',
    bytes: 14_439_363_584,
    sha256: '3eca3b8f6d7baf218a7dd6bba5fb59a56ee25fe2d567b6f5f589b4f697eca51d',
    context: 32_768,
    fromGiB: 24,
  },
  {
    id: 'gemma-4-31b',
    family: 'gemma',
    name: 'Gemma 4 31B',
    repo: 'google/gemma-4-31B-it-qat-q4_0-gguf',
    file: 'gemma-4-31B_q4_0-it.gguf',
    bytes: 17_651_001_568,
    sha256: '179cfb99212709597eae5929112cfca677e1bbf566178b479ae1da0c4772874b',
    context: 32_768,
    fromGiB: 32,
  },
  {
    id: 'qwen3-4b',
    family: 'qwen',
    name: 'Qwen3 4B',
    repo: 'Qwen/Qwen3-4B-GGUF',
    file: 'Qwen3-4B-Q4_K_M.gguf',
    bytes: 2_497_280_256,
    sha256: '7485fe6f11af29433bc51cab58009521f205840f5b4ae3a32fa7f92e8534fdf5',
    context: 32_768,
    fromGiB: 0,
  },
  {
    id: 'qwen3-8b',
    family: 'qwen',
    name: 'Qwen3 8B',
    repo: 'Qwen/Qwen3-8B-GGUF',
    file: 'Qwen3-8B-Q4_K_M.gguf',
    bytes: 5_027_783_488,
    sha256: 'd98cdcbd03e17ce47681435b5150e34c1417f50b5c0019dd560e4882c5745785',
    context: 32_768,
    fromGiB: 12,
  },
  {
    id: 'qwen3-14b',
    family: 'qwen',
    name: 'Qwen3 14B',
    repo: 'Qwen/Qwen3-14B-GGUF',
    file: 'Qwen3-14B-Q4_K_M.gguf',
    bytes: 9_001_752_960,
    sha256: '500a8806e85ee9c83f3ae08420295592451379b4f8cf2d0f41c15dffeb6b81f0',
    context: 32_768,
    fromGiB: 16,
  },
  {
    id: 'qwen3-30b-a3b',
    family: 'qwen',
    name: 'Qwen3 30B-A3B',
    repo: 'Qwen/Qwen3-30B-A3B-GGUF',
    file: 'Qwen3-30B-A3B-Q4_K_M.gguf',
    bytes: 18_556_685_824,
    sha256: '0d003f6662faee786ed5da3e31b29c978de5ae5d275c8794c606a7f3c01aa8f5',
    context: 32_768,
    fromGiB: 24,
  },
];

const GiB = 1024 ** 3;

/**
 * For each family, Gemma first (the default of the product), the largest
 * model whose tier the memory reaches; an unknown memory gets the smallest.
 */
export function recommendedModels(
  vramBytes: number | null,
  catalogue: readonly CatalogueEntry[] = CATALOGUE,
): CatalogueEntry[] {
  const gib = vramBytes === null ? 0 : vramBytes / GiB;
  const picked: CatalogueEntry[] = [];
  for (const family of ['gemma', 'qwen'] as const) {
    const fitting = catalogue.filter((entry) => entry.family === family && entry.fromGiB <= gib);
    const best = fitting.reduce<CatalogueEntry | undefined>(
      (top, entry) => (top === undefined || entry.fromGiB > top.fromGiB ? entry : top),
      undefined,
    );
    if (best) picked.push(best);
  }
  return picked;
}

/** Where the hub serves a file of a repository (its main revision). */
export function modelUrl(entry: Pick<CatalogueEntry, 'repo' | 'file'>, hub: string): string {
  return `${hub.replace(/\/+$/, '')}/${entry.repo}/resolve/main/${entry.file}`;
}
