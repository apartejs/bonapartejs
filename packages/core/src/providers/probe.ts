/**
 * What answers at an address (task 9.1; ported from v0's `backend/detect-endpoint.ts`, which knew llama.cpp
 * only): a llama-server, recognised by its `/props`, or a service that speaks OpenAI's API, by its
 * `/v1/models`. Said in under five seconds whatever the address does — a readable failure, never a hang.
 */

export type ProbeResult =
  | { kind: 'llamacpp-remote'; url: string; models: string[]; totalSlots?: number }
  | { kind: 'openai-compat'; url: string; models: string[] }
  | { error: ProbeError; message: string };

export type ProbeError = 'invalid-address' | 'unreachable' | 'timeout' | 'refused-key' | 'not-a-service';

export interface ProbeOptions {
  /** The service's key, when it asks one: sent as a bearer token, never logged. */
  key?: string;
  fetch?: typeof fetch;
  /** The whole probe, every request included (default 4.5 s). */
  timeoutMs?: number;
}

type Answer = { status: number; body: unknown } | { failure: 'unreachable' | 'timeout' };

const basename = (path: string): string => path.split(/[\\/]/).pop() ?? path;

export async function probeEndpoint(address: string, options: ProbeOptions = {}): Promise<ProbeResult> {
  let parsed: URL;
  try {
    parsed = new URL(address.trim());
  } catch {
    return { error: 'invalid-address', message: `« ${address} » is not an address.` };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { error: 'invalid-address', message: 'Only http and https addresses are probed.' };
  }
  const base = parsed.toString().replace(/\/+$/, '');
  const root = base.endsWith('/v1') ? base.slice(0, -3) : base;
  const deadline = AbortSignal.timeout(options.timeoutMs ?? 4_500);
  const headers: Record<string, string> = options.key ? { authorization: `Bearer ${options.key}` } : {};

  const ask = async (url: string): Promise<Answer> => {
    try {
      const response = await (options.fetch ?? fetch)(url, { headers, signal: deadline });
      const text = await response.text();
      let body: unknown = null;
      try {
        body = JSON.parse(text);
      } catch {
        body = null;
      }
      return { status: response.status, body };
    } catch {
      return { failure: deadline.aborted ? 'timeout' : 'unreachable' };
    }
  };

  // A llama-server first: its `/props` says it, with the model it serves and its slots.
  const props = await ask(`${root}/props`);
  if ('failure' in props) return failed(props.failure);
  if (props.status === 401 || props.status === 403) return failed('refused-key');
  const said = props.body as Record<string, unknown> | null;
  if (props.status === 200 && said && ('model_path' in said || 'total_slots' in said)) {
    const model = typeof said['model_path'] === 'string' && said['model_path'] ? [basename(said['model_path'])] : [];
    return {
      kind: 'llamacpp-remote',
      url: root,
      models: model,
      ...(typeof said['total_slots'] === 'number' ? { totalSlots: said['total_slots'] } : {}),
    };
  }

  // Else OpenAI's API, at its usual root `/v1`.
  const listed = await ask(`${root}/v1/models`);
  if ('failure' in listed) return failed(listed.failure);
  if (listed.status === 401 || listed.status === 403) return failed('refused-key');
  const data = (listed.body as { data?: unknown } | null)?.data;
  if (listed.status === 200 && Array.isArray(data)) {
    const models = data.flatMap((model) => (typeof (model as { id?: unknown }).id === 'string' ? [(model as { id: string }).id] : []));
    return { kind: 'openai-compat', url: `${root}/v1`, models };
  }
  return failed('not-a-service');
}

const MESSAGES: Record<ProbeError, string> = {
  'invalid-address': 'Not an address.',
  unreachable: 'Nothing answers at this address.',
  timeout: 'The address does not answer.',
  'refused-key': 'The service refused the key.',
  'not-a-service': 'This address answers, but neither as llama.cpp nor as an OpenAI-compatible service.',
};

function failed(error: ProbeError): ProbeResult {
  return { error, message: MESSAGES[error] };
}
