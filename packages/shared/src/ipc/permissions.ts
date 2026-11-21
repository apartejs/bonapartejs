/**
 * « Toujours autoriser » (audit 2026-11-21, D3): what the card may offer to
 * remember for a call that asks, remembering it, and the rules kept — the
 * app's and each project's — listed and taken back in the settings. The core
 * decides what a rule is: the window names a call and a scope, never a rule
 * to add.
 */

import { z } from 'zod';
import { defineChannel } from './contract.js';

const idSchema = z.string().min(1).max(128);
const callSchema = z.object({ name: z.string().min(1).max(256), input: z.unknown() });

/** A rule as the core keeps it: a tool, and the exact command, a write's folder, or a page's site — or nothing more. */
export const allowRuleSchema = z.object({
  tool: z.string().min(1).max(256),
  program: z.string().max(256).optional(),
  args: z.array(z.string().max(4096)).max(256).optional(),
  path: z.string().max(1024).optional(),
  origin: z.string().max(512).optional(),
});
export type AllowRuleView = z.infer<typeof allowRuleSchema>;

/** Why a call that asks is asked every time. */
export const neverRememberedSchema = z.enum(['shell', 'chain', 'path', 'code', 'armed', 'outside', 'third-party', 'sensitive', 'unknown']);
export type NeverRememberedView = z.infer<typeof neverRememberedSchema>;

/** What the card may offer: the rule, and where « Toujours » keeps it — or why nothing. Null: the call does not ask. */
export const rememberOfferSchema = z
  .union([z.object({ rule: allowRuleSchema, where: z.enum(['app', 'project']) }), z.object({ never: neverRememberedSchema })])
  .nullable();
export type RememberOfferView = z.infer<typeof rememberOfferSchema>;

export const permissionsOffer = defineChannel('permissions.offer', z.object({ id: idSchema, call: callSchema }), rememberOfferSchema);

/** Remembered for the call's conversation, or always (its project, or the app for a site); false: nothing could be. */
export const permissionsRemember = defineChannel(
  'permissions.remember',
  z.object({ id: idSchema, call: callSchema, scope: z.enum(['conversation', 'always']) }),
  z.boolean(),
);

/** A rule's name for taking it back: the window never sends a rule, which would name a command (security rule 1). */
export function ruleKey(rule: { tool: string; program?: string; args?: readonly string[]; path?: string; origin?: string }): string {
  return JSON.stringify([rule.tool, rule.program ?? null, rule.args ?? null, rule.path ?? null, rule.origin ?? null]);
}

export const rememberedRuleSchema = z.object({ key: z.string(), rule: allowRuleSchema });
export type RememberedRuleView = z.infer<typeof rememberedRuleSchema>;

/** The rules kept: the app's (`projectId` null), or a project's. */
export const permissionsRules = defineChannel('permissions.rules', z.object({ projectId: idSchema.nullable() }), z.array(rememberedRuleSchema));

/** One taken back, by the name the list gave it. */
export const permissionsRevoke = defineChannel('permissions.revoke', z.object({ projectId: idSchema.nullable(), key: z.string().min(1).max(10_000) }), z.void());
