/**
 * Détection du protocole d'un endpoint.
 *
 * Tout est un endpoint : llama.cpp lancé par bonaparte, un llama-server
 * distant, LM Studio, Ollama, vLLM… « Managé » n'est qu'un lancement
 * automatique par-dessus. L'utilisateur colle donc une URL, et bonaparte
 * découvre à quoi il parle plutôt que de le lui demander.
 */

export type EndpointProtocol = 'llamacpp' | 'openai-compat';

export interface EndpointProbe {
  protocol: EndpointProtocol;
  /** URL normalisée à utiliser (base OpenAI incluant /v1 le cas échéant). */
  baseUrl: string;
  /** Modèle servi / chargé, quand l'endpoint le dit. */
  model?: string;
  /** Modèles disponibles (OpenAI-compatible). */
  models?: string[];
  /** Nombre de slots annoncé par llama.cpp (persistance possible). */
  totalSlots?: number;
}

export interface ProbeOptions {
  apiKey?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

function trim(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

async function getJson(
  url: string,
  options: ProbeOptions,
): Promise<Record<string, unknown> | null> {
  const doFetch = options.fetchImpl ?? fetch;
  try {
    const res = await doFetch(url, {
      headers: options.apiKey ? { authorization: `Bearer ${options.apiKey}` } : {},
      signal: AbortSignal.timeout(options.timeoutMs ?? 4_000),
    });
    if (!res.ok) return null;
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Interroge l'endpoint. llama.cpp est testé en premier : c'est le seul qui
 * offre la persistance de contexte, et il expose aussi une façade
 * OpenAI-compatible qui masquerait cette capacité si on la détectait d'abord.
 */
export async function probeEndpoint(
  rawUrl: string,
  options: ProbeOptions = {},
): Promise<EndpointProbe | null> {
  const base = trim(rawUrl);
  if (base === '') return null;

  // Un utilisateur peut coller « …:1234/v1 » ou « …:8080 » : on essaie les
  // deux racines plausibles pour llama.cpp.
  const llamaRoot = base.endsWith('/v1') ? base.slice(0, -3) : base;
  const props = await getJson(`${llamaRoot}/props`, options);
  if (props && ('model_path' in props || 'total_slots' in props)) {
    const model = String(props['model_path'] ?? '');
    return {
      protocol: 'llamacpp',
      baseUrl: llamaRoot,
      ...(model ? { model } : {}),
      ...(typeof props['total_slots'] === 'number'
        ? { totalSlots: props['total_slots'] }
        : {}),
    };
  }

  const openAiBase = base.endsWith('/v1') ? base : `${base}/v1`;
  const models = await getJson(`${openAiBase}/models`, options);
  const data = models?.['data'];
  if (Array.isArray(data)) {
    const ids = data
      .map((entry) => (entry as { id?: unknown }).id)
      .filter((id): id is string => typeof id === 'string')
      .sort((a, b) => a.localeCompare(b));
    return {
      protocol: 'openai-compat',
      baseUrl: openAiBase,
      models: ids,
      ...(ids[0] ? { model: ids[0] } : {}),
    };
  }

  return null;
}
