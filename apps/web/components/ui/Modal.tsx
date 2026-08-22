'use client';

import { useCallback, useEffect, useRef } from 'react';

import { CloseIcon } from '@/components/icons';
import { cn } from '@/lib/cn';

/**
 * The dialog shell.
 *
 * Doc 05 §2.3 has reserved a 12px modal radius since Day 1 and nothing had claimed it — every
 * layer in the product so far has been either a card in the page or the tour's own overlay. This
 * is the first genuine modal, so the shell is built once, here, rather than inline in the one
 * component that currently needs it.
 *
 * Flat, like everything else: a solid surface, a 1px hairline, and the same ink-at-low-alpha scrim
 * the tour and the mobile drawer already use. No shadow, no blur behind the scrim. Dimming the page
 * *is* the separation.
 *
 * The accessibility work is the part worth reading:
 *
 * **Focus goes in and comes back.** The element that opened the dialog is remembered on mount and
 * refocused on unmount, so dismissing it does not drop a keyboard user at the top of the document.
 * First focus lands on the first focusable control inside rather than on the dialog box, because
 * this dialog's first control is a text field and a reader who opened a form wants the cursor in it.
 *
 * **Tab is trapped.** A scrim blocks the pointer but not the keyboard, and focus wandering onto the
 * page behind an overlay is the classic way this pattern fails. Escape closes, and so does a click
 * on the scrim — a dismissible layer should answer to both.
 *
 * **The page underneath does not scroll,** and the scrollbar's width is handed to the body as
 * padding while it is hidden. Without that, opening the dialog shunts the whole page sideways by
 * about fifteen pixels, which is the most distracting possible way to open something.
 */

export interface ModalProps {
  /** Announced as the dialog's name, and rendered as its heading. */
  title: string;
  /** One line under the title. Optional — a dialog whose title says everything does not need one. */
  description?: string;
  onClose: () => void;
  children: React.ReactNode;
  /** The action row. Rendered against the page plane so it reads as the foot of the dialog. */
  footer?: React.ReactNode;
  className?: string;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), ' +
  'select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Modal({ title, description, onClose, children, footer, className }: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const focusable = useCallback(
    () => Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []),
    [],
  );

  useEffect(() => {
    returnFocusRef.current = document.activeElement as HTMLElement | null;
    return () => returnFocusRef.current?.focus?.();
  }, []);

  // Into the first field, not onto the box. Falls back to the dialog itself when there is nothing
  // focusable inside, so focus is never left behind on the page.
  useEffect(() => {
    const first = focusable()[0];
    if (first) first.focus();
    else dialogRef.current?.focus();
  }, [focusable]);

  useEffect(() => {
    const { body, documentElement } = document;
    const gutter = window.innerWidth - documentElement.clientWidth;
    const previousOverflow = body.style.overflow;
    const previousPadding = body.style.paddingRight;

    body.style.overflow = 'hidden';
    if (gutter > 0) body.style.paddingRight = `${gutter}px`;

    return () => {
      body.style.overflow = previousOverflow;
      body.style.paddingRight = previousPadding;
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  function handleTrap(event: React.KeyboardEvent) {
    if (event.key !== 'Tab') return;
    const elements = focusable();
    const first = elements[0];
    const last = elements[elements.length - 1];
    if (!first || !last) return;

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 py-12">
      {/* A button rather than a div, so "dismiss" is a real control for anything driving the page
          without a pointer. It is behind the dialog and carries its own label. */}
      <button
        type="button"
        aria-label={`Close ${title}`}
        onClick={onClose}
        className="fixed inset-0 cursor-default"
        style={{ backgroundColor: 'var(--scrim)' }}
      />

      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        aria-describedby={description ? 'modal-description' : undefined}
        tabIndex={-1}
        onKeyDown={handleTrap}
        className={cn(
          'relative w-full max-w-lg rounded-modal border border-hairline bg-surface',
          'focus-visible:outline-none',
          className,
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-hairline px-6 py-4">
          <div className="min-w-0">
            <h2 id="modal-title" className="text-section font-semibold text-ink">
              {title}
            </h2>
            {description ? (
              <p id="modal-description" className="mt-1 text-body text-ink-secondary">
                {description}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            aria-label={`Close ${title}`}
            onClick={onClose}
            className="-mr-2 -mt-1 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-control text-ink-muted transition-colors hover:bg-plane hover:text-ink"
          >
            <CloseIcon size={16} />
          </button>
        </div>

        <div className="px-6 py-6">{children}</div>

        {footer ? (
          <div className="flex items-center justify-end gap-3 rounded-b-modal border-t border-hairline bg-plane px-6 py-4">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}
