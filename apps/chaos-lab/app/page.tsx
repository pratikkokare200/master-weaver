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
          <nav className="layout-switcher">
            <span className="layout-label">Switch Mutation:</span>
            <a
              href={`/?layout=v1${dateParam ? `&date=${dateParam}` : ''}`}
              className={`layout-btn ${layout === 'v1' ? 'active' : ''}`}
            >
              v1 (Standard Table)
            </a>
            <a
              href={`/?layout=v2${dateParam ? `&date=${dateParam}` : ''}`}
              className={`layout-btn ${layout === 'v2' ? 'active' : ''}`}
            >
              v2 (Total Break - Grid)
            </a>
            <a
              href={`/?layout=v3${dateParam ? `&date=${dateParam}` : ''}`}
              className={`layout-btn ${layout === 'v3' ? 'active' : ''}`}
            >
              v3 (Partial Break - Price Split)
            </a>
          </nav>
          <div className="date-indicator">
            Server Schedule Date: <span>{effectiveDate}</span>
          </div>
        </div>
      </header>

      {layout === 'v2' ? (
        /* =====================================================================
           LAYOUT V2: TOTAL BREAK
           - CSS Grid of <div> cards
           - Shares ZERO class names and ZERO tag structure with v1
           - Price inside <div class="pricing"><span class="amount">1299</span><span class="currency">USD</span></div>
           - Every v1 selector MUST fail
           ===================================================================== */
        <div className="catalog-grid">
          {products.map((item) => {
            const amountStr = item.current_price % 1 === 0 
              ? item.current_price.toString() 
              : item.current_price.toFixed(2);

            return (
              <div key={item.id} className="device-card">
                <div className="media-box">
                  <img src={item.image} alt={item.name} className="device-thumb" />
                </div>
                <div className="device-card-content">
                  <h3 className="device-title">{item.name}</h3>
                  <div className="hardware-specs">
                    <span className="spec-memory">{item.ram_gb}GB</span>
                    <span className="spec-storage">{item.storage_gb}GB</span>
                  </div>
                  <div className="card-footer">
                    <div className="pricing">
                      <span className="amount">{amountStr}</span>
                      <span className="currency">USD</span>
                    </div>
                    <div className={`inventory-status ${item.in_stock ? 'status-avail' : 'status-unavail'}`}>
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
