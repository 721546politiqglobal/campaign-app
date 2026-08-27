export interface RequiredDisclosure {
  disclosureText: string;
  placement: string;
}

const DEFAULT_LABEL = 'This content was generated or substantially altered using AI.';
const DEFAULT_PLACEMENT = 'overlay';

// Publishing must attach every distinct disclosure's text, not just one — kept
// generic (dedup + join) even though a content item now carries at most one
// disclosure record, since combineDisclosureText's contract is "any set of
// disclosure records," not "exactly the current gate's shape."
export function combineDisclosureText(records: { disclosureText: string }[]): string {
  return [...new Set(records.map(r => r.disclosureText).filter(Boolean))].join('\n\n');
}

export class DisclosureEngine {
  requiredFor(isAiGenerated: boolean, campaignDefaultText: string | null): RequiredDisclosure | null {
    if (!isAiGenerated) return null;
    const text = campaignDefaultText?.trim();
    return { disclosureText: text || DEFAULT_LABEL, placement: DEFAULT_PLACEMENT };
  }
}
