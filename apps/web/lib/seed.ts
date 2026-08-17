/**
 * Seed data for the shell.
 *
 * Doc 05 §8: "Pre-seed the flagship workspace so the landing view is populated" — a judge forms
 * their impression from whatever the landing route shows, so it must not be an empty state.
 *
 * Row shapes mirror real `scraper run` output captured during Day-1 verification: `price` is a
 * nested `{ value, currency }` object, not a scalar, and every row echoes its `input.url`.
 *
 * This module is presentational scaffolding. It is replaced by Supabase reads once the worker is
 * writing rows — the component props are already shaped for that swap.
 */

import type { GoldenSetShape, RunState } from '@weaver/contracts';

export interface GoldenSetInfo {
  count: number;
  shape: GoldenSetShape;
}

export interface CollectorSummary {
  id: string;
  collectorId: string;
  name: string;
  targetUrl: string;
  intent: string;
  runState: RunState;
  fhs: number | null;
  rowCount: number | null;
  lastRunAt: string | null;
  goldenSet: GoldenSetInfo;
}

export interface ProductRow {
  product_name: string;
  price: { value: number; currency: string } | null;
  ram: string | null;
  storage: string | null;
  stock: string | null;
  product_page_url: string;
}

export interface Workspace {
  id: string;
  name: string;
  collectorIds: string[];
}

const HOUR = 1000 * 60 * 60;
const at = (hoursAgo: number): string => new Date(Date.now() - hoursAgo * HOUR).toISOString();

export const COLLECTORS: CollectorSummary[] = [
  {
    id: 'hardware-catalog',
    collectorId: 'c_mswyapbp22wiwv8fhh',
    name: 'Hardware catalog',
    targetUrl: 'https://master-weaver-theta.vercel.app/',
    intent: 'Extract product name, price, RAM, storage and stock from the catalog page.',
    runState: 'HEALTHY',
    fhs: 0.97,
    rowCount: 24,
    lastRunAt: at(0.2),
    goldenSet: { count: 3, shape: 'detail' },
  },
  {
    id: 'competitor-laptops',
    collectorId: 'c_mpohus372o5tmid1jk',
    name: 'Competitor laptops',
    targetUrl: 'https://webscraper.io/test-sites/e-commerce/allinone/computers/laptops',
    intent: 'Track laptop listings and prices across the competitor catalog.',
    // The degraded path: 0.60 ≤ FHS < 0.95 halts and asks. This is the amber badge with an action.
    runState: 'PENDING_OPERATOR',
    fhs: 0.8,
    rowCount: 117,
    lastRunAt: at(0.6),
    goldenSet: { count: 1, shape: 'listing' },
  },
  {
    id: 'marketplace-listings',
    collectorId: 'c_mp3tuab31lswoxvpws',
    name: 'Marketplace listings',
    targetUrl: 'https://example.com/marketplace',
    intent: 'Collect marketplace listings with seller and shipping details.',
    runState: 'IDLE',
    fhs: null,
    rowCount: null,
    lastRunAt: null,
    goldenSet: { count: 2, shape: 'detail' },
  },
];

export const WORKSPACES: Workspace[] = [
  {
    id: 'flagship',
    name: 'Flagship',
    collectorIds: ['hardware-catalog', 'competitor-laptops'],
  },
  {
    id: 'research',
    name: 'Research',
    collectorIds: ['marketplace-listings'],
  },
];

/** The collector the landing route opens on — populated, healthy, unambiguous. */
export const FLAGSHIP_COLLECTOR_ID = 'hardware-catalog';

export function getCollector(id: string): CollectorSummary | undefined {
  return COLLECTORS.find((collector) => collector.id === id);
}

/** Rows shaped exactly like real CLI output, including the nested price object. */
export const SAMPLE_ROWS: ProductRow[] = [
  {
    product_name: 'AeroBook Pro 14',
    price: { value: 1299, currency: 'USD' },
    ram: '16 GB',
    storage: '512 GB',
    stock: 'In Stock',
    product_page_url: '/p/aerobook-pro-14',
  },
  {
    product_name: 'Zenith Precision 16',
    price: { value: 1899, currency: 'USD' },
    ram: '32 GB',
    storage: '1024 GB',
    stock: 'In Stock',
    product_page_url: '/p/zenith-precision-16',
  },
  {
    product_name: 'Nova Ultralight 13',
    price: { value: 1199, currency: 'USD' },
    ram: '16 GB',
    storage: '512 GB',
    stock: 'In Stock',
    product_page_url: '/p/nova-ultralight-13',
  },
  {
    product_name: 'Titan Studio 17',
    price: { value: 2399, currency: 'USD' },
    ram: '64 GB',
    storage: '2048 GB',
    stock: 'Low Stock',
    product_page_url: '/p/titan-studio-17',
  },
  {
    product_name: 'Apex Flow 15',
    price: { value: 1499, currency: 'USD' },
    ram: '16 GB',
    storage: '512 GB',
    stock: 'In Stock',
    product_page_url: '/p/apex-flow-15',
  },
  {
    product_name: 'Vanguard Elite 14',
    price: { value: 1749, currency: 'USD' },
    ram: '32 GB',
    // Nulls are seeded on purpose: they prove the em-dash rule rather than leaving a blank cell.
    storage: null,
    stock: 'In Stock',
    product_page_url: '/p/vanguard-elite-14',
  },
  {
    product_name: 'Pulse Craft 16',
    price: { value: 1599, currency: 'USD' },
    ram: '16 GB',
    storage: '1024 GB',
    stock: null,
    product_page_url: '/p/pulse-craft-16',
  },
  {
    product_name: 'Matrix Blade 15',
    price: { value: 2199, currency: 'USD' },
    ram: '32 GB',
    storage: '1024 GB',
    stock: 'In Stock',
    product_page_url: '/p/matrix-blade-15',
  },
];

/** Sidebar footer credit meter. Turns amber below 20% (doc 05 §6). */
export const CREDIT_BALANCE = {
  remaining: 412,
  total: 500,
  spentToday: 26,
};

// -----------------------------------------------------------------------------------------------
// Healing ledger
// -----------------------------------------------------------------------------------------------

export interface LedgerAttempt {
  attemptNo: number;
  canaryFhs: number;
  decision: 'APPROVED' | 'REJECTED';
  rejectionReason: string | null;
  diagnosis: string;
}

export interface LedgerEpisode {
  id: string;
  triggeredAt: string;
  triggerReason: 'DEGRADED' | 'BROKEN';
  authorisedBy: 'AUTONOMOUS' | 'OPERATOR';
  fhsBefore: number;
  fhsAfter: number | null;
  finalState: 'RESTORED' | 'QUARANTINED' | 'DISMISSED';
  creditsSpent: number;
  durationMs: number;
  attempts: LedgerAttempt[];
}

/**
 * Seeded episodes.
 *
 * The first one is the "attempt 1 rejected, attempt 2 approved" case. Doc 04 Beat 5e calls it the
 * strongest evidence in the product, and doc 05 §6 is explicit that rejected attempts are never
 * hidden — a system that rejects its own bad fix is more convincing than one that always succeeds.
 */
export const LEDGER_EPISODES: LedgerEpisode[] = [
  {
    id: 'ep_3',
    triggeredAt: at(2),
    triggerReason: 'BROKEN',
    authorisedBy: 'AUTONOMOUS',
    fhsBefore: 0.32,
    fhsAfter: 0.97,
    finalState: 'RESTORED',
    creditsSpent: 6,
    durationMs: 74_000,
    attempts: [
      {
        attemptNo: 1,
        canaryFhs: 0.71,
        decision: 'REJECTED',
        rejectionReason: 'Canary scored 0.71, below the 0.90 gate — price extracted the shipping cost.',
        diagnosis:
          'Price and product name stopped extracting after the catalog switched from a table to a card grid. Price fill rate fell to 0.12 from 1.00.',
      },
      {
        attemptNo: 2,
        canaryFhs: 0.96,
        decision: 'APPROVED',
        rejectionReason: null,
        diagnosis:
          'Price is rendered inside the card footer as a currency-prefixed string, not in a table cell. Extract the numeric portion of the price element within each product card.',
      },
    ],
  },
  {
    id: 'ep_2',
    triggeredAt: at(26),
    triggerReason: 'DEGRADED',
    authorisedBy: 'OPERATOR',
    fhsBefore: 0.82,
    fhsAfter: 0.98,
    finalState: 'RESTORED',
    creditsSpent: 3,
    durationMs: 41_000,
    attempts: [
      {
        attemptNo: 1,
        canaryFhs: 0.98,
        decision: 'APPROVED',
        rejectionReason: null,
        diagnosis: 'Stock label moved from a badge element to a sibling span beneath the price.',
      },
    ],
  },
];
