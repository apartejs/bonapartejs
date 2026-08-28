/**
 * Recognizes a llama-server at a given URL.
 *
 * bonaparte drives ONLY llama.cpp. Its reason for being is per-conversation
 * context persistence (slots + raw `/completion` + grammar), and no OpenAI
 * facade exposes that: recognizing LM Studio, Ollama, or vLLM would amount
 * to promising an instant resume we couldn't deliver. An endpoint that
 * doesn't answer `/props` is therefore not an endpoint for us — it isn't
 * "degraded", it's out of scope.
 *
 * This probe now only serves to validate the URL of a llama-server we
 * didn't launch ourselves; the managed server remains the nominal mode.
 */

export interface EndpointProbe {
  protocol: 'llamacpp';
  /** Normalized URL to use (server root, without /v1). */
  baseUrl: string;
  /** Loaded model, when the server reports it. */
  model?: string;
  /** Announced number of slots (persistence depends on it). */
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

  // A user might paste "…:8080" or the "…:8080/v1" root of the same
  // server's OpenAI facade: both lead to the same llama-server.
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
