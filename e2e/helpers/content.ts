import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';

// Content lifecycle steps driven through the real UI (/content/new and the
// /content/[id] wizard, src/components/ContentEditor.tsx + ContentWizard.tsx).
// No DB shortcuts: each step is the click a user would make, and each helper
// waits until the UI shows the step has landed (or fails with the wizard's
// own error text).
//
// Which role can do what (src/lib/permissions.ts):
//   createDraft / submitForReview — any role (submit is the staff path; roles
//     that can approve see "Looks good" instead of "Submit for review").
//   approve — owner / manager / approver.
//   attachDisclosure / schedule — owner / manager.

export type DraftOptions = {
  /** Content type chip. Default 'social_post'. */
  type?: 'social_post' | 'reel' | 'press_release' | 'ad_copy' | 'talking_points';
  /**
   * Tick "AI-generated (adds required disclosure)". Default true, so the item
   * goes through the disclosure step (draft → approve → disclosure → schedule).
   * Ignored for reels, which are always AI-generated.
   */
  aiGenerated?: boolean;
  /** Language select. Default: the campaign's default (English in the seed). */
  locale?: 'en' | 'es';
};

const UUID = /\/content\/([0-9a-f-]{36})$/;

export const LABELS = {
  writeMyself: 'Write it myself',
  saveDraft: 'Save draft',
  aiCheckbox: 'AI-generated (adds required disclosure)',
  submit: 'Submit for review',
  approve: 'Looks good — Continue →',
  confirmDisclosure: 'Confirm disclosure — Continue →',
  scheduleLater: 'Schedule for later',
  scheduleButton: /^Schedule for (?!later)/,
  scheduledHeading: 'Scheduled',
};

/** Success toasts the wizard shows (src/messages/en.json). */
const TOASTS = { submitted: 'Sent for review', approved: 'Approved', disclosure: 'Disclosure attached' };

const TYPE_LABEL: Record<NonNullable<DraftOptions['type']>, string> = {
  social_post: 'Social post', reel: 'Reel', press_release: 'Press release', ad_copy: 'Ad copy', talking_points: 'Talking points',
};

/** The wizard's error alert (role=alert inside the wizard), if any. */
const wizardError = (page: Page) => page.locator('.wizard-error');

/** Fails with the wizard's own error text if one is showing. */
async function expectNoWizardError(page: Page) {
  if (await wizardError(page).count()) {
    throw new Error(`wizard error: ${await wizardError(page).innerText()}`);
  }
}

/**
 * Waits for a wizard step to land. The clicked button relabels to "Saving…"
 * while the action runs, so "button gone" alone passes too early; instead wait
 * for the action's success toast (shown in the same render that clears the
 * busy state, so the original button is back until the refresh lands), then
 * for `gone` to disappear (router.refresh rendered the next step). Fails with
 * the wizard's own error text if it shows one instead.
 */
async function waitForStep(page: Page, gone: ReturnType<Page['getByRole']>, toastText: string) {
  const toast = page.locator('.toast-stack').getByText(toastText, { exact: true });
  await expect(toast.or(wizardError(page)).first()).toBeVisible({ timeout: 15_000 });
  await expectNoWizardError(page);
  await expect(gone).toHaveCount(0, { timeout: 15_000 });
}

/** The /content/new form (scoped so e.g. "Language" doesn't hit the app header's switcher). */
export const editorForm = (page: Page) => page.locator('form.editor-layout');

/** Selects a content-type chip (its radio is visually hidden, so the label is clicked). */
export async function pickType(page: Page, type: NonNullable<DraftOptions['type']>) {
  await editorForm(page).locator('label.chip', { hasText: TYPE_LABEL[type] }).click();
  await expect(editorForm(page).getByRole('radio', { name: TYPE_LABEL[type], exact: true })).toBeChecked();
}

/** /content/new → "Write it myself" → title + body → Save draft. Returns the new item's id. */
export async function createDraft(page: Page, title: string, body = 'E2E body text', opts: DraftOptions = {}): Promise<string> {
  const { type = 'social_post', aiGenerated = true, locale } = opts;
  await page.goto('/content/new');
  const form = editorForm(page);
  await pickType(page, type);
  if (locale) await form.getByLabel('Language').selectOption(locale);
  await form.getByRole('button', { name: LABELS.writeMyself }).click();
  await form.getByLabel(/^Title/).fill(title);
  await form.getByLabel(/^Body/).fill(body);
  if (type !== 'reel') await form.getByRole('checkbox', { name: LABELS.aiCheckbox }).setChecked(aiGenerated);
  await form.getByRole('button', { name: LABELS.saveDraft }).click();
  await page.waitForURL(UUID);
  return page.url().match(UUID)![1];
}

/** Staff path: "Submit for review" on a draft; returns once the item is in review. */
export async function submitForReview(page: Page, id: string): Promise<void> {
  await page.goto(`/content/${id}`);
  await page.getByRole('button', { name: LABELS.submit }).click();
  await waitForStep(page, page.getByRole('button', { name: LABELS.submit }), TOASTS.submitted);
}

/** "Looks good — Continue →" on a draft / in-review item (owner, manager or approver). */
export async function approve(page: Page, id: string): Promise<void> {
  await page.goto(`/content/${id}`);
  await page.getByRole('button', { name: LABELS.approve }).click();
  await waitForStep(page, page.getByRole('button', { name: LABELS.approve }), TOASTS.approved);
}

/**
 * Confirms the required AI disclosure on an approved AI item (owner or
 * manager). `text` replaces the pre-filled campaign default when given.
 */
export async function attachDisclosure(page: Page, id: string, text?: string): Promise<void> {
  await page.goto(`/content/${id}`);
  await expect(page.getByRole('heading', { name: 'Required AI disclosure' })).toBeVisible();
  if (text !== undefined) await page.locator('textarea.wizard-disclosure-text').fill(text);
  await page.getByRole('button', { name: LABELS.confirmDisclosure }).click();
  await waitForStep(page, page.getByRole('button', { name: LABELS.confirmDisclosure }), TOASTS.disclosure);
}

/** The wall-clock time of `when` in `timeZone`, as a datetime-local value ("YYYY-MM-DDTHH:mm"). */
export function zonedLocalInput(when: Date, timeZone: string): string {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(when).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

/**
 * Publish step → "Schedule for later" → time zone + date/time → Schedule
 * (owner or manager), on the platforms the wizard pre-selects (the campaign's
 * connected ones). Returns once the "Scheduled" card shows.
 */
export async function schedule(page: Page, id: string, when: Date, timezone: string): Promise<void> {
  await page.goto(`/content/${id}`);
  await page.getByRole('button', { name: LABELS.scheduleLater }).click();
  // Zone first: the date/time is read as wall-clock time in the selected zone.
  await page.getByLabel('Time zone').selectOption(timezone);
  await page.getByLabel(/^Date & time/).fill(zonedLocalInput(when, timezone));
  await page.getByRole('button', { name: LABELS.scheduleButton }).click();
  await expect(page.getByRole('heading', { name: LABELS.scheduledHeading, exact: true }).or(wizardError(page)).first())
    .toBeVisible({ timeout: 15_000 });
  await expectNoWizardError(page);
}
