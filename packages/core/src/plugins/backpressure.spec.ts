import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToolRegistry } from '../tools/registry.js';
import { FLOW_CONTROL, PluginHost } from './host.js';
import type { PluginNodeModule } from './host.js';

let dirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    dirs.map((d) => rm(d, { recursive: true, force: true }).catch(() => undefined)),
  );
  dirs = [];
});

/** Hôte avec un plugin « term » découvert : `activate` l'exige. */
async function hostWithTerm(
  emit = vi.fn(),
): Promise<{ host: PluginHost; emit: ReturnType<typeof vi.fn> }> {
  const root = await mkdtemp(join(tmpdir(), 'bp-flow-'));
  dirs.push(root);
  const dir = join(root, 'term');
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, 'plugin.json'),
    JSON.stringify({ id: 'term', name: 'Terminal', version: '0.1.0' }),
    'utf8',
  );
  const host = new PluginHost({
    registry: new ToolRegistry(),
    emit,
    logger: () => undefined,
  });
  await host.discover(root);
  return { host, emit };
}

/**
 * Contre-pression des événements poussés par un plugin.
 *
 * Le terminal perdait de la sortie : le producteur (un PTY) débitait plus vite
 * que la vue ne lisait, et le tampon élaguait le plus ancien. VS Code résout ce
 * problème depuis longtemps, et pas en agrandissant le tampon : il MET LE
 * PRODUCTEUR EN PAUSE. Le client acquitte par paquets, et au-delà d'un seuil de
 * non-acquittés le producteur doit s'arrêter jusqu'à ce que le client rattrape.
 *
 * Ces tests fixent ce contrat côté hôte : `emit` dit quand s'arrêter, et
 * `onDrain` dit quand reprendre.
 */

/** Plugin minimal qui expose son contexte pour que le test l'utilise. */
function capturing(): {
  module: PluginNodeModule;
  ctx: () => { emit: (e: string, p: unknown) => boolean; onDrain: (cb: () => void) => void };
} {
  let captured: unknown;
  return {
    module: {
      activate: (context) => {
        captured = context;
      },
    },
    ctx: () => captured as never,
  };
}

describe('contre-pression des événements de plugin', () => {
  it('expose les seuils, et le seuil d’acquittement ne dépasse pas le seuil bas', () => {
    // Si le paquet d'acquittement était plus gros que le seuil bas, le
    // producteur ne repartirait jamais : le client n'atteindrait pas le seuil
    // qui déclenche la reprise. C'est la contrainte que VS Code documente.
    expect(FLOW_CONTROL.ackSize).toBeLessThanOrEqual(FLOW_CONTROL.lowWatermark);
    expect(FLOW_CONTROL.lowWatermark).toBeLessThan(FLOW_CONTROL.highWatermark);
  });

  it('transmet l’événement à l’hôte, avec l’id du plugin', async () => {
    const { host: h, emit } = await hostWithTerm();
    const plugin = capturing();
    await h.activate('term', plugin.module);

    plugin.ctx().emit('data', 'bonjour');

    expect(emit).toHaveBeenCalledWith('term', 'data', 'bonjour');
  });

  it('rend true tant que la vue suit', async () => {
    const { host: h } = await hostWithTerm();
    const plugin = capturing();
    await h.activate('term', plugin.module);

    expect(plugin.ctx().emit('data', 'x')).toBe(true);
  });

  it('rend false au-delà du seuil haut : le producteur doit s’arrêter', async () => {
    const { host: h } = await hostWithTerm();
    const plugin = capturing();
    await h.activate('term', plugin.module);

    const chunk = 'x'.repeat(1000);
    let last = true;
    let pushed = 0;
    while (last && pushed < FLOW_CONTROL.highWatermark * 2) {
      last = plugin.ctx().emit('data', chunk);
      pushed += chunk.length;
    }

    expect(last).toBe(false);
    // On s'arrête AU franchissement du seuil, pas bien après.
    expect(pushed).toBeLessThanOrEqual(FLOW_CONTROL.highWatermark + chunk.length);
  });

  it('reprend, et le signale, quand la vue redescend sous le seuil bas', async () => {
    const { host: h } = await hostWithTerm();
    const plugin = capturing();
    await h.activate('term', plugin.module);

    const drained = vi.fn();
    plugin.ctx().onDrain(drained);

    const chunk = 'x'.repeat(FLOW_CONTROL.highWatermark);
    expect(plugin.ctx().emit('data', chunk)).toBe(false);

    // Un acquittement partiel ne suffit pas : on reste au-dessus du seuil bas.
    h.acknowledge('term', chunk.length - FLOW_CONTROL.lowWatermark - 1);
    expect(drained).not.toHaveBeenCalled();

    // Celui qui fait passer sous le seuil bas déclenche la reprise.
    h.acknowledge('term', 2);
    expect(drained).toHaveBeenCalledTimes(1);
    expect(plugin.ctx().emit('data', 'x')).toBe(true);
  });

  it('ignore un acquittement d’un plugin inconnu, sans lever', async () => {
    const { host: h } = await hostWithTerm();
    expect(() => h.acknowledge('fantome', 100)).not.toThrow();
  });

  it('oublie le compteur au démontage : un plugin réactivé repart à zéro', async () => {
    const { host: h } = await hostWithTerm();
    const plugin = capturing();
    await h.activate('term', plugin.module);

    expect(plugin.ctx().emit('data', 'x'.repeat(FLOW_CONTROL.highWatermark))).toBe(false);
    await h.deactivate('term');

    const again = capturing();
    await h.activate('term', again.module);
    // Sans remise à zéro, le plugin rechargé naîtrait déjà bloqué.
    expect(again.ctx().emit('data', 'x')).toBe(true);
  });

  it('un emit après démontage ne pousse rien : le plugin n’existe plus', async () => {
    const { host: h, emit } = await hostWithTerm();
    const plugin = capturing();
    await h.activate('term', plugin.module);
    const orphan = plugin.ctx();
    await h.deactivate('term');

    emit.mockClear();
    expect(orphan.emit('data', 'x')).toBe(false);
    expect(emit).not.toHaveBeenCalled();
  });
});
