import { describe, it, expect } from 'vitest';
import { verifyWebhookSignature, shouldSyncFile } from './github';

describe('verifyWebhookSignature', () => {
  const secret = 'test-secret';
  const payload = '{"action":"push"}';

  it('should verify valid GitHub signature', async () => {
    // Generate valid HMAC-SHA256 signature
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const signatureBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
    const hashArray = Array.from(new Uint8Array(signatureBuffer));
    const hash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    const signature = `sha256=${hash}`;

    const isValid = await verifyWebhookSignature(payload, signature, secret);
    expect(isValid).toBe(true);
  });

  it('should reject tampered payload', async () => {
    const invalidSignature = 'sha256=0000000000000000000000000000000000000000000000000000000000000000';
    const isValid = await verifyWebhookSignature(payload, invalidSignature, secret);
    expect(isValid).toBe(false);
  });

  it('should reject missing signature', async () => {
    const isValid = await verifyWebhookSignature(payload, null, secret);
    expect(isValid).toBe(false);
  });

  it('should reject wrong hash algorithm prefix', async () => {
    const invalidSignature = 'sha1=abc123';
    const isValid = await verifyWebhookSignature(invalidSignature, payload, secret);
    expect(isValid).toBe(false);
  });

  it('should handle empty payload with valid signature', async () => {
    const emptyPayload = '';
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const signatureBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(emptyPayload));
    const hashArray = Array.from(new Uint8Array(signatureBuffer));
    const hash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    const signature = `sha256=${hash}`;

    const isValid = await verifyWebhookSignature(emptyPayload, signature, secret);
    expect(isValid).toBe(true);
  });
});

describe('shouldSyncFile', () => {
  const defaultOpts = {
    textExtensions: ['md', 'txt', 'json', 'yaml', 'yml', 'toml', 'rst', 'adoc'],
    sensitiveFiles: ['.env', '.env.local', '.env.production', '.mcp.json', 'credentials.json', 'secrets.json', '.npmrc', '.pypirc'],
    skipDirs: ['node_modules', '.git', '.github', 'dist', 'build', '__pycache__'],
  };

  describe('valid text files', () => {
    it('should sync .md files', () => {
      expect(shouldSyncFile('README.md', defaultOpts)).toBe(true);
      expect(shouldSyncFile('path/to/doc.md', defaultOpts)).toBe(true);
    });

    it('should sync .txt files', () => {
      expect(shouldSyncFile('notes.txt', defaultOpts)).toBe(true);
    });

    it('should sync .json files', () => {
      expect(shouldSyncFile('config.json', defaultOpts)).toBe(true);
    });

    it('should sync .yaml and .yml files', () => {
      expect(shouldSyncFile('config.yaml', defaultOpts)).toBe(true);
      expect(shouldSyncFile('config.yml', defaultOpts)).toBe(true);
    });

    it('should sync .toml, .rst, .adoc files', () => {
      expect(shouldSyncFile('config.toml', defaultOpts)).toBe(true);
      expect(shouldSyncFile('doc.rst', defaultOpts)).toBe(true);
      expect(shouldSyncFile('article.adoc', defaultOpts)).toBe(true);
    });
  });

  describe('non-text files', () => {
    it('should not sync .js files', () => {
      expect(shouldSyncFile('script.js', defaultOpts)).toBe(false);
    });

    it('should not sync .ts files', () => {
      expect(shouldSyncFile('app.ts', defaultOpts)).toBe(false);
    });

    it('should not sync .py files', () => {
      expect(shouldSyncFile('main.py', defaultOpts)).toBe(false);
    });

    it('should not sync .exe files', () => {
      expect(shouldSyncFile('program.exe', defaultOpts)).toBe(false);
    });

    it('should not sync files without extensions', () => {
      expect(shouldSyncFile('Makefile', defaultOpts)).toBe(false);
    });
  });

  describe('directory filtering', () => {
    it('should not sync files in node_modules', () => {
      expect(shouldSyncFile('node_modules/package/README.md', defaultOpts)).toBe(false);
      expect(shouldSyncFile('path/node_modules/file.md', defaultOpts)).toBe(false);
    });

    it('should not sync files in .git', () => {
      expect(shouldSyncFile('.git/config', defaultOpts)).toBe(false);
      expect(shouldSyncFile('path/.git/HEAD.md', defaultOpts)).toBe(false);
    });

    it('should not sync files in .github', () => {
      expect(shouldSyncFile('.github/workflows/test.yml', defaultOpts)).toBe(false);
    });

    it('should not sync files in build directories', () => {
      expect(shouldSyncFile('dist/bundle.md', defaultOpts)).toBe(false);
      expect(shouldSyncFile('build/output.md', defaultOpts)).toBe(false);
      expect(shouldSyncFile('__pycache__/module.md', defaultOpts)).toBe(false);
    });
  });

  describe('sensitive files', () => {
    it('should not sync .env files', () => {
      expect(shouldSyncFile('.env', defaultOpts)).toBe(false);
      expect(shouldSyncFile('path/.env', defaultOpts)).toBe(false);
    });

    it('should not sync .env.* variants', () => {
      expect(shouldSyncFile('.env.local', defaultOpts)).toBe(false);
      expect(shouldSyncFile('.env.production', defaultOpts)).toBe(false);
      expect(shouldSyncFile('.env.development', defaultOpts)).toBe(false);
      expect(shouldSyncFile('.env.test', defaultOpts)).toBe(false);
    });

    it('should not sync credential files', () => {
      expect(shouldSyncFile('.mcp.json', defaultOpts)).toBe(false);
      expect(shouldSyncFile('credentials.json', defaultOpts)).toBe(false);
      expect(shouldSyncFile('secrets.json', defaultOpts)).toBe(false);
      expect(shouldSyncFile('.npmrc', defaultOpts)).toBe(false);
      expect(shouldSyncFile('.pypirc', defaultOpts)).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('should handle files with multiple dots', () => {
      expect(shouldSyncFile('archive.tar.gz', defaultOpts)).toBe(false); // .gz not in textExtensions
      expect(shouldSyncFile('config.test.json', defaultOpts)).toBe(true); // .json is in textExtensions
    });

    it('should be case insensitive for extensions', () => {
      expect(shouldSyncFile('README.MD', defaultOpts)).toBe(true);
      expect(shouldSyncFile('notes.TXT', defaultOpts)).toBe(true);
    });

    it('should be case insensitive for filenames', () => {
      expect(shouldSyncFile('.ENV', defaultOpts)).toBe(false);
      expect(shouldSyncFile('CREDENTIALS.JSON', defaultOpts)).toBe(false);
    });
  });
});
