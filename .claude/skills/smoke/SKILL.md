---
name: smoke
description: Use when a change touched the built-in engine - llama.cpp launch arguments, the prompt and its family layers, the tool grammar, the KV memory, the slot scheduler, the agent loop - and at the gate of such a phase. Replays on a real model what the fake llama-server cannot prove, and records the result.
---

# Real-model smoke

The fake llama-server proves the harness. It cannot prove grammars, slots, or
that the KV prefix survives real work. The smoke suite replays those on a real
model. It never runs in CI.

## 1. Announce the cost first

Loading a model is expensive, and Paul may be using the graphics card. Before
anything is loaded, tell him, in French:

- which model file, and its size;
- how much video memory it will take, and for about how long;
- that the model is unloaded at the end.

Nothing expensive happens without being announced first: that is the product's
own rule, and it applies to us.

## 2. Run the suite

From `packages/core`, with the model given by its path:

```sh
BONAPARTE_SMOKE_MODEL=<path to the .gguf> npx vitest run src/smoke
```

The suite launches llama.cpp itself, hidden, through `spawnHidden`. On the
maintainer's machine the server is the unified `llama` CLI (`llama serve`).

What keeps the suite honest:

- Sampling is fixed (temperature 0.2, seed 42). A small model at its default
  temperature is a coin flip on protocol details.
- Each prompt names the tool it expects. The suite judges the harness, not the
  model's initiative.
- A case that fails once on a small model is run again alone before anything
  is concluded. Say so when you report it.

## 3. Record the result

Add an entry at the top of "Real-model smoke results" in `AGENTS.md`:

- the date;
- the model and its quantisation, the llama.cpp build, the context size, the
  K and V cache types, the number of slots;
- each case, passed or failed;
- the figures that matter: tokens served from the cache, prefill time, tokens
  restored.

A failure is recorded too, with what it showed. Never write a result you did
not read in the output.
