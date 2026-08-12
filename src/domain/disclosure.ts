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

// Publishing must attach every distinct jurisdiction's required text, not just
// one — a content item can target multiple jurisdictions with different rules.
export function combineDisclosureText(records: { disclosureText: string }[]): string {
  return [...new Set(records.map(r => r.disclosureText).filter(Boolean))].join('\n\n');
}

export class DisclosureEngine {
  constructor(private rules: DisclosureRulesRepo) {}

  async requiredFor(jurisdictions: string[], isAiGenerated: boolean): Promise<RequiredDisclosure[]> {
    if (!isAiGenerated) return [];
    const out: RequiredDisclosure[] = [];
    for (const j of new Set(jurisdictions)) {
      const rule = await this.rules.get(j);
      // No rule row means "not configured yet," not "exempt" — only an
      // explicit requiresAiLabel: false on a real rule is a genuine opt-out.
      if (rule && !rule.requiresAiLabel) continue;
      out.push({
        jurisdiction: j,
        disclosureText: rule?.requiredText ?? DEFAULT_LABEL,
        placement: rule?.placement ?? 'overlay',
        needsLegalReview: rule?.needsLegalReview ?? true,
      });
    }
    return out;
  }
}
