export interface BaseProduct {
  id: number;
  name: string;
  base_price: number;
  ram_gb: number;
  storage_gb: number;
  in_stock: boolean;
  image: string;
}

export interface PriceScheduleEntry {
  product_id: number;
  date: string; // YYYY-MM-DD
  multiplier: number;
}

export interface StockScheduleEntry {
  product_id: number;
  date: string; // YYYY-MM-DD
  in_stock: boolean;
}

export interface ComputedProduct {
  id: number;
  name: string;
  base_price: number;
  current_price: number;
  formatted_price: string; // "$1,299.00"
  price_value: string;     // "1,299" or "1299"
  amount: string;          // "1299" or "1299.00"
  currency: string;        // "USD" or "$"
  val: string;             // "1299" or "1,299"
  cents: string;           // ".00"
  ram_gb: number;
  storage_gb: number;
  in_stock: boolean;
  image: string;
}

// 12 fake laptop products with base prices between 900 and 2400
export const PRODUCTS: BaseProduct[] = [
  {
    id: 1,
    name: "AeroBook Pro 14",
    base_price: 1299.00,
    ram_gb: 16,
    storage_gb: 512,
    in_stock: true,
    image: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='240' height='160' viewBox='0 0 240 160'%3E%3Crect width='240' height='160' fill='%231e293b'/%3E%3Crect x='40' y='30' width='160' height='90' rx='6' fill='%23334155' stroke='%2364748b' stroke-width='2'/%3E%3Crect x='52' y='42' width='136' height='66' rx='2' fill='%230f172a'/%3E%3Cpolygon points='20,126 220,126 208,136 32,136' fill='%23475569'/%3E%3Ctext x='120' y='80' font-family='sans-serif' font-size='11' fill='%2394a3b8' text-anchor='middle'%3EAeroBook Pro 14%3C/text%3E%3C/svg%3E",
  },
  {
    id: 2,
    name: "Zenith Precision 16",
    base_price: 1899.00,
    ram_gb: 32,
    storage_gb: 1024,
    in_stock: true,
    image: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='240' height='160' viewBox='0 0 240 160'%3E%3Crect width='240' height='160' fill='%231e293b'/%3E%3Crect x='40' y='30' width='160' height='90' rx='6' fill='%23334155' stroke='%2364748b' stroke-width='2'/%3E%3Crect x='52' y='42' width='136' height='66' rx='2' fill='%230f172a'/%3E%3Cpolygon points='20,126 220,126 208,136 32,136' fill='%23475569'/%3E%3Ctext x='120' y='80' font-family='sans-serif' font-size='11' fill='%2394a3b8' text-anchor='middle'%3EZenith Precision 16%3C/text%3E%3C/svg%3E",
  },
  {
    id: 3,
    name: "Nova Ultralight 13",
    base_price: 1199.00,
    ram_gb: 16,
    storage_gb: 512,
    in_stock: true,
    image: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='240' height='160' viewBox='0 0 240 160'%3E%3Crect width='240' height='160' fill='%231e293b'/%3E%3Crect x='40' y='30' width='160' height='90' rx='6' fill='%23334155' stroke='%2364748b' stroke-width='2'/%3E%3Crect x='52' y='42' width='136' height='66' rx='2' fill='%230f172a'/%3E%3Cpolygon points='20,126 220,126 208,136 32,136' fill='%23475569'/%3E%3Ctext x='120' y='80' font-family='sans-serif' font-size='11' fill='%2394a3b8' text-anchor='middle'%3ENova Ultralight 13%3C/text%3E%3C/svg%3E",
  },
  {
    id: 4,
    name: "Titan Studio 17",
    base_price: 2399.00,
    ram_gb: 64,
    storage_gb: 2048,
    in_stock: true,
    image: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='240' height='160' viewBox='0 0 240 160'%3E%3Crect width='240' height='160' fill='%231e293b'/%3E%3Crect x='40' y='30' width='160' height='90' rx='6' fill='%23334155' stroke='%2364748b' stroke-width='2'/%3E%3Crect x='52' y='42' width='136' height='66' rx='2' fill='%230f172a'/%3E%3Cpolygon points='20,126 220,126 208,136 32,136' fill='%23475569'/%3E%3Ctext x='120' y='80' font-family='sans-serif' font-size='11' fill='%2394a3b8' text-anchor='middle'%3ETitan Studio 17%3C/text%3E%3C/svg%3E",
  },
  {
    id: 5,
    name: "Apex Flow 15",
    base_price: 1499.00,
    ram_gb: 16,
    storage_gb: 512,
    in_stock: true,
    image: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='240' height='160' viewBox='0 0 240 160'%3E%3Crect width='240' height='160' fill='%231e293b'/%3E%3Crect x='40' y='30' width='160' height='90' rx='6' fill='%23334155' stroke='%2364748b' stroke-width='2'/%3E%3Crect x='52' y='42' width='136' height='66' rx='2' fill='%230f172a'/%3E%3Cpolygon points='20,126 220,126 208,136 32,136' fill='%23475569'/%3E%3Ctext x='120' y='80' font-family='sans-serif' font-size='11' fill='%2394a3b8' text-anchor='middle'%3EApex Flow 15%3C/text%3E%3C/svg%3E",
  },
  {
    id: 6,
    name: "Vanguard Elite 14",
    base_price: 1749.00,
    ram_gb: 32,
    storage_gb: 1024,
    in_stock: true,
    image: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='240' height='160' viewBox='0 0 240 160'%3E%3Crect width='240' height='160' fill='%231e293b'/%3E%3Crect x='40' y='30' width='160' height='90' rx='6' fill='%23334155' stroke='%2364748b' stroke-width='2'/%3E%3Crect x='52' y='42' width='136' height='66' rx='2' fill='%230f172a'/%3E%3Cpolygon points='20,126 220,126 208,136 32,136' fill='%23475569'/%3E%3Ctext x='120' y='80' font-family='sans-serif' font-size='11' fill='%2394a3b8' text-anchor='middle'%3EVanguard Elite 14%3C/text%3E%3C/svg%3E",
  },
  {
    id: 7,
    name: "Pulse Craft 16",
    base_price: 1599.00,
    ram_gb: 16,
    storage_gb: 1024,
    in_stock: true,
    image: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='240' height='160' viewBox='0 0 240 160'%3E%3Crect width='240' height='160' fill='%231e293b'/%3E%3Crect x='40' y='30' width='160' height='90' rx='6' fill='%23334155' stroke='%2364748b' stroke-width='2'/%3E%3Crect x='52' y='42' width='136' height='66' rx='2' fill='%230f172a'/%3E%3Cpolygon points='20,126 220,126 208,136 32,136' fill='%23475569'/%3E%3Ctext x='120' y='80' font-family='sans-serif' font-size='11' fill='%2394a3b8' text-anchor='middle'%3EPulse Craft 16%3C/text%3E%3C/svg%3E",
  },
  {
    id: 8,
    name: "Matrix Blade 15",
    base_price: 2199.00,
    ram_gb: 32,
    storage_gb: 1024,
    in_stock: true,
    image: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='240' height='160' viewBox='0 0 240 160'%3E%3Crect width='240' height='160' fill='%231e293b'/%3E%3Crect x='40' y='30' width='160' height='90' rx='6' fill='%23334155' stroke='%2364748b' stroke-width='2'/%3E%3Crect x='52' y='42' width='136' height='66' rx='2' fill='%230f172a'/%3E%3Cpolygon points='20,126 220,126 208,136 32,136' fill='%23475569'/%3E%3Ctext x='120' y='80' font-family='sans-serif' font-size='11' fill='%2394a3b8' text-anchor='middle'%3EMatrix Blade 15%3C/text%3E%3C/svg%3E",
  },
  {
    id: 9,
    name: "Spectra Air 13",
    base_price: 999.00,
    ram_gb: 8,
    storage_gb: 256,
    in_stock: true,
    image: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='240' height='160' viewBox='0 0 240 160'%3E%3Crect width='240' height='160' fill='%231e293b'/%3E%3Crect x='40' y='30' width='160' height='90' rx='6' fill='%23334155' stroke='%2364748b' stroke-width='2'/%3E%3Crect x='52' y='42' width='136' height='66' rx='2' fill='%230f172a'/%3E%3Cpolygon points='20,126 220,126 208,136 32,136' fill='%23475569'/%3E%3Ctext x='120' y='80' font-family='sans-serif' font-size='11' fill='%2394a3b8' text-anchor='middle'%3ESpectra Air 13%3C/text%3E%3C/svg%3E",
  },
  {
    id: 10,
    name: "Hyperion Creator 16",
    base_price: 2299.00,
    ram_gb: 64,
    storage_gb: 2048,
    in_stock: true,
    image: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='240' height='160' viewBox='0 0 240 160'%3E%3Crect width='240' height='160' fill='%231e293b'/%3E%3Crect x='40' y='30' width='160' height='90' rx='6' fill='%23334155' stroke='%2364748b' stroke-width='2'/%3E%3Crect x='52' y='42' width='136' height='66' rx='2' fill='%230f172a'/%3E%3Cpolygon points='20,126 220,126 208,136 32,136' fill='%23475569'/%3E%3Ctext x='120' y='80' font-family='sans-serif' font-size='11' fill='%2394a3b8' text-anchor='middle'%3EHyperion Creator 16%3C/text%3E%3C/svg%3E",
  },
  {
    id: 11,
    name: "Carbon Edge 14",
    base_price: 1349.00,
    ram_gb: 16,
    storage_gb: 512,
    in_stock: true,
    image: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='240' height='160' viewBox='0 0 240 160'%3E%3Crect width='240' height='160' fill='%231e293b'/%3E%3Crect x='40' y='30' width='160' height='90' rx='6' fill='%23334155' stroke='%2364748b' stroke-width='2'/%3E%3Crect x='52' y='42' width='136' height='66' rx='2' fill='%230f172a'/%3E%3Cpolygon points='20,126 220,126 208,136 32,136' fill='%23475569'/%3E%3Ctext x='120' y='80' font-family='sans-serif' font-size='11' fill='%2394a3b8' text-anchor='middle'%3ECarbon Edge 14%3C/text%3E%3C/svg%3E",
  },
  {
    id: 12,
    name: "OmniBook Slim 15",
    base_price: 1099.00,
    ram_gb: 16,
    storage_gb: 512,
    in_stock: false,
    image: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='240' height='160' viewBox='0 0 240 160'%3E%3Crect width='240' height='160' fill='%231e293b'/%3E%3Crect x='40' y='30' width='160' height='90' rx='6' fill='%23334155' stroke='%2364748b' stroke-width='2'/%3E%3Crect x='52' y='42' width='136' height='66' rx='2' fill='%230f172a'/%3E%3Cpolygon points='20,126 220,126 208,136 32,136' fill='%23475569'/%3E%3Ctext x='120' y='80' font-family='sans-serif' font-size='11' fill='%2394a3b8' text-anchor='middle'%3EOmniBook Slim 15%3C/text%3E%3C/svg%3E",
  }
];

// Price schedule covering Aug 17–23 2026
// Product 3: 0.89 from Aug 19 (11% drop)
// Product 7: 1.06 from Aug 20 (rise)
export const PRICE_SCHEDULE: PriceScheduleEntry[] = [
  { product_id: 3, date: "2026-08-19", multiplier: 0.89 },
  { product_id: 7, date: "2026-08-20", multiplier: 1.06 }
];

// Stock schedule:
// Product 5: in_stock flips false on Aug 21, true again on Aug 22
export const STOCK_SCHEDULE: StockScheduleEntry[] = [
  { product_id: 5, date: "2026-08-21", in_stock: false },
  { product_id: 5, date: "2026-08-22", in_stock: true }
];

/**
 * Deterministically compute the products for a specific target date (YYYY-MM-DD).
 * If no date is passed, defaults to server's current date formatted as YYYY-MM-DD.
 */
export function getProductsForDate(targetDateStr?: string): { products: ComputedProduct[]; effectiveDate: string } {
  let effectiveDate = targetDateStr;
  if (!effectiveDate || !/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)) {
    const now = new Date();
    effectiveDate = now.toISOString().slice(0, 10);
  }

  const computedProducts: ComputedProduct[] = PRODUCTS.map((product) => {
    // Determine most recent multiplier on or before effectiveDate
    const applicablePriceEntries = PRICE_SCHEDULE
      .filter((entry) => entry.product_id === product.id && entry.date <= effectiveDate)
      .sort((a, b) => b.date.localeCompare(a.date));

    const multiplier = applicablePriceEntries.length > 0 ? applicablePriceEntries[0].multiplier : 1.0;
    const current_price = Math.round(product.base_price * multiplier * 100) / 100;

    // Determine stock status based on stock schedule
    const applicableStockEntries = STOCK_SCHEDULE
      .filter((entry) => entry.product_id === product.id && entry.date <= effectiveDate)
      .sort((a, b) => b.date.localeCompare(a.date));

    const in_stock = applicableStockEntries.length > 0 ? applicableStockEntries[0].in_stock : product.in_stock;

    // Format strings
    const formattedPriceStr = current_price.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }); // e.g. "1,299.00"

    const parts = formattedPriceStr.split(".");
    const wholeVal = parts[0]; // e.g. "1,299"
    const centsVal = "." + (parts[1] || "00"); // e.g. ".00"
    const amountVal = current_price.toFixed(0); // e.g. "1299" or amount without decimals if whole

    return {
      id: product.id,
      name: product.name,
      base_price: product.base_price,
      current_price,
      formatted_price: `$${formattedPriceStr}`,
      price_value: wholeVal,
      amount: amountVal,
      currency: "USD",
      val: wholeVal,
      cents: centsVal,
      ram_gb: product.ram_gb,
      storage_gb: product.storage_gb,
      in_stock,
      image: product.image,
    };
  });

  return { products: computedProducts, effectiveDate };
}
