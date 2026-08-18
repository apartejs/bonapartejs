/**
 * Écriture groupée dans les segments d'un message.
 *
 * `appendToSegment` de la lib reconstruit et republie toute la liste de
 * messages à chaque appel — contrairement à `injectTokenStream`, qui a un
 * chemin rapide. Écrire token par token, c'est donc un rendu React complet par
 * token : tenable à 5 tok/s, plus du tout à 60. On accumule les deltas et on
 * n'écrit qu'une fois par frame.
 *
 * Les deltas d'un même segment sont concaténés dans l'ordre d'arrivée, et les
 * segments sont écrits dans l'ordre où ils ont reçu leur premier delta.
 */
export class SegmentWriter {
  private readonly pending = new Map<string, string>();
  private frame: number | null = null;

  constructor(
    private readonly write: (segmentId: string, content: string) => void,
    /** Injectable pour les tests ; en vrai, requestAnimationFrame. */
    private readonly schedule: (cb: () => void) => number = requestAnimationFrame.bind(
      globalThis,
    ),
    private readonly cancel: (handle: number) => void = cancelAnimationFrame.bind(
      globalThis,
    ),
  ) {}

  append(segmentId: string, delta: string): void {
    this.pending.set(segmentId, (this.pending.get(segmentId) ?? '') + delta);
    this.frame ??= this.schedule(() => {
      this.frame = null;
      this.flush();
    });
  }

  /**
   * Écrit immédiatement ce qui est en attente. À appeler avant tout changement
   * de structure (nouveau segment, fin de tour) pour que rien ne se perde et
   * que l'ordre visible reste celui du flux.
   */
  flush(): void {
    if (this.frame !== null) {
      this.cancel(this.frame);
      this.frame = null;
    }
    for (const [segmentId, content] of this.pending) this.write(segmentId, content);
    this.pending.clear();
  }

  /** Abandonne le travail en attente (démontage du composant). */
  dispose(): void {
    if (this.frame !== null) this.cancel(this.frame);
    this.frame = null;
    this.pending.clear();
  }
}
