# CLAUDE.md — bonaparte

bonaparte est un coding agent desktop **local-first** (Electron + React + apartéJS,
llama.cpp managé). Différenciateur : persistance du KV cache par conversation via
les slots de llama-server. Spec complète et privée : `docs/superpowers/specs/`
(git-ignoré — ne jamais le retirer du .gitignore, le repo est public).

## Journal de friction apartéJS — OBLIGATOIRE

bonaparte est aussi le banc d'essai de la lib apartéJS (`@aparte/*`). **Chaque
friction rencontrée avec la lib doit être consignée immédiatement** dans
`docs/superpowers/aparte-frictions.md` (privé), au moment où elle survient —
pas en fin de session. Paul s'en sert pour sortir correctifs et améliorations
de la lib.

Compte comme friction : API manquante ou maladroite, comportement surprenant,
piège non documenté, doc absente qui force à lire le source, contournement
nécessaire, message d'erreur inutile, incohérence entre paquets.

Format d'une entrée :

```md
## AAAA-MM-JJ — titre court
- **Paquet** : @aparte/xxx@version
- **Contexte** : ce qu'on essayait de faire
- **Friction** : le problème précis
- **Contournement** : ce qu'on a fait dans bonaparte
- **Piste lib** : le correctif/l'amélioration suggérée côté apartéJS
- **Statut** : ouverte | résolue en x.y.z
```

Quand une nouvelle version de la lib corrige une entrée, la marquer résolue
(ne pas la supprimer). Les bonnes surprises notables peuvent aussi être notées
(section « Ça, c'était bien ») — utile pour ne pas casser ce qui marche.

## Invariants (ne jamais violer)

- **Prompt append-only** : l'historique gelé d'un `PromptLog` n'est JAMAIS
  re-rendu ; tout passe par begin/complete. C'est ce qui protège le cache KV.
- **`/completion` uniquement** — jamais `/v1/chat/completions` (re-templating
  Qwen3 non byte-stable, issue QwenLM/Qwen3#1826).
- **Restore strict** : un état KV ne se restaure que si le manifest matche
  exactement ; au moindre doute, re-prefill annoncé.
- **`packages/core` n'importe jamais `electron`** (frontière enforcée par lint).
- Le renderer ne parle jamais directement au llama-server ; pas d'`AparteClient`
  côté renderer (double boucle) — API impérative d'`<AparteChat>` pilotée par IPC.
  Conséquence à ne pas oublier : c'est donc à NOUS d'appeler
  `registerDefaultRenderers()` au démarrage du renderer (la lib ne le fait que
  dans le constructeur d'`AparteClient`), sinon tout segment s'affiche
  « [Unknown segment type] » — couvert par `aparte-bootstrap.spec.ts`.
- **Un plugin ne défait jamais ses enregistrements à la main** : tout passe par
  son contexte, que l'hôte démonte d'un bloc. Une activation qui échoue ne
  laisse rien derrière elle, et rien de ce qu'un plugin lance ne survit à son
  démontage (serveur de dev, shell, vue native).

## Méthode de travail

- **TDD systématique** : test rouge d'abord, implémentation minimale ensuite.
  Le faux llama-server (`core/src/testing/fake-llama-server.ts`) sert de fixture
  à tout ce qui touche au backend — jamais besoin de GPU en CI.
- **i18n fr/en dès la première chaîne** (un fichier par langue : `types.ts` +
  `fr.ts` + `en.ts` ; les specs vérifient la parité des clés). **L'i18n
  concerne l'INTERFACE. Tout ce qui part vers le modèle est en ANGLAIS** —
  prompt système, descriptions d'outils, résultats, messages d'erreur d'outil,
  refus de permission : c'est un protocole, et les modèles sont entraînés en
  anglais pour l'instruction et le tool-calling. La langue de réponse est une
  consigne explicite du prompt (`replyLanguage`), pilotée par la locale.
- **Finition UI niveau pro dès le premier jet** — un écran pas fini n'est pas montré.
- **Commits locaux libres ; AUCUN push sans validation de Paul dans l'app.**

## Commandes

```sh
pnpm dev          # app Electron (electron-vite)
pnpm test         # toute la suite (Nx, cache)
pnpm build        # build de tous les paquets et plugins
pnpm lint         # eslint + boundaries
pnpm typecheck
pnpm --filter @aparte/bonaparte-app test:e2e   # E2E Electron (après pnpm build)
node packages/cli/dist/cli.js doctor   # diagnostic machine
```

## Repères

- Plan v1 approuvé : `docs/superpowers/specs/2026-08-18-bonaparte-v1-design.md`
- La machine de Paul a le **CLI unifié `llama`** (WindowsApps) : serveur =
  `llama serve`, mêmes flags que llama-server (`detectServeCommandPrefix()`).
- Jalons : J1 fondations+KV ✅ (validé en réel par Paul le 2026-08-18) ·
  J2 boucle agentique/outils/permissions/projet ✅ en CI — **premier contact
  réel le 2026-08-19** : le prefill passe (1295 tokens, 138 tok/s) et le modèle
  déclenche bien un appel d'outil, mais la grammaire refusait le tag ouvrant
  (corrigé, voir la grammaire ci-dessous). **Le reste du chemin agentique —
  exécution d'outil, résultat réinjecté, second tour — n'a toujours pas été vu
  de bout en bout** (smoke prêt : `BONAPARTE_SMOKE_MODEL=...` puis
  `npx vitest run src/smoke` dans packages/core) · J3 shell plugin-first ✅ (hôte de plugins réversible,
  panneau droit multi-vues, hub Réglages schema-driven, barre de statut avec
  jauge de contexte, 4 plugins inclus, E2E Playwright) · J4 MCP · J5 npx.
- **node-pty charge sous Electron 43 SANS recompilation** (vérifié le
  2026-08-20 : `pty.spawn(cmd.exe)` répond avec ses séquences ConPTY). Il faut
  seulement l'autoriser dans `pnpm.onlyBuiltDependencies` — pnpm bloque les
  scripts de build par défaut, et sans ça le module s'installe sans binaire.
  Le toolchain de la machine de Paul (VS Build Tools 2022+2026, Python 3.14)
  suffit. Le plugin terminal est donc un VRAI terminal : xterm.js côté vue,
  PTY côté Node, octets bruts entre les deux — surtout ne pas re-filtrer l'ANSI,
  c'est l'émulateur qui l'interprète.
- **Notre SDK de plugin n'a pas de canal Node → vue** : `registerCommand` est
  requête/réponse. Le terminal contourne par un curseur d'octets et un polling
  adaptatif (30 ms quand ça débite, 200 ms au repos). Un `ctx.emit()` serait le
  vrai correctif, utile aussi à la console du navigateur et aux logs de serveur
  de dev.
- **Plugins tiers hors de l'arbre : pas encore chargeables.** Les vues des
  plugins inclus sont ramassées par `import.meta.glob` (donc buildées avec
  l'app, chargées paresseusement) ; un plugin externe demandera le protocole
  custom Electron + une import map partageant React. Point d'extension
  identifié, volontairement pas ouvert en v1 (risque « double React »).
- Grammaire des tool-calls : `grammar_lazy` + `grammar_triggers` +
  `preserved_tokens` sur `/completion` — **non documentés** dans le README de
  llama.cpp, vérifiés dans `tools/server/server-schema.cpp`. Sans la
  paresse, le modèle serait forcé d'appeler un outil à chaque tour.
  **Le déclencheur DONNE son texte à la grammaire** : `llama_grammar_accept_impl`
  (`src/llama-grammar.cpp`) appelle `llama_grammar_accept_token(grammar, token,
  piece)` quand un token déclencheur tombe, et rejoue les tokens chevauchants
  pour un motif. La racine doit donc consommer `<tool_call>` elle-même, sinon
  le serveur lève « Unexpected empty grammar stack after accepting piece:
  <tool_call> » au premier appel — rencontré en réel le 2026-08-19 (le tag est
  un token spécial unique, id 248058, sur le modèle de Paul). La racine admet
  aussi **plusieurs blocs** : à un seul, la grammaire serait satisfaite après le
  premier appel et les appels parallèles seraient inémettables.
- La boucle N'utilise PAS `runStreamAgent` (@aparte/engine) : cet engine
  possède la liste de messages, incompatible avec le prompt append-only.
  Boucle maison dans `core/src/agent/loop.ts` (friction consignée).
