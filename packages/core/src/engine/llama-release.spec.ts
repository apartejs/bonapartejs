/**
 * Which llama.cpp build to download, read in its GitHub releases: the
 * package for this machine (Vulkan, which runs on every vendor's card; Metal
 * on a Mac), with the digest GitHub gives — a package without one is never
 * offered, since nothing could verify it.
 */

import { describe, expect, it } from 'vitest';
import { buildNumber, latestLlamaAsset, packageSlug, pickAsset, type GithubRelease } from './llama-release.js';

const DOWNLOAD = 'https://github.com/ggml-org/llama.cpp/releases/download';

function release(tag: string, names: string[], options: { digest?: boolean } = {}): GithubRelease {
  return {
    tag_name: tag,
    assets: names.map((name, index) => ({
      name,
      size: 1000 + index,
      browser_download_url: `${DOWNLOAD}/${tag}/${name}`,
      ...(options.digest === false ? {} : { digest: `sha256:${String(index).padStart(64, 'a')}` }),
    })),
  };
}

const B12383 = release('b12383', [
  'cudart-llama-bin-win-cuda-12.4-x64.zip',
  'llama-b12383-bin-win-cpu-x64.zip',
  'llama-b12383-bin-win-vulkan-x64.zip',
  'llama-b12383-bin-win-vulkan-arm64.zip',
  'llama-b12383-bin-ubuntu-vulkan-x64.tar.gz',
  'llama-b12383-bin-macos-arm64.tar.gz',
  'llama-b12383-xcframework.zip',
]);

describe('packageSlug', () => {
  it('is Vulkan on Windows and Linux, the native build on a Mac', () => {
    expect(packageSlug('win32', 'x64')).toBe('win-vulkan-x64');
    expect(packageSlug('win32', 'arm64')).toBe('win-vulkan-arm64');
    expect(packageSlug('linux', 'x64')).toBe('ubuntu-vulkan-x64');
    expect(packageSlug('darwin', 'arm64')).toBe('macos-arm64');
  });

  it('is none where llama.cpp publishes nothing', () => {
    expect(packageSlug('freebsd', 'x64')).toBeNull();
    expect(packageSlug('win32', 'ia32')).toBeNull();
  });
});

describe('pickAsset', () => {
  it("takes this machine's package, with its size and its digest", () => {
    expect(pickAsset(B12383, 'win32', 'x64')).toEqual({
      build: 'b12383',
      name: 'llama-b12383-bin-win-vulkan-x64.zip',
      url: `${DOWNLOAD}/b12383/llama-b12383-bin-win-vulkan-x64.zip`,
      bytes: 1002,
      sha256: '2'.padStart(64, 'a'),
    });
    expect(pickAsset(B12383, 'linux', 'x64')?.name).toBe('llama-b12383-bin-ubuntu-vulkan-x64.tar.gz');
    expect(pickAsset(B12383, 'darwin', 'arm64')?.name).toBe('llama-b12383-bin-macos-arm64.tar.gz');
  });

  it('offers nothing without a digest to verify it against', () => {
    expect(pickAsset(release('b12383', ['llama-b12383-bin-win-vulkan-x64.zip'], { digest: false }), 'win32', 'x64')).toBeNull();
  });

  it('offers nothing from a release whose tag is not a build: the tag names a folder', () => {
    const odd = release('../../../Documents', ['llama-../../../Documents-bin-win-vulkan-x64.zip']);
    expect(pickAsset(odd, 'win32', 'x64')).toBeNull();
    expect(pickAsset(release('b1.*', ['llama-b1x-bin-win-vulkan-x64.zip']), 'win32', 'x64')).toBeNull();
  });

  it('offers nothing when the release has no package for this machine', () => {
    expect(pickAsset(release('b12383', ['llama-b12383-bin-win-cpu-x64.zip']), 'win32', 'x64')).toBeNull();
  });
});

describe('buildNumber', () => {
  it('reads the number of a build, whatever the way it is written', () => {
    expect(buildNumber('b12383')).toBe(12383);
    expect(buildNumber('b10217-ddd4ec142')).toBe(10217);
    expect(buildNumber('version: 7100 (abc1234)')).toBe(7100);
    expect(buildNumber('unknown')).toBeNull();
  });
});

describe('latestLlamaAsset', () => {
  function answering(body: unknown, status = 200) {
    const asked: { url: string; headers: Record<string, string> }[] = [];
    const fetch = (async (url: string, init?: RequestInit) => {
      asked.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
      return new Response(JSON.stringify(body), { status });
    }) as typeof globalThis.fetch;
    return { fetch, asked };
  }

  it('takes the newest release that has a package for this machine', async () => {
    const empty = release('b12384', ['llama-b12384-xcframework.zip']);
    const { fetch, asked } = answering([empty, B12383]);
    const asset = await latestLlamaAsset({ fetch, platform: 'win32', arch: 'x64' });
    expect(asset?.build).toBe('b12383');
    expect(asked[0]!.url).toBe('https://api.github.com/repos/ggml-org/llama.cpp/releases?per_page=5');
    // GitHub refuses a request without one; it names the program, nothing of the person.
    expect(asked[0]!.headers['user-agent']).toBe('bonaparte');
  });

  it('refuses a package that would come from anywhere but llama.cpp\'s releases', async () => {
    const elsewhere = release('b12383', ['llama-b12383-bin-win-vulkan-x64.zip']);
    elsewhere.assets[0]!.browser_download_url = 'https://example.com/llama.zip';
    const { fetch } = answering([elsewhere]);
    expect(await latestLlamaAsset({ fetch, platform: 'win32', arch: 'x64' })).toBeNull();
  });

  it("refuses an address that climbs out of llama.cpp's releases once it is normalised", async () => {
    const climbing = release('b12383', ['llama-b12383-bin-win-vulkan-x64.zip']);
    climbing.assets[0]!.browser_download_url =
      'https://github.com/ggml-org/llama.cpp/releases/download/%2e%2e/%2e%2e/%2e%2e/%2e%2e/someone/else/releases/download/b1/x.zip';
    expect(await latestLlamaAsset({ fetch: answering([climbing]).fetch, platform: 'win32', arch: 'x64' })).toBeNull();
  });

  it('says it does not know when GitHub does not answer, or answers wrong', async () => {
    const offline = (async () => {
      throw new TypeError('fetch failed');
    }) as typeof globalThis.fetch;
    await expect(latestLlamaAsset({ fetch: offline, platform: 'win32', arch: 'x64' })).rejects.toThrow();
    await expect(latestLlamaAsset({ fetch: answering({ message: 'rate limit' }, 403).fetch, platform: 'win32', arch: 'x64' })).rejects.toThrow(/403/);
  });

  it('asks a releases address it is given, and accepts packages from that address only (tests)', async () => {
    const local = release('b1', ['llama-b1-bin-win-vulkan-x64.zip']);
    local.assets[0]!.browser_download_url = 'http://127.0.0.1:4000/b1/llama-b1-bin-win-vulkan-x64.zip';
    const { fetch, asked } = answering([local]);
    const asset = await latestLlamaAsset({ fetch, platform: 'win32', arch: 'x64', releases: 'http://127.0.0.1:4000/releases' });
    expect(asked[0]!.url).toBe('http://127.0.0.1:4000/releases');
    expect(asset?.url).toBe('http://127.0.0.1:4000/b1/llama-b1-bin-win-vulkan-x64.zip');
  });
});
