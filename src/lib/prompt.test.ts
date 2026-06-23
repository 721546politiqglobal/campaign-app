import { describe, it, expect } from 'vitest';
import { buildCandidatePrompt, CONTENT_COST_CENTS } from './prompt';
import type { CandidateProfile } from '@/domain/types';

const profile: CandidateProfile = {
  id: 'test-id',
  campaignId: 'camp-1',
  fullName: 'Maria Rivera',
  preferredName: 'Maria',
  office: 'California State Assembly',
  district: 'District 12',
  party: 'Democratic',
  bio: 'A lifelong community advocate.',
  keyPositions: ['Expand healthcare access', 'Lower housing costs'],
  voiceTone: 'conversational',
  targetAudience: 'Working families in the San Fernando Valley',
  tagline: 'A Voice for District 12',
  opponentName: 'John Smith',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

describe('buildCandidatePrompt', () => {
  it('includes the candidate full name', () => {
    const prompt = buildCandidatePrompt(profile, 'social_post');
    expect(prompt).toContain('Maria Rivera');
  });

  it('includes all key positions', () => {
    const prompt = buildCandidatePrompt(profile, 'social_post');
    expect(prompt).toContain('Expand healthcare access');
    expect(prompt).toContain('Lower housing costs');
  });

  it('includes the opponent name', () => {
    const prompt = buildCandidatePrompt(profile, 'social_post');
    expect(prompt).toContain('John Smith');
  });

  it('instructs third person for press_release', () => {
    const prompt = buildCandidatePrompt(profile, 'press_release');
    expect(prompt.toLowerCase()).toContain('third person');
  });

  it('does not contain placeholder brackets', () => {
    const prompt = buildCandidatePrompt(profile, 'email');
    expect(prompt).not.toMatch(/\[.*?\]/);
  });
});

describe('CONTENT_COST_CENTS', () => {
  it('has entries for all content types', () => {
    const types = ['social_post', 'sms', 'email', 'press_release', 'ad_copy', 'talking_points', 'reel'];
    types.forEach(t => {
      expect(CONTENT_COST_CENTS[t]).toBeGreaterThan(0);
    });
  });
});
