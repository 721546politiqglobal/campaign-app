import { billingPeriodStart } from '@/lib/billing-period';

export type QuotaFeature = 'content' | 'video' | 'avatar';

export class QuotaExceeded extends Error {
  feature: QuotaFeature;
  constructor(feature: QuotaFeature, message: string) {
    super(message);
    this.feature = feature;
  }
}

export interface QuotaRepo {
  incrementFeatureUsage(
    campaignId: string,
    feature: 'content' | 'video',
    periodStart: Date,
    limit: number | null,
  ): Promise<boolean>;
  countAvatars(campaignId: string): Promise<number>;
}

export class QuotaGate {
  constructor(private repo: QuotaRepo) {}

  async checkAndIncrement(
    campaignId: string,
    feature: 'content' | 'video',
    periodStart: Date,
    limit: number | null,
  ): Promise<void> {
    const ok = await this.repo.incrementFeatureUsage(campaignId, feature, periodStart, limit);
    if (!ok) {
      const label = feature === 'content' ? 'content pieces' : 'videos';
      const period = feature === 'content' ? 'this month' : 'today';
      throw new QuotaExceeded(feature, `You've used all ${label} included in your plan for ${period}. Upgrade your plan for more.`);
    }
  }

  async checkAvatarCap(campaignId: string, limit: number | null): Promise<void> {
    if (limit === null) return;
    const count = await this.repo.countAvatars(campaignId);
    if (count >= limit) {
      throw new QuotaExceeded('avatar', `Your plan includes up to ${limit} avatars. Delete one or upgrade your plan to create another.`);
    }
  }
}

export function videoPeriodStart(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export function contentPeriodStart(currentPeriodEnd: string | null, now: Date = new Date()): Date {
  return billingPeriodStart(currentPeriodEnd, now);
}
