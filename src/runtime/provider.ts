import { OrchidValue, OrchidAsset, GenerateFormat, orchidString, orchidAsset } from './values';

/**
 * Tag information passed to the provider for each operation.
 */
export interface TagInfo {
  name: string;
  value?: OrchidValue;
}

/**
 * Options for execute() when the operation input includes media (e.g. Critique(image)).
 * When the primary input is an OrchidAsset, the runtime passes it as attachments
 * so the provider can run vision/multimodal (e.g. Claude analyzing the image).
 */
export interface ExecuteOptions {
  /** Media assets (image, etc.) to be analyzed; provider uses these when operation supports it. */
  attachments?: OrchidAsset[];
}

/**
 * Interface for LLM providers that power reasoning macros.
 *
 * Orchid's reasoning macros (CoT, CoVe, ELI5, etc.) delegate their actual
 * cognitive work to a provider. When the input is media (OrchidAsset), the
 * runtime passes it via options.attachments so the same macros can operate on
 * generated images/audio/etc. (e.g. Critique(cover) critiques the image itself).
 */
export interface OrchidProvider {
  /**
   * Execute a reasoning operation.
   * @param operation - Name of the macro/operation (e.g., "CoT", "ELI5", "Critique")
   * @param input - The input to reason about (text prompt, or default when input is media)
   * @param context - Additional context from the execution environment
   * @param tags - Behavior modifier tags
   * @param options - Optional; when the primary input was media, attachments contains it
   * @returns The result of the reasoning operation
   */
  execute(
    operation: string,
    input: string,
    context: Record<string, string>,
    tags: TagInfo[],
    options?: ExecuteOptions
  ): Promise<OrchidValue>;

  /**
   * Perform a search operation.
   * @param query - The search query
   * @param tags - Behavior modifier tags
   */
  search(query: string, tags: TagInfo[]): Promise<OrchidValue>;

  /**
   * Assess confidence for a given value or the current context.
   * @param scope - Optional scope identifier
   * @returns A number between 0.0 and 1.0
   */
  confidence(scope?: string): Promise<number>;

  /**
   * Execute a tool operation (MCP/Plugin namespace).
   * @param namespace - The tool namespace
   * @param operation - The operation name
   * @param args - Arguments to the operation
   * @param tags - Behavior modifier tags
   */
  toolCall(
    namespace: string,
    operation: string,
    args: Record<string, OrchidValue>,
    tags: TagInfo[]
  ): Promise<OrchidValue>;

  /**
   * Generate multimedia content (image, audio, video, document) or text from a prompt.
   * For format=text, may return a string. For other formats, returns an OrchidAsset.
   * Providers may support a subset of formats; unsupported formats should throw a clear error.
   */
  generate(
    prompt: string,
    format: GenerateFormat,
    tags: TagInfo[]
  ): Promise<OrchidValue>;
}

/**
 * A console-based provider for testing and demonstration.
 * Prints operations to the console and returns descriptive strings.
 */
export class ConsoleProvider implements OrchidProvider {
  private confidenceValue = 0.75;

  async execute(
    operation: string,
    input: string,
    context: Record<string, string>,
    tags: TagInfo[],
    options?: ExecuteOptions
  ): Promise<OrchidValue> {
    const tagStr = tags.length > 0
      ? ` <${tags.map(t => t.value ? `${t.name}=${t.value}` : t.name).join(', ')}>`
      : '';
    const contextStr = Object.keys(context).length > 0
      ? ` [context: ${Object.keys(context).join(', ')}]`
      : '';
    const attachStr = options?.attachments?.length
      ? ` [with ${options.attachments.length} attachment(s): ${options.attachments.map(a => a.mediaType).join(', ')}]`
      : '';

    console.log(`[${operation}]${tagStr}${contextStr}${attachStr}: ${input}`);

    // Operations that naturally produce lists return list values
    const listOps = new Set(['Decompose', 'Brainstorm', 'Classify']);
    if (listOps.has(operation)) {
      const count = context['_count'] ? parseInt(context['_count']) : 3;
      const elements: OrchidValue[] = [];
      for (let i = 0; i < count; i++) {
        elements.push({
          kind: 'string',
          value: `[${operation} item ${i + 1} of "${truncate(input, 60)}"]`,
        });
      }
      return { kind: 'list', elements };
    }

    const inputDesc = options?.attachments?.length
      ? `media (${options.attachments.map(a => a.mediaType).join(', ')})`
      : truncate(input, 80);
    return {
      kind: 'string',
      value: `[${operation} result: processed "${inputDesc}"]`,
    };
  }

  async search(query: string, tags: TagInfo[]): Promise<OrchidValue> {
    const tagStr = tags.length > 0
      ? ` <${tags.map(t => t.name).join(', ')}>`
      : '';
    console.log(`[Search]${tagStr}: ${query}`);

    return {
      kind: 'string',
      value: `[Search results for: "${truncate(query, 80)}"]`,
    };
  }

  async confidence(_scope?: string): Promise<number> {
    return this.confidenceValue;
  }

  setConfidence(value: number): void {
    this.confidenceValue = value;
  }

  async toolCall(
    namespace: string,
    operation: string,
    args: Record<string, OrchidValue>,
    tags: TagInfo[]
  ): Promise<OrchidValue> {
    const tagStr = tags.length > 0
      ? ` <${tags.map(t => t.name).join(', ')}>`
      : '';
    const argStr = Object.entries(args)
      .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
      .join(', ');
    console.log(`[${namespace}:${operation}]${tagStr}(${argStr})`);

    return {
      kind: 'string',
      value: `[${namespace}:${operation} result]`,
    };
  }

  async generate(prompt: string, format: GenerateFormat, tags: TagInfo[]): Promise<OrchidValue> {
    const tagStr = tags.length > 0
      ? ` <${tags.map(t => t.name).join(', ')}>`
      : '';
    console.log(`[Generate]${tagStr} format=${format}: ${truncate(prompt, 80)}`);

    if (format === 'text') {
      return orchidString(`[Generate text: "${truncate(prompt, 80)}"]`);
    }

    const mimeTypes: Record<Exclude<GenerateFormat, 'text'>, string> = {
      image: 'image/png',
      audio: 'audio/mpeg',
      video: 'video/mp4',
      document: 'application/pdf',
    };
    return orchidAsset(format, mimeTypes[format], {
      path: `[placeholder.${format === 'image' ? 'png' : format === 'audio' ? 'mp3' : format === 'video' ? 'mp4' : 'pdf'}]`,
      description: truncate(prompt, 120),
    });
  }
}

function truncate(str: string, max: number): string {
  if (str.length <= max) return str;
  return str.slice(0, max - 3) + '...';
}
