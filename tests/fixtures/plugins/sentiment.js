/**
 * Test JS plugin — a sentiment analysis skill.
 * Demonstrates the OrchidPlugin interface.
 *
 * Self-contained: constructs OrchidValue objects directly.
 * Real plugins would import from 'orchid-lang'.
 */

function orchidString(value) { return { kind: 'string', value }; }
function orchidNumber(value) { return { kind: 'number', value }; }
function orchidDict(entries) { return { kind: 'dict', entries }; }
function valueToString(v) {
  if (v.kind === 'string') return v.value;
  if (v.kind === 'number') return String(v.value);
  if (v.kind === 'null') return '';
  return String(v.value ?? '');
}

const plugin = {
  name: 'sentiment',
  description: 'Sentiment analysis operations',

  operations: {
    async Analyze(args, ctx) {
      const text = args.arg0 ? valueToString(args.arg0) : valueToString(ctx.implicitContext);
      const lower = text.toLowerCase();
      let label = 'neutral';
      if (lower.includes('love') || lower.includes('great') || lower.includes('amazing')) {
        label = 'positive';
      } else if (lower.includes('hate') || lower.includes('terrible') || lower.includes('awful')) {
        label = 'negative';
      }
      return orchidString(label);
    },

    async Score(args, ctx) {
      const text = args.arg0 ? valueToString(args.arg0) : valueToString(ctx.implicitContext);
      const lower = text.toLowerCase();
      let score = 0.0;
      if (lower.includes('love') || lower.includes('great')) score = 0.8;
      if (lower.includes('amazing')) score = 1.0;
      if (lower.includes('hate') || lower.includes('terrible')) score = -0.8;
      if (lower.includes('awful')) score = -1.0;
      return orchidNumber(score);
    },

    async Full(args, ctx) {
      const text = args.arg0 ? valueToString(args.arg0) : valueToString(ctx.implicitContext);
      const label = await plugin.operations.Analyze(args, ctx);
      const score = await plugin.operations.Score(args, ctx);
      const entries = new Map();
      entries.set('text', orchidString(text));
      entries.set('label', label);
      entries.set('score', score);
      return orchidDict(entries);
    },
  },
};

module.exports = plugin;
