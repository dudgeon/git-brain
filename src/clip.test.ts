import { describe, it, expect } from 'vitest';
import { buildClipFrontmatter } from './utils';

describe('buildClipFrontmatter', () => {
  it('should build correct YAML frontmatter with all fields', () => {
    const fm = buildClipFrontmatter(
      'https://example.com/article',
      'Test Article',
      'for school project',
    );
    expect(fm).toContain('source: clip');
    expect(fm).toContain('url: https://example.com/article');
    expect(fm).toContain('date: 20');
    expect(fm).toContain('title: "Test Article"');
    expect(fm).toContain('context: "for school project"');
    expect(fm).toMatch(/^---\n/);
    expect(fm).toMatch(/\n---$/);
  });

  it('should omit title when not provided', () => {
    const fm = buildClipFrontmatter('https://example.com');
    expect(fm).toContain('source: clip');
    expect(fm).toContain('url: https://example.com');
    expect(fm).not.toContain('title:');
    expect(fm).not.toContain('context:');
  });

  it('should omit context when not provided', () => {
    const fm = buildClipFrontmatter('https://example.com', 'Title');
    expect(fm).toContain('title: "Title"');
    expect(fm).not.toContain('context:');
  });

  it('should omit context when empty string', () => {
    const fm = buildClipFrontmatter('https://example.com', 'Title', '');
    expect(fm).not.toContain('context:');
  });

  it('should escape quotes in title', () => {
    const fm = buildClipFrontmatter('https://example.com', 'He said "hello"');
    expect(fm).toContain('title: "He said \\"hello\\""');
  });

  it('should escape quotes in context', () => {
    const fm = buildClipFrontmatter('https://example.com', 'Title', 'about "AI" stuff');
    expect(fm).toContain('context: "about \\"AI\\" stuff"');
  });

  it('should have a valid ISO date', () => {
    const fm = buildClipFrontmatter('https://example.com');
    const dateMatch = fm.match(/date: (.+)/);
    expect(dateMatch).toBeTruthy();
    expect(new Date(dateMatch![1]).getTime()).not.toBeNaN();
  });
});
