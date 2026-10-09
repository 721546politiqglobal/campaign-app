/**
 * The PolitIQ wordmark, theme-aware. Renders both the dark wordmark (shown in
 * the light theme) and the white wordmark (shown in the dark theme); CSS in
 * globals.css §4 picks one based on `<html data-theme>` or the OS preference,
 * so it also works for the `system` theme. Server-safe.
 *
 *   <Logo className="brand-logo-img" />
 */
export function Logo({ className = 'brand-logo-img', alt = 'PolitIQ' }: { className?: string; alt?: string }) {
  return (
    <>
      <img src="/politiq-logo-dark.png" alt={alt} className={`${className} logo-on-light`} />
      <img src="/politiq-logo.png" alt={alt} className={`${className} logo-on-dark`} />
    </>
  );
}
