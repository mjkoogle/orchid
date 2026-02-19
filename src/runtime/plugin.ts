import { OrchidValue } from './values';
import { OrchidProvider, TagInfo } from './provider';

/**
 * Context provided to plugin operations at runtime.
 * Gives plugins access to the Orchid execution environment.
 */
export interface PluginContext {
  /** The LLM provider — plugins can call reasoning operations. */
  provider: OrchidProvider;

  /** The current implicit context value (result of the last operation). */
  implicitContext: OrchidValue;

  /** Emit a trace message (only visible when tracing is enabled). */
  trace: (message: string) => void;

  /** Tags attached to this specific invocation. */
  tags: TagInfo[];
}

/**
 * A single operation provided by a plugin.
 * Receives resolved arguments and the runtime context.
 */
export type PluginOperation = (
  args: Record<string, OrchidValue>,
  context: PluginContext,
) => Promise<OrchidValue>;

/**
 * OrchidPlugin — the interface for runtime capability extensions.
 *
 * Plugins are like Claude Code skills: they register named operations
 * that become callable via `namespace:Operation()` syntax, and they
 * have access to the full runtime context (provider, environment, tags).
 *
 * Unlike MCP servers (external processes that speak a protocol), plugins
 * run in-process and can leverage the LLM provider directly.
 *
 * Example plugin:
 * ```ts
 * import { OrchidPlugin, orchidString } from 'orchid-lang';
 *
 * const plugin: OrchidPlugin = {
 *   name: 'sentiment',
 *   description: 'Sentiment analysis operations',
 *   operations: {
 *     async Analyze(args, ctx) {
 *       const text = valueToString(args.arg0 ?? ctx.implicitContext);
 *       const result = await ctx.provider.execute(
 *         'Classify', text, { categories: 'positive,negative,neutral' }, ctx.tags
 *       );
 *       return result;
 *     },
 *     async Score(args, ctx) {
 *       const text = valueToString(args.arg0 ?? ctx.implicitContext);
 *       const result = await ctx.provider.execute(
 *         'Quantify', text, { dimension: 'sentiment -1.0 to 1.0' }, ctx.tags
 *       );
 *       return result;
 *     },
 *   },
 * };
 *
 * export default plugin;
 * ```
 *
 * Usage in Orchid:
 * ```orchid
 * Use Plugin("sentiment") as s
 * score := s:Score("I love this product!")
 * label := s:Analyze("The service was terrible")
 * ```
 */
export interface OrchidPlugin {
  /** Plugin name (used for identification and trace logging). */
  name: string;

  /** Human-readable description of what this plugin provides. */
  description?: string;

  /** Named operations this plugin provides, callable via namespace:Operation(). */
  operations: Record<string, PluginOperation>;

  /**
   * Called once when the plugin is loaded via `Use Plugin(...)`.
   * Use for initialization, validation, or resource setup.
   */
  setup?: (context: PluginContext) => Promise<void>;

  /**
   * Called when the interpreter shuts down.
   * Use for cleanup (closing connections, flushing buffers, etc.).
   */
  teardown?: () => Promise<void>;
}
