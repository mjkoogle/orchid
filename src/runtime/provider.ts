import { OrchidValue } from './values';

/**
 * Tag information passed to the provider for each operation.
 */
export interface TagInfo {
  name: string;
  value?: OrchidValue;
}

/**
 * Interface for LLM providers that power reasoning macros.
 *
 * Orchid's reasoning macros (CoT, CoVe, ELI5, etc.) delegate their actual
 * cognitive work to a provider. This interface defines what the runtime
 * expects from any provider implementation.
 */
export interface OrchidProvider {
  /**
   * Execute a reasoning operation.
   * @param operation - Name of the macro/operation (e.g., "CoT", "ELI5")
   * @param input - The input to reason about
   * @param context - Additional context from the execution environment
   * @param tags - Behavior modifier tags
   * @returns The result of the reasoning operation
   */
  execute(
    operation: string,
    input: string,
    context: Record<string, string>,
    tags: TagInfo[]
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
   * Return total tokens consumed across all API calls this session.
   * Optional — providers that don't track tokens can omit this.
   */
  getTokensUsed?(): number;
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
    tags: TagInfo[]
  ): Promise<OrchidValue> {
    const tagStr = tags.length > 0
      ? ` <${tags.map(t => t.value ? `${t.name}=${t.value}` : t.name).join(', ')}>`
      : '';
    const contextStr = Object.keys(context).length > 0
      ? ` [context: ${Object.keys(context).join(', ')}]`
      : '';

    console.log(`[${operation}]${tagStr}${contextStr}: ${input}`);

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

    return {
      kind: 'string',
      value: `[${operation} result: processed "${truncate(input, 80)}"]`,
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
}

function truncate(str: string, max: number): string {
  if (str.length <= max) return str;
  return str.slice(0, max - 3) + '...';
}
