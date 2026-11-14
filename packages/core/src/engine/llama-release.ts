/**
 * The llama.cpp builds bonaparte can download, read in llama.cpp's GitHub
 * releases. One package per machine: Vulkan on Windows and Linux (it runs on
 * every vendor's card, at 36 MB where CUDA weighs hundreds), the native
 * build on a Mac (Metal). A package is offered only with the SHA-256 digest
 * GitHub publishes for it, and only from llama.cpp's own releases.
 */

export const LLAMA_RELEASES = 'https://api.github.com/repos/ggml-org/llama.cpp/releases?per_page=5';
const LLAMA_DOWNLOADS = 'https://github.com/ggml-org/llama.cpp/releases/download/';

/** What GitHub's API gives of a release (the part read here). */
export interface GithubRelease {
  tag_name: string;
  assets: { name: string; size: number; browser_download_url: string; digest?: string | null }[];
}

/** A package to download: its build, its address, its size and its digest. */
export interface LlamaAsset {
  build: string;
  name: string;
  url: string;
  bytes: number;
  sha256: string;
}

/** The part of a package's name that says which machine it is for. */
export function packageSlug(platform: NodeJS.Platform, arch: string): string | null {
  if (arch !== 'x64' && arch !== 'arm64') return null;
  if (platform === 'win32') return `win-vulkan-${arch}`;
  if (platform === 'linux') return `ubuntu-vulkan-${arch}`;
  if (platform === 'darwin') return `macos-${arch}`;
  return null;
}

/** What a build's tag must be: it names the folder the build is unpacked to. */
export const BUILD_TAG = /^b\d+$/;

export function pickAsset(release: GithubRelease, platform: NodeJS.Platform, arch: string): LlamaAsset | null {
  const slug = packageSlug(platform, arch);
  if (!slug || !BUILD_TAG.test(release.tag_name)) return null;
  const wanted = new RegExp(`^llama-${release.tag_name}-bin-${slug}\\.(zip|tar\\.gz)$`);
  const asset = release.assets.find((candidate) => wanted.test(candidate.name));
  const sha256 = /^sha256:([0-9a-f]{64})$/.exec(asset?.digest ?? '')?.[1];
  if (!asset || !sha256) return null;
  return { build: release.tag_name, name: asset.name, url: asset.browser_download_url, bytes: asset.size, sha256 };
}

/** The number of a build, however it is written: `b12383`, `b10217-ddd4ec142`, `version: 7100 (abc1234)`. */
export function buildNumber(tag: string): number | null {
  const match = /\bb?(\d{3,})\b/.exec(tag);
  return match ? Number(match[1]) : null;
}

export interface LatestOptions {
  fetch?: typeof globalThis.fetch;
  platform?: NodeJS.Platform;
  arch?: string;
  /** Where the releases are read (tests: a local server); packages must come from there. */
  releases?: string;
  signal?: AbortSignal;
}

/**
 * The newest build with a package for this machine; null when none has one.
 * Throws when GitHub cannot be reached or refuses: the caller says « not
 * known », never « up to date ».
 */
export async function latestLlamaAsset(options: LatestOptions = {}): Promise<LlamaAsset | null> {
  const releases = options.releases ?? LLAMA_RELEASES;
  const allowed = options.releases ? new URL(options.releases).origin + '/' : LLAMA_DOWNLOADS;
  const response = await (options.fetch ?? fetch)(releases, {
    headers: { accept: 'application/vnd.github+json', 'user-agent': 'bonaparte' },
    ...(options.signal ? { signal: options.signal } : {}),
  });
  if (!response.ok) throw new Error(`llama.cpp's releases could not be read: HTTP ${response.status}`);
  const list = (await response.json()) as GithubRelease[];
  if (!Array.isArray(list)) throw new Error("llama.cpp's releases could not be read: not a list");
  for (const release of list) {
    const asset = pickAsset(release, options.platform ?? process.platform, options.arch ?? process.arch);
    if (asset) return within(asset.url, allowed) ? asset : null;
  }
  return null;
}

/** Is this address under that one once normalised — as fetch will read it (`%2e%2e` is a `..`)? */
function within(url: string, allowed: string): boolean {
  try {
    return new URL(url).href.startsWith(allowed);
  } catch {
    return false;
  }
}
