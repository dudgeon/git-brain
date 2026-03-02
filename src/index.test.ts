import { describe, it, expect } from 'vitest';
import { extractChangedFiles, sanitizeInboxTitle } from './utils';

describe('extractChangedFiles', () => {
  describe('single commit', () => {
    it('should extract added and modified files', () => {
      const payload = {
        commits: [
          {
            added: ['docs/new-file.md', 'README.md'],
            modified: ['config.json'],
            removed: [],
          },
        ],
      };

      const result = extractChangedFiles(payload);
      expect(result.changed).toEqual(expect.arrayContaining(['docs/new-file.md', 'README.md', 'config.json']));
      expect(result.changed.length).toBe(3);
      expect(result.removed).toEqual([]);
    });

    it('should extract removed files', () => {
      const payload = {
        commits: [
          {
            added: [],
            modified: [],
            removed: ['old-doc.md', 'deprecated.txt'],
          },
        ],
      };

      const result = extractChangedFiles(payload);
      expect(result.changed).toEqual([]);
      expect(result.removed).toEqual(expect.arrayContaining(['old-doc.md', 'deprecated.txt']));
      expect(result.removed.length).toBe(2);
    });

    it('should filter out non-text files', () => {
      const payload = {
        commits: [
          {
            added: ['script.js', 'doc.md', 'binary.exe'],
            modified: ['image.png'],
            removed: [],
          },
        ],
      };

      const result = extractChangedFiles(payload);
      expect(result.changed).toEqual(['doc.md']);
      expect(result.removed).toEqual([]);
    });

    it('should filter out sensitive files', () => {
      const payload = {
        commits: [
          {
            added: ['.env', 'safe.md', 'credentials.json', 'notes.txt'],
            modified: ['.env.local', '.mcp.json'],
            removed: ['secrets.json', 'old-note.md'],
          },
        ],
      };

      const result = extractChangedFiles(payload);
      expect(result.changed).toEqual(expect.arrayContaining(['safe.md', 'notes.txt']));
      expect(result.changed.length).toBe(2);
      expect(result.removed).toEqual(['old-note.md']);
    });
  });

  describe('multiple commits', () => {
    it('should deduplicate files across commits', () => {
      const payload = {
        commits: [
          {
            added: ['doc.md'],
            modified: ['config.json'],
            removed: [],
          },
          {
            added: [],
            modified: ['doc.md', 'config.json'], // same files modified again
            removed: [],
          },
        ],
      };

      const result = extractChangedFiles(payload);
      expect(result.changed).toEqual(expect.arrayContaining(['doc.md', 'config.json']));
      expect(result.changed.length).toBe(2);
    });

    it('should prioritize changes over removals (file re-added)', () => {
      const payload = {
        commits: [
          {
            added: [],
            modified: [],
            removed: ['doc.md'],
          },
          {
            added: ['doc.md'], // re-added in next commit
            modified: [],
            removed: [],
          },
        ],
      };

      const result = extractChangedFiles(payload);
      expect(result.changed).toContain('doc.md');
      expect(result.removed).not.toContain('doc.md'); // should not be in removed
    });
  });

  describe('edge cases', () => {
    it('should handle empty commits array', () => {
      const payload = { commits: [] };
      const result = extractChangedFiles(payload);
      expect(result.changed).toEqual([]);
      expect(result.removed).toEqual([]);
    });

    it('should handle missing commits field', () => {
      const payload = {};
      const result = extractChangedFiles(payload);
      expect(result.changed).toEqual([]);
      expect(result.removed).toEqual([]);
    });

    it('should handle commits with missing fields', () => {
      const payload = {
        commits: [
          {
            // no added, modified, or removed fields
          },
        ],
      };
      const result = extractChangedFiles(payload);
      expect(result.changed).toEqual([]);
      expect(result.removed).toEqual([]);
    });

    it('should handle files with .env. prefix', () => {
      const payload = {
        commits: [
          {
            added: ['.env.development', '.env.staging', 'safe.md'],
            modified: [],
            removed: [],
          },
        ],
      };

      const result = extractChangedFiles(payload);
      expect(result.changed).toEqual(['safe.md']);
      expect(result.changed).not.toContain('.env.development');
      expect(result.changed).not.toContain('.env.staging');
    });

    it('should handle various text extensions', () => {
      const payload = {
        commits: [
          {
            added: ['doc.yaml', 'config.yml', 'readme.rst', 'guide.adoc', 'config.toml'],
            modified: [],
            removed: [],
          },
        ],
      };

      const result = extractChangedFiles(payload);
      expect(result.changed.length).toBe(5);
      expect(result.changed).toContain('doc.yaml');
      expect(result.changed).toContain('config.yml');
      expect(result.changed).toContain('readme.rst');
      expect(result.changed).toContain('guide.adoc');
      expect(result.changed).toContain('config.toml');
    });
  });
});

describe('sanitizeInboxTitle', () => {
  it('should convert to lowercase', () => {
    expect(sanitizeInboxTitle('My Important Note')).toBe('my-important-note');
  });

  it('should replace spaces with hyphens', () => {
    expect(sanitizeInboxTitle('grocery list')).toBe('grocery-list');
    expect(sanitizeInboxTitle('my   spaced   title')).toBe('my-spaced-title');
  });

  it('should replace special characters with hyphens', () => {
    expect(sanitizeInboxTitle('note@home')).toBe('note-home');
    expect(sanitizeInboxTitle('task#1')).toBe('task-1');
    expect(sanitizeInboxTitle('question?')).toBe('question');
  });

  it('should strip leading and trailing hyphens', () => {
    expect(sanitizeInboxTitle('---title---')).toBe('title');
    expect(sanitizeInboxTitle('!important!')).toBe('important');
  });

  it('should truncate to 80 characters', () => {
    const longTitle = 'a'.repeat(100);
    const result = sanitizeInboxTitle(longTitle);
    expect(result.length).toBe(80);
    expect(result).toBe('a'.repeat(80));
  });

  it('should handle empty string', () => {
    expect(sanitizeInboxTitle('')).toBe('');
  });

  it('should handle only special characters', () => {
    expect(sanitizeInboxTitle('!@#$%^&*()')).toBe('');
  });

  it('should preserve numbers', () => {
    expect(sanitizeInboxTitle('2024 goals')).toBe('2024-goals');
    expect(sanitizeInboxTitle('task123')).toBe('task123');
  });

  it('should handle unicode characters', () => {
    expect(sanitizeInboxTitle('café notes')).toBe('caf-notes');
    expect(sanitizeInboxTitle('日本語')).toBe('');
  });

  it('should collapse consecutive non-alphanumeric chars into single hyphen', () => {
    expect(sanitizeInboxTitle('title!!!with!!!marks')).toBe('title-with-marks');
    expect(sanitizeInboxTitle('test   &&&   more')).toBe('test-more');
  });

  it('should handle realistic note titles', () => {
    expect(sanitizeInboxTitle('Meeting notes - Q1 2024')).toBe('meeting-notes-q1-2024');
    expect(sanitizeInboxTitle('TODO: Fix bug #42')).toBe('todo-fix-bug-42');
    expect(sanitizeInboxTitle('Ideas for new feature')).toBe('ideas-for-new-feature');
  });
});
