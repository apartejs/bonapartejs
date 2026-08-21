/**
 * Contrat des outils de l'agent. Un outil = un schéma (JSON Schema) + un
 * handler Node pur. Les outils viennent du cœur, des plugins ou de MCP :
 * le registre les fusionne, la grammaire en découle.
 */

export type ToolSource = 'builtin' | 'plugin' | 'mcp';

/** Ce que l'outil fait au système — arbitré par le moteur de permissions. */
export type ToolEffect = 'read' | 'write' | 'execute';

export interface ToolDef {
  name: string;
  description: string;
  /** JSON Schema de l'objet d'arguments. */
  inputSchema: Record<string, unknown>;
  effect: ToolEffect;
}

export interface ToolContext {
  /**
   * Racines du projet ouvert, ORDONNÉES : la première est le défaut des chemins
   * relatifs, et le périmètre autorisé est leur UNION.
   *
   * VIDE est un cas normal : les outils existent quand même, le projet n'est
   * pas leur condition d'existence mais leur PÉRIMÈTRE. Sans racine, les
   * chemins relatifs partent du dossier personnel et rien n'est confiné.
   */
  roots: string[];
  signal: AbortSignal;
}

export interface ToolResult {
  ok: boolean;
  /** Texte réinjecté au modèle (déjà tronqué si nécessaire). */
  content: string;
}

export type ToolHandler = (
  args: Record<string, unknown>,
  ctx: ToolContext,
) => Promise<ToolResult>;

export interface RegisteredTool {
  def: ToolDef;
  handler: ToolHandler;
  source: ToolSource;
}

/** Photo de l'inventaire, pour détecter les changements entre deux tours. */
export interface ToolInventorySnapshot {
  names: string[];
  /** Empreinte stable (noms + schémas) : change ⇔ l'inventaire a changé. */
  hash: string;
}

export interface ToolInventoryDelta {
  added: ToolDef[];
  removed: string[];
}
