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

## Méthode de travail

- **TDD systématique** : test rouge d'abord, implémentation minimale ensuite.
  Le faux llama-server (`core/src/testing/fake-llama-server.ts`) sert de fixture
  à tout ce qui touche au backend — jamais besoin de GPU en CI.
- **i18n fr/en dès la première chaîne** (pattern TS-typé, pas de JSON pour le
  harness/l'UI ; les specs vérifient la parité des clés).
- **Finition UI niveau pro dès le premier jet** — un écran pas fini n'est pas montré.
- **Commits locaux libres ; AUCUN push sans validation de Paul dans l'app.**

## Commandes

```sh
pnpm dev          # app Electron (electron-vite)
pnpm test         # toute la suite (Nx, cache)
pnpm build        # build 4 paquets
pnpm lint         # eslint + boundaries
pnpm typecheck
node packages/cli/dist/cli.js doctor   # diagnostic machine
```

## Repères

- Plan v1 approuvé : `docs/superpowers/specs/2026-08-18-bonaparte-v1-design.md`
- La machine de Paul a le **CLI unifié `llama`** (WindowsApps) : serveur =
  `llama serve`, mêmes flags que llama-server (`detectServeCommandPrefix()`).
- Jalons : J1 fondations+KV ✅ (validation Paul en attente) · J2 boucle
  agentique/outils/permissions/projet · J3 shell plugin-first · J4 MCP · J5 npx.
