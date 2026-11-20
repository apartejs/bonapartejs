/**
 * The composer's picker lists the core's models through one descriptive
 * provider (apartejs/aparte#244): the models the built-in engine can load,
 * each with its size and the video memory it takes; the config's model is
 * the one the engine runs.
 */

import { aparteGlobalConfig } from '@aparte/core';
import type { ModelChoiceView } from '@aparte/bonaparte-shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fr } from '../i18n/fr';
import { baseIdOf, catalogueOf, ENGINE_PROVIDER, registeredId, showCatalogue, showServices } from './model-catalogue';

const GiB = 1024 ** 3;
const STYLE = { locale: 'fr', units: fr.units };

const model = (name: string, extra: Partial<ModelChoiceView> = {}): ModelChoiceView => ({
  path: `C:/models/${name}.gguf`,
  name,
  sizeBytes: 21.3 * GiB,
  source: 'custom',
  family: 'gemma',
  supported: true,
  kvBytesPerToken: 20_480,
  announcement: { kind: 'engine-load', seconds: 22, secondsEstimated: false, vramBytes: 23.1 * GiB, gpuBytes: 24 * GiB, verdict: 'tight' },
  isDefault: false,
  lastLoadedAt: null,
  ...extra,
});

afterEach(() => {
  aparteGlobalConfig.unregisterAIProvider(registeredId(ENGINE_PROVIDER));
  showServices([]);
  aparteGlobalConfig.setModelConfig({});
});

describe('the models of the picker', () => {
  it('those the built-in engine can load, each with its size and its video memory', () => {
    const listed = catalogueOf(
      [model('gemma'), model('vieux', { supported: false, problem: 'unsupported-family' }), model('illisible', { announcement: null })],
      fr,
      STYLE,
    );
    expect(listed).toEqual([{ id: 'C:/models/gemma.gguf', name: 'gemma', description: '21,3 Go · 23,1 Go de mémoire vidéo' }]);
  });

  it('are given to the picker by one provider, the model that runs shown chosen', () => {
    showCatalogue(catalogueOf([model('gemma'), model('qwen')], fr, STYLE), fr.modelSwitch.provider, 'C:/models/qwen.gguf');
    const provider = aparteGlobalConfig.getAIProvider(registeredId(ENGINE_PROVIDER))!;
    expect(provider.getMetadata().name).toBe('Sur cette machine');
    expect(provider.getModels().map((one) => one.name)).toEqual(['gemma', 'qwen']);
    expect(aparteGlobalConfig.getModelConfig()).toMatchObject({ defaultProvider: registeredId(ENGINE_PROVIDER), defaultModel: 'C:/models/qwen.gguf' });
    // Listed again: the new list, the new model chosen.
    showCatalogue(catalogueOf([model('gemma')], fr, STYLE), fr.modelSwitch.provider, 'C:/models/gemma.gguf');
    expect(aparteGlobalConfig.getAIProvider(registeredId(ENGINE_PROVIDER))!.getModels()).toHaveLength(1);
    expect(aparteGlobalConfig.getModelConfig().defaultModel).toBe('C:/models/gemma.gguf');
  });

  it('listed again as it is, tells aparté nothing: a change of its config draws every conversation list again, an open row menu with it', () => {
    // Every one of these tells aparté's config it changed (`aparte-config-change`).
    const told = [
      vi.spyOn(aparteGlobalConfig, 'setModelConfig'),
      vi.spyOn(aparteGlobalConfig, 'registerAIProvider'),
      vi.spyOn(aparteGlobalConfig, 'unregisterAIProvider'),
    ];
    const changes = (): number => told.reduce((sum, spy) => sum + spy.mock.calls.length, 0);
    try {
      showCatalogue(catalogueOf([model('gemma')], fr, STYLE), fr.modelSwitch.provider, 'C:/models/gemma.gguf');
      expect(changes()).toBeGreaterThan(0);
      const once = changes();
      showCatalogue(catalogueOf([model('gemma')], fr, STYLE), fr.modelSwitch.provider, 'C:/models/gemma.gguf');
      expect(changes()).toBe(once);
      // Anything it shows that changed is told.
      showCatalogue(catalogueOf([model('gemma'), model('qwen')], fr, STYLE), fr.modelSwitch.provider, 'C:/models/gemma.gguf');
      expect(changes()).toBeGreaterThan(once);
    } finally {
      for (const spy of told) spy.mockRestore();
    }
  });

  it('a list that changed goes in under an id of its own, before the old one leaves: aparté’s picker sees it changed (apartejs/aparte#276)', () => {
    showCatalogue(catalogueOf([model('gemma')], fr, STYLE), fr.modelSwitch.provider, 'C:/models/gemma.gguf');
    const first = registeredId(ENGINE_PROVIDER);
    const registering = vi.spyOn(aparteGlobalConfig, 'registerAIProvider');
    const leaving = vi.spyOn(aparteGlobalConfig, 'unregisterAIProvider');
    try {
      showCatalogue(catalogueOf([model('gemma'), model('petit')], fr, STYLE), fr.modelSwitch.provider, 'C:/models/gemma.gguf');
      const now = registeredId(ENGINE_PROVIDER);
      expect(now).not.toBe(first);
      expect(registering.mock.calls.map(([provider]) => provider?.id)).toEqual([now]);
      expect(leaving.mock.calls).toEqual([[first]]);
      // The new one first: the picker's providers never read as the ones it loaded before.
      expect(registering.mock.invocationCallOrder[0]).toBeLessThan(leaving.mock.invocationCallOrder[0]!);
    } finally {
      registering.mockRestore();
      leaving.mockRestore();
    }
    const now = registeredId(ENGINE_PROVIDER);
    expect(aparteGlobalConfig.getAIProvider(first)).toBeUndefined();
    expect(aparteGlobalConfig.getAIProvider(now)!.getModels().map((one) => one.name)).toEqual(['gemma', 'petit']);
    expect(aparteGlobalConfig.getModelConfig()).toMatchObject({ defaultProvider: now, defaultModel: 'C:/models/gemma.gguf' });
    // A pick names the id it was listed under: the app knows the base one.
    expect(baseIdOf(now)).toBe(ENGINE_PROVIDER);
    expect(baseIdOf('svc-1#4')).toBe('svc-1');
  });

  it('a service’s list that changed goes in under an id of its own too; a service gone leaves the picker', () => {
    showServices([{ id: 'svc-1', label: 'Ollama', models: ['a'] }]);
    const first = registeredId('svc-1');
    showServices([{ id: 'svc-1', label: 'Ollama', models: ['a', 'b'] }]);
    const now = registeredId('svc-1');
    expect(now).not.toBe(first);
    expect(aparteGlobalConfig.getAIProvider(first)).toBeUndefined();
    expect(aparteGlobalConfig.getAIProvider(now)!.getModels().map((one) => one.id)).toEqual(['a', 'b']);
    showServices([]);
    expect(aparteGlobalConfig.getAIProvider(now)).toBeUndefined();
  });
});
