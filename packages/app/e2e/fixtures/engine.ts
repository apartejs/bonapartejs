/**
 * Loading the built-in engine without the first launch's screen: a service known, the app opens on its
 * conversations (task 9.6), and a test that also needs the engine loads its first model as « Démarrer »
 * would — through the bridge, the window following the engine's event.
 */

import { expect, type Page } from '@playwright/test';

export async function loadFirstModel(page: Page): Promise<void> {
  const loaded = await page.evaluate(async () => {
    const preload = window as unknown as { bonaparte: { invoke(name: string, input: unknown): Promise<unknown> } };
    const models = (await preload.bonaparte.invoke('engine.models', undefined)) as { path: string; supported: boolean }[];
    const first = models.find((model) => model.supported);
    if (!first) return false;
    const result = (await preload.bonaparte.invoke('engine.load', { path: first.path })) as { ok: boolean };
    return result.ok;
  });
  expect(loaded).toBe(true);
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const preload = window as unknown as { bonaparte: { invoke(name: string, input: unknown): Promise<{ status: string }> } };
          return (await preload.bonaparte.invoke('engine.state', undefined)).status;
        }),
      { timeout: 20_000 },
    )
    .toBe('ready');
}
