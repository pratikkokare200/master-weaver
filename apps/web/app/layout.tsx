import type { Metadata, Viewport } from 'next';

import { AppShell } from '@/components/shell/AppShell';
import { listCollectors } from '@/lib/queries.server';

import './globals.css';

export const metadata: Metadata = {
  title: 'Master Weaver',
  description:
    'Resilient scraping with an observation deck — every run scored against a contract, every repair verified before it commits.',
};

export const viewport: Viewport = {
  themeColor: '#f6f8fa',
};

/**
 * The sidebar's collector list is read here, in the layout, so it survives navigation between
 * collectors instead of being refetched by every page. The layout is a server component; `AppShell`
 * is a client component and receives the rows as props rather than reaching for the database itself.
 */
export const dynamic = 'force-dynamic';

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const collectors = await listCollectors();

  // One workspace until auth exists (doc 03 §2.3). Derived rather than hardcoded so the count
  // beside it is the real number of collectors, not a figure that drifts the first time one is
  // added.
  const workspaces = [
    { id: 'default', name: 'Default workspace', collectorIds: collectors.map((c) => c.id) },
  ];

  return (
    <html lang="en">
      <body>
        <AppShell collectors={collectors} workspaces={workspaces}>
          {children}
        </AppShell>
      </body>
    </html>
  );
}
