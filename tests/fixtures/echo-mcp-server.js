/**
 * Minimal MCP server fixture for integration testing.
 *
 * Exposes three tools:
 *   - echo: returns the input text as-is
 *   - add: adds two numbers
 *   - get_object: returns a structured JSON object
 *
 * Run with: node tests/fixtures/echo-mcp-server.js
 */

const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');

const server = new McpServer({
  name: 'echo-test-server',
  version: '1.0.0',
});

// Simple echo tool — returns the text input
server.tool(
  'echo',
  'Echo back the input text',
  { text: z.string() },
  async ({ text }) => ({
    content: [{ type: 'text', text }],
  }),
);

// Add tool — returns sum of two numbers
server.tool(
  'add',
  'Add two numbers together',
  { a: z.number(), b: z.number() },
  async ({ a, b }) => ({
    content: [{ type: 'text', text: String(a + b) }],
  }),
);

// Returns a structured JSON object as text
server.tool(
  'get_object',
  'Return a test object',
  { key: z.string() },
  async ({ key }) => ({
    content: [{
      type: 'text',
      text: JSON.stringify({
        key,
        items: ['alpha', 'beta', 'gamma'],
        count: 3,
        nested: { ok: true },
      }),
    }],
  }),
);

// Tool that always errors
server.tool(
  'fail',
  'Always returns an error',
  { message: z.string() },
  async ({ message }) => ({
    content: [{ type: 'text', text: message }],
    isError: true,
  }),
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error('Echo MCP server failed:', err);
  process.exit(1);
});
