import { getProductsForDate } from '@/lib/products';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: {
    layout?: string;
    date?: string;
  };
}

export default function Page({ searchParams }: PageProps) {
  const layout = (searchParams?.layout || 'v1').toLowerCase();
  const dateParam = searchParams?.date;
  const { products, effectiveDate } = getProductsForDate(dateParam);

  return (
    <main className="lab-container">
      <header className="lab-header">
        <div className="lab-title-row">
          <h1 className="lab-title">
            Chaos Lab Catalog
            <span className="lab-badge">Active Layout: {layout}</span>
          </h1>
        </div>
        <p className="lab-subtitle">
          Synthetic e-commerce hardware listing designed for scraping pipeline resilience tests, autonomous healing verification, and structural drift simulations.
        </p>

        <div className="lab-controls-bar">
          <div className="layout-indicator">
            <span className="layout-label">Active Mutation:</span>
            <span className="layout-tag">{layout}</span>
          </div>
          <div className="date-indicator">
            Server Schedule Date: <span>{effectiveDate}</span>
          </div>
        </div>
      </header>

      {layout === 'v2' ? (
        /* =====================================================================
           LAYOUT V2: TOTAL BREAK
           - CSS Grid of deeply nested cards
           - Shares ZERO class names, tags, or attributes with v1
           - Obscured/non-standard naming to prevent generic scraper heuristics
           - Every v1 selector MUST fail (FHS < 0.60)
           ===================================================================== */
        <div className="matrix-surface">
          {products.map((item) => {
            const amountStr = item.current_price % 1 === 0 
              ? item.current_price.toString() 
              : item.current_price.toFixed(2);

            return (
              <div key={item.id} className="terminal-tile">
                <div className="visual-container">
                  <img src={item.image} alt="" className="visual-asset" />
                </div>
                <div className="terminal-tile-body">
                  <div className="unit-metadata-flow">
                    <div className="entity-descriptor-wrap">
                      <div className="descriptor-layer-inner">
                        <span className="item-token-display">{item.name}</span>
                      </div>
                    </div>
                  </div>
                  <div className="module-attributes-group">
                    <div className="attr-capsule-a">
                      <span className="spec-mem-val">{item.ram_gb}GB</span>
                    </div>
                    <div className="attr-capsule-b">
                      <span className="spec-disk-val">{item.storage_gb}GB</span>
                    </div>
                  </div>
                  <div className="deck-terminal-footer">
                    <div className="tariff-cluster">
                      <div className="valuation-cell-wrapper">
                        <div className="valuation-cell-inner">
                          <span className="figure-digits">{amountStr}</span>
                          <span className="denomination-ticker">USD</span>
                        </div>
                      </div>
                    </div>
                    <div className={`procurement-flag ${item.in_stock ? 'flag-ready' : 'flag-backorder'}`}>
                      {item.in_stock ? 'Available' : 'Backordered'}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* =====================================================================
           LAYOUT V1 & V3: TABLE LAYOUTS
           - v1: Standard <table> with <td class="product-name">, <td class="price">$1,299.00</td>
           - v3: Byte-identical to v1 EXCEPT <td class="price"><span class="cur">$</span><span class="val">1299</span><span class="cents">.00</span></td>
           ===================================================================== */
        <div className="table-container">
          <table className="products-table">
            <thead>
              <tr>
                <th>Image</th>
                <th>Product</th>
                <th>RAM</th>
                <th>Storage</th>
                <th>Price</th>
                <th>Stock</th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => {
                const parts = p.current_price.toFixed(2).split('.');
                const wholeVal = parts[0];
                const centsVal = `.${parts[1]}`;

                return (
                  <tr key={p.id}>
                    <td className="product-image">
                      <img src={p.image} alt={p.name} />
                    </td>
                    <td className="product-name">{p.name}</td>
                    <td className="ram">{`${p.ram_gb} GB`}</td>
                    <td className="storage">{`${p.storage_gb} GB`}</td>
                    {layout === 'v3' ? (
                      <td className="price"><span className="cur">$</span><span className="val">{wholeVal}</span><span className="cents">{centsVal}</span></td>
                    ) : (
                      <td className="price">{p.formatted_price}</td>
                    )}
                    <td className="stock">
                      {p.in_stock ? (
                        <span className="stock-in">In Stock</span>
                      ) : (
                        <span className="stock-out">Out of Stock</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
