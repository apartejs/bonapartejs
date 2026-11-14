---
name: screen
description: Use when building or changing a screen that the design canvas shows - a page, a pane, a dialog, a card in the conversation. Goes from the board and the design document to a failing end-to-end test, the screen built with aparté, and screenshots compared with the board.
---

# Building a screen from the canvas

The canvas decides how a screen looks. The design document decides what it
must do. aparté provides every control. Follow the steps in order.

## 1. Read the board and the design document

- Ask the `canvas-reader` agent for the board
  (`docs/superpowers/canvas/<Board>.dc.html`): its elements, their exact French
  labels, its states and interactions, its colour tokens.
- Read the section of the design document that covers the screen (section 8,
  and the sections it points to). Where the board and section 8.9 disagree, the
  design document wins.
- Sample data on a board illustrates: names, counts, durations and sizes are
  examples, never requirements.

## 2. Choose the aparté pieces

- Ask the `aparte-docs` agent which components, kit classes and tokens draw
  each part, with their exact names. Use the React wrappers of `@aparte/react`
  where one exists; the other elements are custom-element tags.
- Menus and tabs get their keyboard from `enhanceMenu`, `enhanceContextMenu`
  and `enhanceTabs`.
- Something aparté lacks is a friction: file it (the `friction` skill), then
  build the smallest stand-in from kit classes. Never add a second UI library.

## 3. Write the strings

Add the keys to `i18n/types.ts`, the French text to `fr.ts` (copied from the
board, accents included) and the English text to `en.ts`. The parity test must
pass. No visible text is written in a component.

## 4. Write the failing end-to-end test

One Playwright spec per behaviour the task names, through the `launchApp`
fixture. Run it and watch it fail because the screen is missing.

## 5. Build

- Every colour comes from a token declared in `theme/tokens.css`.
- Every icon button has an accessible name, and its name shows on hover.
- A state is never told by colour alone.
- Hook classes for tests and hosts (`.conv-item`, `.setting-row`) stay on the
  elements, unstyled.

## 6. Capture and compare

Capture the screen in light and dark, in French and in English, at 1440 px
and at 820 px wide, into `docs/superpowers/screens/phase-NN/`. Put each capture
next to its board and list the differences in
`docs/superpowers/plans/SUIVI.md`: what differs, and whether it is a bug, a
limit of aparté (with its issue number), or a deliberate choice.

A screen is not shown to Paul unfinished.
