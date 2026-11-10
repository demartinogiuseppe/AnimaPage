// Packs the exported lesson as an OpenBoard W3C widget (.wgt): a stored (uncompressed) zip with
// config.xml and index.html. The HTML is already base64-heavy, so compression would buy little.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Also drops the control characters XML 1.0 forbids (tab, LF and CR stay): one would make config.xml unreadable. */
const xmlEscape = (s: string): string =>
  s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

interface Entry {
  name: Uint8Array;
  data: Uint8Array;
  crc: number;
  offset: number;
}

function zipStored(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const enc = new TextEncoder();
  const entries: Entry[] = [];
  let size = 22;
  for (const f of files) {
    const name = enc.encode(f.name);
    entries.push({ name, data: f.data, crc: crc32(f.data), offset: 0 });
    size += 30 + name.length + f.data.length + 46 + name.length;
  }
  const out = new Uint8Array(size);
  const v = new DataView(out.buffer);
  let p = 0;
  // Fixed DOS date 1980-01-01 00:00 keeps the output reproducible; flag bit 11 = UTF-8 names.
  for (const e of entries) {
    e.offset = p;
    v.setUint32(p, 0x04034b50, true);
    v.setUint16(p + 4, 20, true);
    v.setUint16(p + 6, 0x0800, true);
    v.setUint16(p + 8, 0, true);
    v.setUint16(p + 10, 0, true);
    v.setUint16(p + 12, 0x0021, true);
    v.setUint32(p + 14, e.crc, true);
    v.setUint32(p + 18, e.data.length, true);
    v.setUint32(p + 22, e.data.length, true);
    v.setUint16(p + 26, e.name.length, true);
    v.setUint16(p + 28, 0, true);
    out.set(e.name, p + 30);
    out.set(e.data, p + 30 + e.name.length);
    p += 30 + e.name.length + e.data.length;
  }
  const cdStart = p;
  for (const e of entries) {
    v.setUint32(p, 0x02014b50, true);
    v.setUint16(p + 4, 20, true);
    v.setUint16(p + 6, 20, true);
    v.setUint16(p + 8, 0x0800, true);
    v.setUint16(p + 10, 0, true);
    v.setUint16(p + 12, 0, true);
    v.setUint16(p + 14, 0x0021, true);
    v.setUint32(p + 16, e.crc, true);
    v.setUint32(p + 20, e.data.length, true);
    v.setUint32(p + 24, e.data.length, true);
    v.setUint16(p + 28, e.name.length, true);
    v.setUint32(p + 42, e.offset, true);
    out.set(e.name, p + 46);
    p += 46 + e.name.length;
  }
  v.setUint32(p, 0x06054b50, true);
  v.setUint16(p + 8, entries.length, true);
  v.setUint16(p + 10, entries.length, true);
  v.setUint32(p + 12, p - cdStart, true);
  v.setUint32(p + 16, cdStart, true);
  return out;
}

export function buildWgt(html: string, meta: { id: string; title: string; version: string }): Uint8Array {
  const enc = new TextEncoder();
  const config =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<widget xmlns="http://www.w3.org/ns/widgets" id="https://animapage.local/lesson/' + xmlEscape(meta.id) +
    '" version="' + xmlEscape(meta.version) + '" width="1024" height="720">' +
    "<name>" + xmlEscape(meta.title) + "</name>" +
    '<content src="index.html"/></widget>\n';
  return zipStored([
    { name: "config.xml", data: enc.encode(config) },
    { name: "index.html", data: enc.encode(html) },
  ]);
}
