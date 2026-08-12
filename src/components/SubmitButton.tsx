'use client';

import { useFormStatus } from 'react-dom';

export function SubmitButton({
  children, pendingText, className = 'btn primary', style,
}: {
  children: React.ReactNode;
  pendingText: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} style={style} disabled={pending} aria-busy={pending}>
      {pending ? pendingText : children}
    </button>
  );
}
