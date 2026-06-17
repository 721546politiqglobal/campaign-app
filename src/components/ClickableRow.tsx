'use client';

import { useRouter } from 'next/navigation';

export function ClickableRow({ href, children }: { href: string; children: React.ReactNode }) {
  const router = useRouter();
  return (
    <tr className="row" onClick={() => router.push(href)}>
      {children}
    </tr>
  );
}
