import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Chaos Lab · Hardware Catalog',
  description: 'Hardware test store for scraping and resilience verification',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
