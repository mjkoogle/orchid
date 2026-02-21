/**
 * Runtime value types for the Orchid language.
 * Every expression in Orchid evaluates to an OrchidValue.
 */

export type OrchidValue =
  | OrchidString
  | OrchidNumber
  | OrchidBoolean
  | OrchidNull
  | OrchidList
  | OrchidDict
  | OrchidCallable
  | OrchidAgent
  | OrchidEvent
  | OrchidAsset;

export interface OrchidString {
  kind: 'string';
  value: string;
}

export interface OrchidNumber {
  kind: 'number';
  value: number;
  suffix?: string;
}

export interface OrchidBoolean {
  kind: 'boolean';
  value: boolean;
}

export interface OrchidNull {
  kind: 'null';
}

export interface OrchidList {
  kind: 'list';
  elements: OrchidValue[];
}

export interface OrchidDict {
  kind: 'dict';
  entries: Map<string, OrchidValue>;
}

export interface OrchidCallable {
  kind: 'callable';
  name: string;
  params: { name: string; defaultValue?: OrchidValue }[];
  body: any; // AST.Node[] — we avoid the circular import
  tags: { name: string; value?: OrchidValue }[];
  closure: any; // Environment reference
  isAgent: boolean;
}

export interface OrchidAgent {
  kind: 'agent';
  name: string;
  state: Map<string, OrchidValue>;
}

export interface OrchidEvent {
  kind: 'event';
  name: string;
  payload: OrchidValue;
}

/**
 * Multimedia asset produced by Generate() — image, audio, video, or document.
 * At least one of path, url, or data must be set.
 */
export type GenerateFormat = 'text' | 'image' | 'audio' | 'video' | 'document';

export interface OrchidAsset {
  kind: 'asset';
  /** Semantic type for downstream use (image, audio, video, document). */
  mediaType: GenerateFormat;
  /** MIME type, e.g. image/png, audio/mpeg, video/mp4. */
  mimeType: string;
  /** File path if the asset was written to disk. */
  path?: string;
  /** URL if the asset is hosted (or data URL for inline). */
  url?: string;
  /** Inline base64 data if not path/url. */
  data?: string;
  /** Optional short description (e.g. from the prompt). */
  description?: string;
}

// ─── Constructors ────────────────────────────────────

export function orchidString(value: string): OrchidString {
  return { kind: 'string', value };
}

export function orchidNumber(value: number, suffix?: string): OrchidNumber {
  return { kind: 'number', value, suffix };
}

export function orchidBoolean(value: boolean): OrchidBoolean {
  return { kind: 'boolean', value };
}

export function orchidNull(): OrchidNull {
  return { kind: 'null' };
}

export function orchidList(elements: OrchidValue[]): OrchidList {
  return { kind: 'list', elements };
}

export function orchidDict(entries: Map<string, OrchidValue>): OrchidDict {
  return { kind: 'dict', entries };
}

export function orchidAsset(
  mediaType: OrchidAsset['mediaType'],
  mimeType: string,
  options: { path?: string; url?: string; data?: string; description?: string } = {}
): OrchidAsset {
  return {
    kind: 'asset',
    mediaType,
    mimeType,
    ...options,
  };
}

// ─── Utilities ───────────────────────────────────────

export function isTruthy(value: OrchidValue): boolean {
  switch (value.kind) {
    case 'null': return false;
    case 'boolean': return value.value;
    case 'number': return value.value !== 0;
    case 'string': return value.value.length > 0;
    case 'list': return value.elements.length > 0;
    case 'dict': return value.entries.size > 0;
    case 'asset': return !!(value.path || value.url || (value.data && value.data.length > 0));
    default: return true;
  }
}

export function valueToString(value: OrchidValue): string {
  switch (value.kind) {
    case 'string': return value.value;
    case 'number': return value.suffix ? `${value.value}${value.suffix}` : String(value.value);
    case 'boolean': return String(value.value);
    case 'null': return 'null';
    case 'list': return '[' + value.elements.map(valueToString).join(', ') + ']';
    case 'dict': {
      const entries = Array.from(value.entries.entries())
        .map(([k, v]) => `${k}: ${valueToString(v)}`);
      return '{' + entries.join(', ') + '}';
    }
    case 'callable': return `<${value.isAgent ? 'agent' : 'macro'} ${value.name}>`;
    case 'agent': return `<agent-instance ${value.name}>`;
    case 'event': return `<event ${value.name}: ${valueToString(value.payload)}>`;
    case 'asset': {
      if (value.path) return value.path;
      if (value.url) return value.url;
      if (value.data) return `data:${value.mimeType};base64,${value.data.slice(0, 32)}...`;
      return `[${value.mediaType}: ${value.mimeType}]`;
    }
  }
}

export function valuesEqual(a: OrchidValue, b: OrchidValue): boolean {
  if (a.kind !== b.kind) {
    // Coerce string/number comparison
    if (a.kind === 'string' && b.kind === 'number') return a.value === String(b.value);
    if (a.kind === 'number' && b.kind === 'string') return String(a.value) === b.value;
    return false;
  }
  switch (a.kind) {
    case 'string': return a.value === (b as OrchidString).value;
    case 'number': return a.value === (b as OrchidNumber).value;
    case 'boolean': return a.value === (b as OrchidBoolean).value;
    case 'null': return true;
    case 'asset': return a === b; // reference equality for assets
    default: return a === b;
  }
}
