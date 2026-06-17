export interface DisclosureRule {
  jurisdiction: string;
  requiresAiLabel: boolean;
  requiredText: string | null;
  placement: string;
  blackoutDaysBeforeElection: number | null;
  needsLegalReview: boolean;
}

export interface DisclosureRulesRepo {
  get(jurisdiction: string): Promise<DisclosureRule | null>;
  all(): Promise<DisclosureRule[]>;
}

export interface RequiredDisclosure {
  jurisdiction: string;
  disclosureText: string;
  placement: string;
  needsLegalReview: boolean;
}

const DEFAULT_LABEL = 'This content was generated or substantially altered using AI.';

export class DisclosureEngine {
  constructor(private rules: DisclosureRulesRepo) {}

  async requiredFor(jurisdictions: string[], isAiGenerated: boolean): Promise<RequiredDisclosure[]> {
    if (!isAiGenerated) return [];
    const out: RequiredDisclosure[] = [];
    for (const j of jurisdictions) {
      const rule = await this.rules.get(j);
      if (!rule || !rule.requiresAiLabel) continue;
      out.push({
        jurisdiction: j,
        disclosureText: rule.requiredText ?? DEFAULT_LABEL,
        placement: rule.placement,
        needsLegalReview: rule.needsLegalReview,
      });
    }
    return out;
  }
}
