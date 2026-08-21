import { deflateRawSync } from 'node:zlib';

/**
 * A ZIP writer, because an XLSX file is a ZIP archive of XML parts and nothing more.
 *
 * Roughly a hundred lines against a dependency that would pull a tree of its own into a Next.js
 * bundle. The format's fixed-size records are stable, fully specified, and unchanged since 1993 —
 * this is one of the rare cases where writing it is genuinely cheaper than depending on it.
 *
 * Only what a spreadsheet needs is implemented: deflate, no encryption, no ZIP64, no directories as
 * entries. An XLSX is a handful of small XML parts, so the 4 GB and 65,535-entry limits are not
 * limits here.
 */

export interface ZipEntry {
  /** Path within the archive, forward slashes, no leading slash. */
  readonly name: string;
  readonly data: Buffer;
}

// ---------------------------------------------------------------------------------------------
// CRC-32, the ZIP checksum. Table-driven; the table is built once at module load.
// ---------------------------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

export function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = (CRC_TABLE[(crc ^ byte) & 0xff] as number) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * MS-DOS date and time, which is what ZIP records and what makes the archive's timestamps show up
 * correctly in Explorer and Finder.
 *
 * Two-second resolution and a 1980 epoch, both inherent to the format. Dates before 1980 are clamped
 * rather than wrapped: a file dated 1971 in a spreadsheet export is a bug worth not hiding behind
 * arithmetic.
 */
function dosDateTime(date: Date): { time: number; date: number } {
  const year = Math.max(1980, date.getUTCFullYear());
  return {
    time:
      (date.getUTCHours() << 11) |
      (date.getUTCMinutes() << 5) |
      (Math.floor(date.getUTCSeconds() / 2) & 0x1f),
    date: ((year - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate(),
  };
}

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY = 0x06054b50;

/** Deflate, method 8. `deflateRawSync` is the ZIP-compatible form — no zlib wrapper. */
const METHOD_DEFLATE = 8;

/**
 * Build a ZIP archive.
 *
 * `modified` is a parameter rather than `new Date()` so the output is deterministic: the same
 * entries and the same timestamp produce byte-identical archives, which is what lets the tests
 * assert on the bytes instead of on a re-parse of their own writer.
 */
export function zip(entries: readonly ZipEntry[], modified: Date = new Date()): Buffer {
  const { time, date } = dosDateTime(modified);
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const compressed = deflateRawSync(entry.data, { level: 9 });
    const checksum = crc32(entry.data);

    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(LOCAL_HEADER, 0);
    local.writeUInt16LE(20, 4); // version needed: 2.0, which is what deflate requires
    local.writeUInt16LE(0, 6); // no flags: not encrypted, sizes known up front
    local.writeUInt16LE(METHOD_DEFLATE, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28); // no extra field
    name.copy(local, 30);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(CENTRAL_HEADER, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(METHOD_DEFLATE, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30); // extra
    central.writeUInt16LE(0, 32); // comment
    central.writeUInt16LE(0, 34); // disk number
    central.writeUInt16LE(0, 36); // internal attributes
    central.writeUInt32LE(0, 38); // external attributes
    central.writeUInt32LE(offset, 42); // where the local header for this entry starts
    name.copy(central, 46);

    locals.push(local, compressed);
    centrals.push(central);
    offset += local.length + compressed.length;
  }

  const centralDirectory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(END_OF_CENTRAL_DIRECTORY, 0);
  end.writeUInt16LE(0, 4); // this disk
  end.writeUInt16LE(0, 6); // disk with the central directory
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16); // central directory starts after the last entry
  end.writeUInt16LE(0, 20); // no archive comment

  return Buffer.concat([...locals, centralDirectory, end]);
}
