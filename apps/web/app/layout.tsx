import type { Metadata, Viewport } from 'next';

import { AppShell } from '@/components/shell/AppShell';

import './globals.css';

export const metadata: Metadata = {
  title: 'Master Weaver',
  description:
    'Resilient scraping with an observation deck — every run scored against a contract, every repair verified before it commits.',
};

export const viewport: Viewport = {
  themeColor: '#f8fafc',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
