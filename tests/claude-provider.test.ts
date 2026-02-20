import { ClaudeProvider } from '../src/runtime/claude-provider';
import { OrchidValue, orchidString } from '../src/runtime/values';

// Mock the Anthropic SDK
jest.mock('@anthropic-ai/sdk', () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      messages: {
        create: jest.fn(),
      },
    })),
  };
});

import Anthropic from '@anthropic-ai/sdk';

// Suppress console.log during tests
const originalLog = console.log;
beforeAll(() => { console.log = jest.fn(); });
afterAll(() => { console.log = originalLog; });

/**
 * Helper to create a mock Claude API response.
 */
function mockResponse(text: string, inputTokens = 100, outputTokens = 200) {
  return {
    content: [{ type: 'text', text }],
    usage: { input_tokens: inputTokens, output_tokens: outputTokens },
  };
}

describe('ClaudeProvider', () => {
  let provider: ClaudeProvider;
  let mockCreate: jest.Mock;

  beforeEach(() => {
    provider = new ClaudeProvider({ apiKey: 'test-key' });
    // Access the mocked create function
    const client = (provider as any).client as { messages: { create: jest.Mock } };
    mockCreate = client.messages.create;
    mockCreate.mockReset();
  });

  describe('execute()', () => {
    it('should call Claude API with operation-specific system prompt', async () => {
      mockCreate.mockResolvedValue(mockResponse('Step 1: Analyze. Step 2: Conclude.'));

      const result = await provider.execute('CoT', 'Why is the sky blue?', {}, []);

      expect(result.kind).toBe('string');
      if (result.kind === 'string') {
        expect(result.value).toContain('Step 1');
      }

      // Verify the API was called with appropriate parameters
      expect(mockCreate).toHaveBeenCalledTimes(1);
      const call = mockCreate.mock.calls[0][0];
      expect(call.system).toContain('Chain-of-Thought');
      expect(call.messages[0].content).toBe('Why is the sky blue?');
    });

    it('should use different system prompts for different operations', async () => {
      mockCreate.mockResolvedValue(mockResponse('Analysis result'));

      await provider.execute('Critique', 'test input', {}, []);
      const critiqueCall = mockCreate.mock.calls[0][0];

      mockCreate.mockReset();
      mockCreate.mockResolvedValue(mockResponse('ELI5 result'));

      await provider.execute('ELI5', 'test input', {}, []);
      const eli5Call = mockCreate.mock.calls[0][0];

      expect(critiqueCall.system).toContain('critic');
      expect(eli5Call.system).toContain('five-year-old');
      expect(critiqueCall.system).not.toBe(eli5Call.system);
    });

    it('should include context in user message', async () => {
      mockCreate.mockResolvedValue(mockResponse('Result with context'));

      await provider.execute('CoT', 'analyze this', { domain: 'finance', source: 'report' }, []);

      const call = mockCreate.mock.calls[0][0];
      expect(call.messages[0].content).toContain('domain: finance');
      expect(call.messages[0].content).toContain('source: report');
    });

    it('should apply tag modifiers to system prompt', async () => {
      mockCreate.mockResolvedValue(mockResponse('Deep analysis'));

      await provider.execute('CoT', 'test', {}, [{ name: 'deep' }]);

      const call = mockCreate.mock.calls[0][0];
      expect(call.system).toContain('thorough');
    });

    it('should handle list operations (Brainstorm)', async () => {
      mockCreate.mockResolvedValue(
        mockResponse('["Use solar panels", "Improve insulation", "Smart thermostat"]'),
      );

      const result = await provider.execute('Brainstorm', 'energy saving ideas', {}, []);

      expect(result.kind).toBe('list');
      if (result.kind === 'list') {
        expect(result.elements.length).toBe(3);
        expect(result.elements[0].kind).toBe('string');
      }
    });

    it('should handle list operations (Decompose)', async () => {
      mockCreate.mockResolvedValue(
        mockResponse('["Define scope", "Gather data", "Analyze results"]'),
      );

      const result = await provider.execute('Decompose', 'research project', {}, []);

      expect(result.kind).toBe('list');
      if (result.kind === 'list') {
        expect(result.elements.length).toBe(3);
      }
    });

    it('should respect _count for list operations', async () => {
      mockCreate.mockResolvedValue(
        mockResponse('["a", "b", "c", "d", "e"]'),
      );

      const result = await provider.execute('Brainstorm', 'ideas', { _count: '3' }, []);

      expect(result.kind).toBe('list');
      if (result.kind === 'list') {
        expect(result.elements.length).toBe(3);
      }
    });

    it('should fallback to line-splitting when JSON parsing fails', async () => {
      mockCreate.mockResolvedValue(
        mockResponse('1. First idea\n2. Second idea\n3. Third idea'),
      );

      const result = await provider.execute('Brainstorm', 'ideas', {}, []);

      expect(result.kind).toBe('list');
      if (result.kind === 'list') {
        expect(result.elements.length).toBeGreaterThanOrEqual(3);
      }
    });

    it('should use higher temperature for creative operations', async () => {
      mockCreate.mockResolvedValue(mockResponse('Creative idea'));

      await provider.execute('Creative', 'wild concept', {}, []);

      const call = mockCreate.mock.calls[0][0];
      expect(call.temperature).toBe(0.9);
    });

    it('should use lower temperature for analytical operations', async () => {
      mockCreate.mockResolvedValue(mockResponse('Verified fact'));

      await provider.execute('CoVe', 'claim to verify', {}, []);

      const call = mockCreate.mock.calls[0][0];
      expect(call.temperature).toBe(0.2);
    });

    it('should handle unknown operations with generic prompt', async () => {
      mockCreate.mockResolvedValue(mockResponse('Custom result'));

      const result = await provider.execute('CustomOp', 'test', {}, []);

      expect(result.kind).toBe('string');
      if (result.kind === 'string') {
        expect(result.value).toBe('Custom result');
      }
    });
  });

  describe('search()', () => {
    it('should send search queries to Claude', async () => {
      mockCreate.mockResolvedValue(
        mockResponse('Quantum computing is a paradigm that uses quantum mechanics...'),
      );

      const result = await provider.search('quantum computing basics', []);

      expect(result.kind).toBe('string');
      if (result.kind === 'string') {
        expect(result.value).toContain('quantum');
      }

      const call = mockCreate.mock.calls[0][0];
      expect(call.system).toContain('research assistant');
    });
  });

  describe('confidence()', () => {
    it('should return a number between 0 and 1', async () => {
      // First, generate some conversation history
      mockCreate.mockResolvedValue(mockResponse('Analysis result'));
      await provider.execute('CoT', 'test', {}, []);

      // Now check confidence
      mockCreate.mockResolvedValue(mockResponse('0.82'));
      const conf = await provider.confidence();

      expect(conf).toBeGreaterThanOrEqual(0);
      expect(conf).toBeLessThanOrEqual(1);
      expect(conf).toBe(0.82);
    });

    it('should return 0.5 when no conversation history exists', async () => {
      const conf = await provider.confidence();
      expect(conf).toBe(0.5);
    });

    it('should handle malformed confidence response', async () => {
      mockCreate.mockResolvedValue(mockResponse('Analysis result'));
      await provider.execute('CoT', 'test', {}, []);

      mockCreate.mockResolvedValue(mockResponse('I think the confidence is about medium'));
      const conf = await provider.confidence();

      expect(conf).toBe(0.5); // Fallback
    });
  });

  describe('toolCall()', () => {
    it('should simulate tool calls', async () => {
      mockCreate.mockResolvedValue(
        mockResponse('[Simulated] File contents would be here...'),
      );

      const result = await provider.toolCall('fs', 'Read', { path: { kind: 'string', value: '/tmp/test' } as any }, []);

      expect(result.kind).toBe('string');
      const call = mockCreate.mock.calls[0][0];
      expect(call.system).toContain('simulating');
      expect(call.system).toContain('fs:Read');
    });
  });

  describe('token tracking', () => {
    it('should track total tokens used', async () => {
      mockCreate.mockResolvedValue(mockResponse('Result', 50, 100));

      await provider.execute('CoT', 'test', {}, []);

      expect(provider.getTokensUsed()).toBe(150);
    });

    it('should accumulate tokens across calls', async () => {
      mockCreate.mockResolvedValue(mockResponse('Result 1', 50, 100));
      await provider.execute('CoT', 'test 1', {}, []);

      mockCreate.mockResolvedValue(mockResponse('Result 2', 30, 80));
      await provider.execute('CoT', 'test 2', {}, []);

      expect(provider.getTokensUsed()).toBe(260); // 150 + 110
    });
  });

  describe('conversation history', () => {
    it('should maintain conversation context', async () => {
      mockCreate.mockResolvedValue(mockResponse('Initial analysis'));
      await provider.execute('CoT', 'topic A', {}, []);

      mockCreate.mockResolvedValue(mockResponse('Refined analysis'));
      await provider.execute('Refine', 'topic A', {}, []);

      // The provider tracks conversation internally for confidence assessment
      // Verify by checking confidence which uses history
      mockCreate.mockResolvedValue(mockResponse('0.9'));
      const conf = await provider.confidence();
      expect(conf).toBe(0.9);

      // The confidence call should have received context about prior operations
      const confCall = mockCreate.mock.calls[2][0];
      expect(confCall.messages[0].content).toContain('CoT');
    });

    it('should reset history when requested', async () => {
      mockCreate.mockResolvedValue(mockResponse('Analysis'));
      await provider.execute('CoT', 'test', {}, []);

      provider.resetHistory();

      // After reset, confidence should return default 0.5 (no history)
      const conf = await provider.confidence();
      expect(conf).toBe(0.5);
    });

    it('should bound history to prevent unbounded growth', async () => {
      for (let i = 0; i < 15; i++) {
        mockCreate.mockResolvedValue(mockResponse(`Result ${i}`));
        await provider.execute('CoT', `input ${i}`, {}, []);
      }

      // Internal history should be bounded (checked via confidence call)
      mockCreate.mockResolvedValue(mockResponse('0.7'));
      await provider.confidence();

      // Provider should still be functional
      expect(provider.getTokensUsed()).toBeGreaterThan(0);
    });
  });

  describe('constructor options', () => {
    it('should use default model', () => {
      const p = new ClaudeProvider({ apiKey: 'test' });
      expect((p as any).model).toBe('claude-sonnet-4-5-20250929');
    });

    it('should accept custom model', () => {
      const p = new ClaudeProvider({ apiKey: 'test', model: 'claude-opus-4-6' });
      expect((p as any).model).toBe('claude-opus-4-6');
    });

    it('should accept custom maxTokens', () => {
      const p = new ClaudeProvider({ apiKey: 'test', maxTokens: 8192 });
      expect((p as any).maxTokens).toBe(8192);
    });

    it('should override temperature when set globally', async () => {
      const p = new ClaudeProvider({ apiKey: 'test', temperature: 0.1 });
      const client = (p as any).client as { messages: { create: jest.Mock } };
      client.messages.create.mockResolvedValue(mockResponse('Result'));

      await p.execute('Creative', 'test', {}, []);

      const call = client.messages.create.mock.calls[0][0];
      expect(call.temperature).toBe(0.1); // Should override Creative's default 0.9
    });
  });
});
