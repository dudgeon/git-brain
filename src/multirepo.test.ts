import { describe, it, expect } from 'vitest';
import { resolveClipInstallation, parseRepositoryChanges } from './utils';

describe('resolveClipInstallation (ADR-011 Q3)', () => {
  const base = {
    defaultInstallationId: 'brain-default',
    allowedInstallationIds: ['brain-default', 'brain-a', 'brain-b'],
  };

  it('falls back to the default brain when no override is given', () => {
    const r = resolveClipInstallation({ ...base });
    expect(r).toEqual({ installationId: 'brain-default' });
  });

  it('honors a body `installation` override the user owns', () => {
    const r = resolveClipInstallation({ ...base, bodyInstallation: 'brain-a' });
    expect(r).toEqual({ installationId: 'brain-a' });
  });

  it('honors a body `brain` override the user owns', () => {
    const r = resolveClipInstallation({ ...base, bodyBrain: 'brain-b' });
    expect(r).toEqual({ installationId: 'brain-b' });
  });

  it('honors a URL override the user owns', () => {
    const r = resolveClipInstallation({ ...base, overrideInstallationId: 'brain-a' });
    expect(r).toEqual({ installationId: 'brain-a' });
  });

  it('prefers the body override over the URL override', () => {
    const r = resolveClipInstallation({ ...base, bodyInstallation: 'brain-a', overrideInstallationId: 'brain-b' });
    expect(r).toEqual({ installationId: 'brain-a' });
  });

  it('rejects an override the user does not own', () => {
    const r = resolveClipInstallation({ ...base, bodyBrain: 'someone-elses-brain' });
    expect('error' in r).toBe(true);
  });

  it('treats an empty-string override as no override (uses default)', () => {
    const r = resolveClipInstallation({ ...base, bodyInstallation: '', overrideInstallationId: null });
    expect(r).toEqual({ installationId: 'brain-default' });
  });
});

describe('parseRepositoryChanges (installation_repositories webhook)', () => {
  it('extracts added and removed repo full names', () => {
    const out = parseRepositoryChanges({
      repositories_added: [{ full_name: 'me/repo-a' }, { full_name: 'me/repo-b' }],
      repositories_removed: [{ full_name: 'me/old-repo' }],
    });
    expect(out.added).toEqual(['me/repo-a', 'me/repo-b']);
    expect(out.removed).toEqual(['me/old-repo']);
  });

  it('returns empty arrays when fields are missing', () => {
    expect(parseRepositoryChanges({})).toEqual({ added: [], removed: [] });
  });

  it('filters out entries without a full_name', () => {
    const out = parseRepositoryChanges({
      repositories_added: [{ full_name: 'me/ok' }, {}, { full_name: '' }],
    });
    expect(out.added).toEqual(['me/ok']);
    expect(out.removed).toEqual([]);
  });
});
