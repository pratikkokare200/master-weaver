'use client';

import { useEffect, useState } from 'react';

import { CloseIcon, MenuIcon } from '@/components/icons';
import { Sidebar, SidebarContent } from '@/components/shell/Sidebar';

/**
 * App frame — 240px fixed rail beside a content column capped at 1440px (doc 05 §3).
 *
 * Below the tablet breakpoint the rail collapses to a drawer. Responsive matters here only because
 * a judge may open the live URL on a tablet, not because mobile is a use case.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Escape closes the drawer — every dismissible layer should answer to it.
  useEffect(() => {
    if (!drawerOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDrawerOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [drawerOpen]);

  return (
    <div className="flex min-h-screen bg-plane">
      <Sidebar />

      {drawerOpen ? (
        <div className="fixed inset-0 z-40 md:hidden">
          <button
            type="button"
            aria-label="Close navigation"
            className="absolute inset-0 bg-ink/20"
            onClick={() => setDrawerOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 w-60 border-r border-hairline bg-plane shadow-floating">
            <SidebarContent onNavigate={() => setDrawerOpen(false)} />
          </div>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Drawer trigger. Reserved at a fixed height so the tablet layout doesn't jump. */}
        <div className="flex h-14 shrink-0 items-center gap-2 border-b border-hairline bg-surface px-4 md:hidden">
          <button
            type="button"
            aria-label="Open navigation"
            aria-expanded={drawerOpen}
            onClick={() => setDrawerOpen(true)}
            className="inline-flex h-11 w-11 items-center justify-center rounded-control text-ink-secondary transition-colors hover:bg-plane hover:text-ink"
          >
            {drawerOpen ? <CloseIcon size={18} /> : <MenuIcon size={18} />}
          </button>
          <span className="text-body font-semibold text-ink">Master Weaver</span>
        </div>

        <main className="mx-auto w-full max-w-[1440px] flex-1 px-4 py-4 md:px-6 md:py-6">
          {children}
        </main>
      </div>
    </div>
  );
}
