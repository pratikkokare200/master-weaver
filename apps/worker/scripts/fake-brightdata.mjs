/**
 * A stand-in for the Bright Data CLI, for the smoke test.
 *
 * `resolveBin` reads BRIGHTDATA_CLI_BIN, so pointing that at the sibling .cmd shim makes the real
 * adapter spawn this instead of the real CLI: real subprocess, real quoting, real JSON parsing, no
 * credits spent. Emits rows shaped like `docs/samples/run_v1.json`.
 */

const argv = process.argv.slice(2);
const rowCount = Number(process.env.FAKE_ROW_COUNT ?? 12);
const brokenFrom = Number(process.env.FAKE_BROKEN_ROWS ?? 0);

if (argv[0] !== 'scraper' || argv[1] !== 'run') {
  process.stderr.write(`fake-brightdata: unsupported command ${argv.join(' ')}\n`);
  process.exit(2);
}

const rows = Array.from({ length: rowCount }, (_, i) => ({
  product_name: `AeroBook Pro ${i + 1}`,
  // The nested money envelope the real CLI returns.
  price: i < brokenFrom ? null : { value: 1299 + i, currency: 'USD', symbol: '$' },
  in_stock: i % 4 === 3 ? 'Out of Stock' : 'In Stock',
  product_url: `https://master-weaver-theta.vercel.app/p/${i + 1}`,
  input: { url: 'https://master-weaver-theta.vercel.app/' },
}));

// The real CLI writes data to stdout and diagnostics to stderr; mirror that.
process.stderr.write(`fake-brightdata: ran ${argv[2]} for ${rowCount} rows\n`);
process.stdout.write(JSON.stringify(rows));
