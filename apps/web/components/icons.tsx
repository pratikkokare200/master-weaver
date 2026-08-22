/**
 * Inline icon set.
 *
 * Hand-rolled rather than pulled from an icon package: doc 05 rejects webfonts because a network
 * request can fail in a screen recording, and the same logic applies to any asset the demo depends
 * on. Every icon here is 16×16 on a 24-unit grid, 1.5px stroke, `currentColor`, so icons inherit
 * ink tokens and never carry color meaning of their own.
 */

export interface IconProps {
  className?: string;
  size?: number;
  style?: React.CSSProperties;
}

function Svg({
  children,
  className,
  size = 16,
  style,
}: IconProps & { children: React.ReactNode }): React.ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export function MenuIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 6h16M4 12h16M4 18h16" />
    </Svg>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6 6l12 12M18 6L6 18" />
    </Svg>
  );
}

export function RunIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M7 5l11 7-11 7V5z" />
    </Svg>
  );
}

export function TableIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 10h18M9 10v10" />
    </Svg>
  );
}

export function ChartIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 19V5" />
      <path d="M4 19h16" />
      <path d="M8 16l4-5 3 3 4-6" />
    </Svg>
  );
}

export function JsonIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M8 4H7a2 2 0 0 0-2 2v3a2 2 0 0 1-2 2 2 2 0 0 1 2 2v3a2 2 0 0 0 2 2h1" />
      <path d="M16 4h1a2 2 0 0 1 2 2v3a2 2 0 0 0 2 2 2 2 0 0 0-2 2v3a2 2 0 0 1-2 2h-1" />
    </Svg>
  );
}

export function ChatIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M20 15a2 2 0 0 1-2 2H8l-4 3V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v9z" />
    </Svg>
  );
}

export function LedgerIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 8v4l3 2" />
      <path d="M3.05 11a9 9 0 1 1 .5 4" />
      <path d="M3 21v-6h6" />
    </Svg>
  );
}

export function WorkspaceIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 3l9 5-9 5-9-5 9-5z" />
      <path d="M3 13l9 5 9-5" />
    </Svg>
  );
}

export function CollectorIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <ellipse cx="12" cy="6" rx="8" ry="3" />
      <path d="M4 6v6c0 1.66 3.58 3 8 3s8-1.34 8-3V6" />
      <path d="M4 12v6c0 1.66 3.58 3 8 3s8-1.34 8-3v-6" />
    </Svg>
  );
}

export function PlusIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 5v14M5 12h14" />
    </Svg>
  );
}

export function InfoIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 16v-4M12 8h.01" />
    </Svg>
  );
}

export function AlertIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
      <path d="M12 9v4M12 17h.01" />
    </Svg>
  );
}

export function InboxIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M22 12h-6l-2 3h-4l-2-3H2" />
      <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
    </Svg>
  );
}

export function RetryIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M21 12a9 9 0 1 1-3-6.7" />
      <path d="M21 3v6h-6" />
    </Svg>
  );
}

export function ExternalIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M14 4h6v6" />
      <path d="M20 4l-9 9" />
      <path d="M18 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5" />
    </Svg>
  );
}

export function CompassIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M15.5 8.5l-2.2 4.8-4.8 2.2 2.2-4.8 4.8-2.2z" />
    </Svg>
  );
}

export function DownloadIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 4v11" />
      <path d="M8 11l4 4 4-4" />
      <path d="M4 19h16" />
    </Svg>
  );
}

export function SendIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 19V5" />
      <path d="M5 12l7-7 7 7" />
    </Svg>
  );
}

/**
 * The mark beside an assistant turn in the chat.
 *
 * A four-point star rather than a robot or a speech bubble: the answer it labels is a SQL query
 * this product wrote and ran, and a robot face would be claiming a persona the product does not
 * have. The path opts out of the shared 1.5px stroke and fills instead — at 14px a stroked star is
 * four grey hairlines and no shape at all. It is the one icon here that does that, for a reason
 * that only applies to it.
 */
export function SparkIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path
        fill="currentColor"
        stroke="none"
        d="M12 3.2c.3 2.6 1.1 4.4 2.4 5.6 1.2 1.2 3 2 5.4 2.4-2.4.4-4.2 1.2-5.4 2.4-1.3 1.2-2.1 3-2.4 5.6-.3-2.6-1.1-4.4-2.4-5.6-1.2-1.2-3-2-5.4-2.4 2.4-.4 4.2-1.2 5.4-2.4 1.3-1.2 2.1-3 2.4-5.6z"
      />
    </Svg>
  );
}

export function TrashIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 7h16" />
      <path d="M10 11v6M14 11v6" />
      <path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12" />
      <path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
    </Svg>
  );
}
