// Pure validation for the manual-entry form, shared by the server action and
// its tests. Returns error *codes*; the action maps them to translated text.
export const MAX_HEADLINE_LEN = 1000;
export const MAX_SOURCE_LEN = 200;
export const MAX_URL_LEN = 2048;

export interface ManualEntryValues { headline: string; source: string; url: string }

export type ManualEntryErrorCode =
  | 'headlineRequired' | 'headlineTooLong'
  | 'sourceRequired' | 'sourceTooLong'
  | 'urlInvalid';

export type ManualEntryFieldErrors = Partial<Record<keyof ManualEntryValues, ManualEntryErrorCode>>;

export function isHttpUrl(value: string): boolean {
  if (value.length > MAX_URL_LEN) return false;
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

export function validateManualEntry(values: ManualEntryValues): ManualEntryFieldErrors {
  const errors: ManualEntryFieldErrors = {};
  if (!values.headline) errors.headline = 'headlineRequired';
  else if (values.headline.length > MAX_HEADLINE_LEN) errors.headline = 'headlineTooLong';
  if (!values.source) errors.source = 'sourceRequired';
  else if (values.source.length > MAX_SOURCE_LEN) errors.source = 'sourceTooLong';
  if (values.url && !isHttpUrl(values.url)) errors.url = 'urlInvalid';
  return errors;
}

// Trims an excerpt for the rebuttal brief: at most `max` characters, cut at a
// word boundary so the URL never carries a half word.
export function excerptForBrief(excerpt: string, max = 200): string {
  const text = excerpt.replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trim() + '…';
}
