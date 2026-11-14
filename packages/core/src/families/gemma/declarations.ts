/**
 * How Gemma 4 is told about a tool: `<|tool>declaration:NAME{…}<tool|>`, in
 * a notation of its own — not JSON: keys bare, strings between `<|"|>`
 * tokens, types in capitals. This is a port, line for line, of the macros of
 * the official template (`format_function_declaration`, `format_parameters`,
 * `format_argument`), quirks included: a property named like a schema
 * keyword (`description`, `type`…) is not declared. The tests render the
 * template itself and compare.
 */

import type { ToolDef } from '../../tools/types.js';
import { QUOTE } from './template.js';

type Mapping = Record<string, unknown>;

const STANDARD_KEYS = new Set(['description', 'type', 'properties', 'required', 'nullable']);

const isMapping = (value: unknown): value is Mapping =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** Jinja's truthiness: an empty string, list or mapping is false. */
function truthy(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  if (isMapping(value)) return Object.keys(value).length > 0;
  return Boolean(value);
}

/** Jinja's `dictsort`: by key, case-insensitive. */
function dictsort(mapping: Mapping): [string, unknown][] {
  return Object.entries(mapping).sort(([a], [b]) => {
    const left = a.toLowerCase();
    const right = b.toLowerCase();
    return left < right ? -1 : left > right ? 1 : 0;
  });
}

const upper = (value: unknown): string => (value === undefined || value === null ? '' : String(value).toUpperCase());
const quoted = (text: unknown): string => `${QUOTE}${String(text)}${QUOTE}`;
const quotedList = (items: unknown): string => (Array.isArray(items) ? items.map(quoted).join(',') : '');

export function formatArgument(argument: unknown, escapeKeys = true): string {
  if (typeof argument === 'string') return quoted(argument);
  if (typeof argument === 'boolean') return argument ? 'true' : 'false';
  if (isMapping(argument)) {
    const members = dictsort(argument).map(
      ([key, value]) => `${escapeKeys ? quoted(key) : key}:${formatArgument(value, escapeKeys)}`,
    );
    return `{${members.join(',')}}`;
  }
  if (Array.isArray(argument)) return `[${argument.map((item) => formatArgument(item, escapeKeys)).join(',')}]`;
  return String(argument);
}

function formatParameters(properties: Mapping, required: unknown): string {
  void required; // the template takes it and never reads it
  const declared: string[] = [];
  for (const [key, raw] of dictsort(properties)) {
    if (STANDARD_KEYS.has(key)) continue;
    const value: Mapping = isMapping(raw) ? raw : {};
    let out = `${key}:{`;
    let addComma = false;
    const comma = (): void => {
      if (addComma) out += ',';
      else addComma = true;
    };
    if (truthy(value['description'])) {
      out += `description:${quoted(value['description'])}`;
      addComma = true;
    }
    const type = upper(value['type']);
    if (type === 'STRING') {
      if (truthy(value['enum'])) {
        comma();
        out += `enum:${formatArgument(value['enum'])}`;
      }
    } else if (type === 'ARRAY') {
      const items = value['items'];
      if (isMapping(items) && truthy(items)) {
        comma();
        const parts: string[] = [];
        for (const [itemKey, itemValue] of dictsort(items)) {
          if (itemValue === null || itemValue === undefined) continue;
          if (itemKey === 'properties') {
            parts.push(`properties:{${isMapping(itemValue) ? formatParameters(itemValue, items['required'] ?? []) : ''}}`);
          } else if (itemKey === 'required') {
            parts.push(`required:[${quotedList(itemValue)}]`);
          } else if (itemKey === 'type') {
            parts.push(
              `type:${formatArgument(typeof itemValue === 'string' ? itemValue.toUpperCase() : Array.isArray(itemValue) ? itemValue.map(upper) : itemValue)}`,
            );
          } else {
            parts.push(`${itemKey}:${formatArgument(itemValue)}`);
          }
        }
        out += `items:{${parts.join(',')}}`;
      }
    }
    if (truthy(value['nullable'])) {
      comma();
      out += 'nullable:true';
    }
    if (type === 'OBJECT') {
      const nested = value['properties'];
      if (isMapping(nested)) {
        comma();
        out += `properties:{${formatParameters(nested, value['required'] ?? [])}}`;
      } else {
        comma();
        out += `properties:{${formatParameters(value, value['required'] ?? [])}}`;
      }
      if (truthy(value['required'])) {
        comma();
        out += `required:[${quotedList(value['required'])}]`;
      }
    }
    comma();
    out += `type:${quoted(type)}}`;
    declared.push(out);
  }
  return declared.join(',');
}

/** `declaration:NAME{description:…,parameters:{…}}`, as the template's macro writes it. */
export function formatFunctionDeclaration(tool: Pick<ToolDef, 'name' | 'description' | 'inputSchema'>): string {
  let out = `declaration:${tool.name}{description:${quoted(tool.description)}`;
  const params = tool.inputSchema;
  if (truthy(params)) {
    out += ',parameters:{';
    if (truthy(params['properties'])) {
      out += `properties:{${formatParameters(params['properties'] as Mapping, params['required'])}},`;
    }
    if (truthy(params['required'])) out += `required:[${quotedList(params['required'])}],`;
    if (truthy(params['type'])) out += `type:${quoted(upper(params['type']))}}`;
  }
  out += '}';
  return out.trim();
}
