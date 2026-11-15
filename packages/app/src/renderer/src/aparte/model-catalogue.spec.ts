/**
 * The composer's picker lists the core's models through one descriptive
 * provider (apartejs/aparte#244): the models the built-in engine can load,
 * each with its size and the video memory it takes; the config's model is
 * the one the engine runs.
 */

import { aparteGlobalConfig } from '@aparte/core';
import type { ModelChoiceView } from '@aparte/bonaparte-shared';
import { afterEach, describe, expect, it } from 'vitest';
import { fr } from '../i18n/fr';
import { catalogueOf, ENGINE_PROVIDER, showCatalogue } from './model-catalogue';

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
  aparteGlobalConfig.unregisterAIProvider(ENGINE_PROVIDER);
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
    const provider = aparteGlobalConfig.getAIProvider(ENGINE_PROVIDER)!;
    expect(provider.getMetadata().name).toBe('Sur cette machine');
    expect(provider.getModels().map((one) => one.name)).toEqual(['gemma', 'qwen']);
    expect(aparteGlobalConfig.getModelConfig()).toMatchObject({ defaultProvider: ENGINE_PROVIDER, defaultModel: 'C:/models/qwen.gguf' });
    // Listed again: the new list, the new model chosen.
    showCatalogue(catalogueOf([model('gemma')], fr, STYLE), fr.modelSwitch.provider, 'C:/models/gemma.gguf');
    expect(aparteGlobalConfig.getAIProvider(ENGINE_PROVIDER)!.getModels()).toHaveLength(1);
    expect(aparteGlobalConfig.getModelConfig().defaultModel).toBe('C:/models/gemma.gguf');
  });
});
