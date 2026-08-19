/**
 * Reconnaissance d'un llama-server à une URL donnée.
 *
 * bonaparte ne pilote QUE llama.cpp. Sa raison d'être est la persistance du
 * contexte par conversation (slots + `/completion` brut + grammaire), et
 * aucune façade OpenAI ne l'expose : reconnaître LM Studio, Ollama ou vLLM
 * reviendrait à promettre une reprise instantanée qu'on ne pourrait pas
 * tenir. Un endpoint qui ne répond pas `/props` n'est donc pas un endpoint
 * pour nous — il n'est pas « dégradé », il est hors sujet.
 *
 * Cette sonde ne sert plus qu'à valider l'URL d'un llama-server qu'on n'a pas
 * lancé soi-même ; le mode nominal reste le serveur managé.
 */

export interface EndpointProbe {
  protocol: 'llamacpp';
  /** URL normalisée à utiliser (racine du serveur, sans /v1). */
  baseUrl: string;
  /** Modèle chargé, quand le serveur le dit. */
  model?: string;
  /** Nombre de slots annoncé (la persistance en dépend). */
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

export async function probeEndpoint(
  rawUrl: string,
  options: ProbeOptions = {},
): Promise<EndpointProbe | null> {
  const base = trim(rawUrl);
  if (base === '') return null;

  // Un utilisateur peut coller « …:8080 » ou la racine « …:8080/v1 » de la
  // façade OpenAI du même serveur : les deux mènent au même llama-server.
  const root = base.endsWith('/v1') ? base.slice(0, -3) : base;
  const props = await getJson(`${root}/props`, options);
  if (!props || !('model_path' in props || 'total_slots' in props)) return null;

  const model = String(props['model_path'] ?? '');
  return {
    protocol: 'llamacpp',
    baseUrl: root,
    ...(model ? { model } : {}),
    ...(typeof props['total_slots'] === 'number'
      ? { totalSlots: props['total_slots'] }
      : {}),
  };
}
