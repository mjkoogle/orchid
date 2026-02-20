/**
 * Test plugin with setup/teardown lifecycle hooks.
 * Self-contained value constructors.
 */

function orchidString(value) { return { kind: 'string', value }; }
function orchidNumber(value) { return { kind: 'number', value }; }

let counter = 0;
let setupCalled = false;

const plugin = {
  name: 'stateful',
  description: 'Plugin with lifecycle hooks for testing',

  async setup(ctx) {
    setupCalled = true;
    counter = 0;
  },

  async teardown() {
    setupCalled = false;
    counter = 0;
  },

  operations: {
    async Increment(args, ctx) {
      counter++;
      return orchidNumber(counter);
    },

    async GetCount(args, ctx) {
      return orchidNumber(counter);
    },

    async WasSetup(args, ctx) {
      return orchidString(setupCalled ? 'yes' : 'no');
    },
  },
};

module.exports = plugin;
