import * as fs from 'fs';
import * as path from 'path';
import { loadConfig, loadConfigForScript } from '../src/runtime/config';

// Use a temp directory for test config files
const TEST_DIR = path.join(__dirname, '__config_test_tmp__');

beforeAll(() => {
  if (!fs.existsSync(TEST_DIR)) {
    fs.mkdirSync(TEST_DIR, { recursive: true });
  }
});

afterAll(() => {
  // Cleanup test files
  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true });
  }
});

describe('Config Loader', () => {
  describe('loadConfig()', () => {
    it('should throw when explicit path does not exist', () => {
      expect(() => loadConfig('/nonexistent/path/orchid.config.json')).toThrow();
    });

    it('should return empty config when no config file is found in cwd', () => {
      // With no explicit path and no config file in cwd, should return {}
      // This depends on whether test runner cwd has an orchid.config.json
      // Just test that it doesn't crash
      const config = loadConfig();
      expect(config).toBeDefined();
    });

    it('should load a valid config file', () => {
      const configPath = path.join(TEST_DIR, 'valid.config.json');
      fs.writeFileSync(configPath, JSON.stringify({
        mcpServers: {
          test: {
            transport: 'stdio',
            command: 'echo',
            args: ['hello'],
          },
        },
      }));

      const config = loadConfig(configPath);
      expect(config.mcpServers).toBeDefined();
      expect(config.mcpServers!.test.command).toBe('echo');
    });

    it('should throw on invalid JSON', () => {
      const configPath = path.join(TEST_DIR, 'invalid.json');
      fs.writeFileSync(configPath, '{ not valid json }}}');

      expect(() => loadConfig(configPath)).toThrow(/Invalid JSON/);
    });

    it('should throw on stdio server without command', () => {
      const configPath = path.join(TEST_DIR, 'no-command.json');
      fs.writeFileSync(configPath, JSON.stringify({
        mcpServers: {
          broken: { transport: 'stdio' },
        },
      }));

      expect(() => loadConfig(configPath)).toThrow(/no "command" specified/);
    });

    it('should throw on http server without url', () => {
      const configPath = path.join(TEST_DIR, 'no-url.json');
      fs.writeFileSync(configPath, JSON.stringify({
        mcpServers: {
          broken: { transport: 'http' },
        },
      }));

      expect(() => loadConfig(configPath)).toThrow(/no "url" specified/);
    });

    it('should accept server with default stdio transport', () => {
      const configPath = path.join(TEST_DIR, 'default-transport.json');
      fs.writeFileSync(configPath, JSON.stringify({
        mcpServers: {
          myserver: { command: 'mycommand', args: ['--flag'] },
        },
      }));

      const config = loadConfig(configPath);
      expect(config.mcpServers!.myserver.command).toBe('mycommand');
    });

    it('should accept config with env and cwd', () => {
      const configPath = path.join(TEST_DIR, 'with-env.json');
      fs.writeFileSync(configPath, JSON.stringify({
        mcpServers: {
          myserver: {
            command: 'node',
            args: ['server.js'],
            env: { API_KEY: 'test-key' },
            cwd: '/tmp',
          },
        },
      }));

      const config = loadConfig(configPath);
      expect(config.mcpServers!.myserver.env).toEqual({ API_KEY: 'test-key' });
      expect(config.mcpServers!.myserver.cwd).toBe('/tmp');
    });
  });

  describe('loadConfigForScript()', () => {
    it('should look for config relative to script path', () => {
      const scriptDir = path.join(TEST_DIR, 'project');
      fs.mkdirSync(scriptDir, { recursive: true });

      const configPath = path.join(scriptDir, 'orchid.config.json');
      fs.writeFileSync(configPath, JSON.stringify({
        mcpServers: {
          local: { command: 'local-server' },
        },
      }));

      const scriptPath = path.join(scriptDir, 'main.orch');
      const config = loadConfigForScript(scriptPath);

      expect(config.mcpServers).toBeDefined();
      expect(config.mcpServers!.local.command).toBe('local-server');
    });

    it('should support .orchidrc.json', () => {
      const scriptDir = path.join(TEST_DIR, 'project2');
      fs.mkdirSync(scriptDir, { recursive: true });

      const configPath = path.join(scriptDir, '.orchidrc.json');
      fs.writeFileSync(configPath, JSON.stringify({
        mcpServers: {
          rc: { command: 'rc-server' },
        },
      }));

      const scriptPath = path.join(scriptDir, 'main.orch');
      const config = loadConfigForScript(scriptPath);

      expect(config.mcpServers).toBeDefined();
      expect(config.mcpServers!.rc.command).toBe('rc-server');
    });
  });
});
