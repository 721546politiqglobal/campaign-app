/**
 * Return shape for server actions driven by `useFormState` (React 18 /
 * Next 14). The action receives `(prevState, formData)`, returns this on
 * validation failure so the form can show errors next to fields and keep what
 * the user typed, and either `redirect()`s on success or returns
 * `{ ok: true, savedAt }` for in-place saves (settings, monitoring).
 *
 *   const [raw, formAction] = useFormState(joinAction, INITIAL_FORM_STATE);
 *   const state = raw ?? INITIAL_FORM_STATE;
 *   <input name="email" defaultValue={state.values?.email} />
 *   <Field error={state.fieldErrors?.email}>…</Field>
 *
 * The `?? INITIAL_FORM_STATE` fallback matters: in Next 14.2 an action that
 * `redirect()`s resolves with `undefined` on the client while the navigation
 * is followed, and `useFormState` hands that `undefined` to the component —
 * reading `state.error` on it would throw just before the new page shows.
 *
 * Never put secrets (passwords) in `values`.
 */
export interface ActionFormState {
  ok: boolean;
  /** Form-level message (shown in an alert above the fields). */
  error?: string;
  /** Per-field messages keyed by input `name`. */
  fieldErrors?: Record<string, string>;
  /** Submitted values to re-populate the form with. */
  values?: Record<string, string>;
  /** Changes on every successful in-place save so the client can re-fire its "Saved" feedback. */
  savedAt?: number;
}

export const INITIAL_FORM_STATE: ActionFormState = { ok: true };
