import { describe, it, expect } from 'vitest';
import {
  validateAlias,
  generateConfirmationCode,
  normalizeEmailAddress,
  parseEmailRecipient,
  buildEmailFrontmatter,
} from './utils';

describe('validateAlias', () => {
  describe('valid aliases', () => {
    it('should accept simple lowercase aliases', () => {
      expect(validateAlias('dan')).toEqual({ valid: true });
      expect(validateAlias('alice')).toEqual({ valid: true });
      expect(validateAlias('bob123')).toEqual({ valid: true });
    });

    it('should accept aliases with dots and hyphens', () => {
      expect(validateAlias('dan.smith')).toEqual({ valid: true });
      expect(validateAlias('my-brain')).toEqual({ valid: true });
      expect(validateAlias('user.name-123')).toEqual({ valid: true });
    });

    it('should accept boundary lengths', () => {
      expect(validateAlias('abc')).toEqual({ valid: true }); // min 3
      expect(validateAlias('a'.repeat(30))).toEqual({ valid: true }); // max 30
    });
  });

  describe('invalid aliases', () => {
    it('should reject too short aliases', () => {
      const result = validateAlias('ab');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('at least 3');
    });

    it('should reject too long aliases', () => {
      const result = validateAlias('a'.repeat(31));
      expect(result.valid).toBe(false);
      expect(result.error).toContain('at most 30');
    });

    it('should reject uppercase', () => {
      const result = validateAlias('Dan');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('lowercase');
    });

    it('should reject aliases starting with dot or hyphen', () => {
      expect(validateAlias('-dan').valid).toBe(false);
      expect(validateAlias('.dan').valid).toBe(false);
    });

    it('should reject aliases ending with dot or hyphen', () => {
      expect(validateAlias('dan-').valid).toBe(false);
      expect(validateAlias('dan.').valid).toBe(false);
    });

    it('should reject consecutive dots or hyphens', () => {
      expect(validateAlias('dan..smith').valid).toBe(false);
      expect(validateAlias('dan--smith').valid).toBe(false);
      expect(validateAlias('dan.-smith').valid).toBe(false);
    });

    it('should reject special characters', () => {
      expect(validateAlias('dan@smith').valid).toBe(false);
      expect(validateAlias('dan smith').valid).toBe(false);
      expect(validateAlias('dan_smith').valid).toBe(false);
      expect(validateAlias('dan+smith').valid).toBe(false);
    });

    it('should reject reserved words', () => {
      const reserved = ['brain', 'admin', 'support', 'postmaster', 'root', 'api', 'app'];
      for (const word of reserved) {
        const result = validateAlias(word);
        expect(result.valid).toBe(false);
        expect(result.error).toContain('reserved');
      }
    });
  });
});

describe('generateConfirmationCode', () => {
  it('should generate a 6-character code', () => {
    const code = generateConfirmationCode();
    expect(code).toHaveLength(6);
  });

  it('should only contain uppercase alphanumeric characters (no confusables)', () => {
    // Run multiple times to increase coverage
    for (let i = 0; i < 50; i++) {
      const code = generateConfirmationCode();
      expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
      // Should NOT contain I, O, 0, or 1
      expect(code).not.toMatch(/[IO01]/);
    }
  });

  it('should generate different codes', () => {
    const codes = new Set<string>();
    for (let i = 0; i < 20; i++) {
      codes.add(generateConfirmationCode());
    }
    // At least 15 unique codes out of 20 (highly likely with 31^6 = ~887M combinations)
    expect(codes.size).toBeGreaterThanOrEqual(15);
  });
});

describe('normalizeEmailAddress', () => {
  it('should handle bare email addresses', () => {
    expect(normalizeEmailAddress('Dan@Gmail.com')).toBe('dan@gmail.com');
  });

  it('should extract from display name format', () => {
    expect(normalizeEmailAddress('"Dan Smith" <dan@gmail.com>')).toBe('dan@gmail.com');
    expect(normalizeEmailAddress('Dan <DAN@GMAIL.COM>')).toBe('dan@gmail.com');
  });

  it('should trim whitespace', () => {
    expect(normalizeEmailAddress('  dan@gmail.com  ')).toBe('dan@gmail.com');
  });
});

describe('parseEmailRecipient', () => {
  it('should parse sub-address format (brain+uuid)', () => {
    const result = parseEmailRecipient('brain+a1b2c3d4-e5f6-7890-abcd-ef1234567890@brainstem.cc');
    expect(result).toEqual({ type: 'uuid', uuid: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' });
  });

  it('should parse vanity aliases', () => {
    const result = parseEmailRecipient('dan@brainstem.cc');
    expect(result).toEqual({ type: 'alias', localPart: 'dan' });
  });

  it('should handle case-insensitive domain', () => {
    const result = parseEmailRecipient('brain+a1b2c3d4-e5f6-7890-abcd-ef1234567890@BRAINSTEM.CC');
    expect(result).toEqual({ type: 'uuid', uuid: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' });
  });

  it('should return null for non-brainstem addresses', () => {
    expect(parseEmailRecipient('dan@gmail.com')).toBeNull();
    expect(parseEmailRecipient('brain+uuid@other.com')).toBeNull();
  });

  it('should return null for empty string', () => {
    expect(parseEmailRecipient('')).toBeNull();
  });

  it('should handle brain+ without valid UUID as alias', () => {
    // "brain+short" is not a valid UUID, so it falls through to alias
    const result = parseEmailRecipient('brain+short@brainstem.cc');
    expect(result).toEqual({ type: 'alias', localPart: 'brain+short' });
  });
});

describe('buildEmailFrontmatter', () => {
  it('should build correct YAML frontmatter', () => {
    const fm = buildEmailFrontmatter('dan@gmail.com', '2026-02-09T14:30:00Z', 'Test Subject');
    expect(fm).toContain('source: email');
    expect(fm).toContain('from: dan@gmail.com');
    expect(fm).toContain('date: 2026-02-09T14:30:00Z');
    expect(fm).toContain('subject: "Test Subject"');
    expect(fm).toMatch(/^---\n/);
    expect(fm).toMatch(/\n---$/);
  });

  it('should handle missing subject', () => {
    const fm = buildEmailFrontmatter('dan@gmail.com', '2026-02-09T14:30:00Z', undefined);
    expect(fm).toContain('subject: "(no subject)"');
  });

  it('should escape quotes in subject', () => {
    const fm = buildEmailFrontmatter('dan@gmail.com', '2026-02-09T14:30:00Z', 'He said "hello"');
    expect(fm).toContain('subject: "He said \\"hello\\""');
  });

  it('should use current date if date is undefined', () => {
    const fm = buildEmailFrontmatter('dan@gmail.com', undefined, 'Test');
    expect(fm).toContain('date: 20');
    // Should have a valid ISO date
    const dateMatch = fm.match(/date: (.+)/);
    expect(dateMatch).toBeTruthy();
    expect(new Date(dateMatch![1]).getTime()).not.toBeNaN();
  });
});
