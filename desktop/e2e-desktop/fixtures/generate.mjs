// Generates the synthetic fixture library for the packaged desktop E2E.
// Output is byte-for-byte deterministic (fixed ZIP timestamps, no dates),
// so `node generate.mjs --check` can prove the committed files are current.
//
// Usage: node e2e-desktop/fixtures/generate.mjs [--check]

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const libraryDir = path.join(here, "library");

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const b of bytes) crc = CRC_TABLE[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

// Stored (uncompressed) ZIP — EPUB requires `mimetype` first and uncompressed.
function zip(entries) {
  const DOS_DATE = 0x0021; // 1980-01-01
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, text] of entries) {
    const nameBytes = Buffer.from(name, "utf8");
    const data = Buffer.from(text, "utf8");
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(10, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBytes, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(10, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const centralSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

const paragraph = (chapter, n) =>
  `<p>Chapter ${chapter}, paragraph ${n}. Synthetic fixture prose for the ProperBooky desktop smoke test: lanterns, field notes and quiet weather, repeated so the paginated reader has more than one screen to turn.</p>`;

function epub({ title, author, id, chapters }) {
  const xhtml = (heading, body) =>
    `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="en"><head><title>${heading}</title></head><body>${body}</body></html>\n`;
  const chapterFiles = chapters.map((heading, i) => [
    `OEBPS/ch${i + 1}.xhtml`,
    xhtml(
      heading,
      `<h1>${heading}</h1>` +
        Array.from({ length: 24 }, (_, n) => paragraph(i + 1, n + 1)).join(""),
    ),
  ]);
  const manifest = chapters
    .map((_, i) => `<item id="ch${i + 1}" href="ch${i + 1}.xhtml" media-type="application/xhtml+xml"/>`)
    .join("");
  const spine = chapters.map((_, i) => `<itemref idref="ch${i + 1}"/>`).join("");
  const navList = chapters
    .map((heading, i) => `<li><a href="ch${i + 1}.xhtml">${heading}</a></li>`)
    .join("");
  const ncxPoints = chapters
    .map(
      (heading, i) =>
        `<navPoint id="np${i + 1}" playOrder="${i + 1}"><navLabel><text>${heading}</text></navLabel><content src="ch${i + 1}.xhtml"/></navPoint>`,
    )
    .join("");
  return zip([
    ["mimetype", "application/epub+zip"],
    [
      "META-INF/container.xml",
      `<?xml version="1.0" encoding="UTF-8"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>\n`,
    ],
    [
      "OEBPS/content.opf",
      `<?xml version="1.0" encoding="UTF-8"?>\n<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="bookid">${id}</dc:identifier><dc:title>${title}</dc:title><dc:creator>${author}</dc:creator><dc:language>en</dc:language><meta property="dcterms:modified">2026-01-01T00:00:00Z</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>${manifest}</manifest><spine toc="ncx">${spine}</spine></package>\n`,
    ],
    ["OEBPS/nav.xhtml", xhtml("Contents", `<nav epub:type="toc"><ol>${navList}</ol></nav>`)],
    [
      "OEBPS/toc.ncx",
      `<?xml version="1.0" encoding="UTF-8"?>\n<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head><meta name="dtb:uid" content="${id}"/></head><docTitle><text>${title}</text></docTitle><navMap>${ncxPoints}</navMap></ncx>\n`,
    ],
    ...chapterFiles,
  ]);
}

// Minimal PDF 1.4 with one Helvetica text line per page and a valid xref.
function pdf(pageLines) {
  const objects = [];
  const pageIds = pageLines.map((_, i) => 4 + i * 2);
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageLines.length} >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  pageLines.forEach((line, i) => {
    const pageId = pageIds[i];
    const stream = `BT /F1 24 Tf 72 720 Td (${line}) Tj ET`;
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${pageId + 1} 0 R >>`;
    objects[pageId + 1] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });
  let out = "%PDF-1.4\n";
  const offsets = [];
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = out.length;
    out += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xref = out.length;
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id++) {
    out += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  }
  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

export const FIXTURES = {
  "Zephyr Lantern Field Notes.epub": epub({
    title: "Zephyr Lantern Field Notes",
    author: "Synthetic Fixture",
    id: "urn:uuid:00000000-0000-4000-8000-000000000018",
    chapters: ["First Light", "Second Watch", "Third Weather"],
  }),
  "quillfeather-orbit-atlas.pdf": pdf([
    "Quillfeather Orbit Atlas - page 1",
    "Quillfeather Orbit Atlas - page 2",
    "Quillfeather Orbit Atlas - page 3",
  ]),
  "basalt-ledger-handbook.pdf": pdf([
    "Basalt Ledger Handbook - page 1",
    "Basalt Ledger Handbook - page 2",
  ]),
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes("--check");
  mkdirSync(libraryDir, { recursive: true });
  let stale = 0;
  for (const [name, bytes] of Object.entries(FIXTURES)) {
    const file = path.join(libraryDir, name);
    if (check) {
      let current = null;
      try {
        current = readFileSync(file);
      } catch {}
      if (!current || !current.equals(bytes)) {
        console.error(`stale or missing fixture: ${name}`);
        stale++;
      }
    } else {
      writeFileSync(file, bytes);
      console.log(`wrote ${name} (${bytes.length} bytes)`);
    }
  }
  process.exit(stale ? 1 : 0);
}
