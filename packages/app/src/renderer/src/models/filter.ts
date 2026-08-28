import type { ModelInfoDto } from '@aparte/bonaparte-shared';

/**
 * Filters the model inventory by a free-text query.
 *
 * Every whitespace-separated term must appear in the name OR the path, in
 * any order and any case: "qwen 32 q4" finds the model without knowing how
 * its file is named, and a publisher folder (unsloth, lmstudio-community)
 * counts even though the name does not repeat it.
 */
export function filterModels(models: ModelInfoDto[], query: string): ModelInfoDto[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return models;
  return models.filter((model) => {
    const haystack = `${model.name} ${model.path}`.toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}
