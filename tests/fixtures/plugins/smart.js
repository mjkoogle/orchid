/**
 * Test plugin that uses the provider context.
 * Demonstrates that plugins can call back into the LLM provider.
 * Self-contained value constructors.
 */

function valueToString(v) {
  if (v.kind === 'string') return v.value;
  if (v.kind === 'number') return String(v.value);
  if (v.kind === 'null') return '';
  return String(v.value ?? '');
}

const plugin = {
  name: 'smart',
  description: 'Plugin that uses provider for LLM-powered operations',

  operations: {
    async Think(args, ctx) {
      const text = args.arg0 ? valueToString(args.arg0) : valueToString(ctx.implicitContext);
      // Call back into the LLM provider
      const result = await ctx.provider.execute('CoT', text, {}, ctx.tags);
      return result;
    },

    async Research(args, ctx) {
      const query = args.arg0 ? valueToString(args.arg0) : valueToString(ctx.implicitContext);
      const result = await ctx.provider.search(query, ctx.tags);
      return result;
    },

    async GetContext(args, ctx) {
      return ctx.implicitContext;
    },
  },
};

module.exports = plugin;
