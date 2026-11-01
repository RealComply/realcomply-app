// Makes the four made-up comparable-sales reports (CMAs) the reader is tested
// on (Adam, 1 Nov 2026), and the record of what each one holds.
//
//   node scripts/samples/make-sample-cmas.mjs
//
// Writes samples/cma/<name>.pdf and samples/cma/<name>.json for:
//   long-report        an agency's own CMA, 27 sales over several pages
//   scanned-report     a typed appraisal printed and scanned: pictures of
//                      pages, no text in the file at all
//   corelogic-style    property cards, laid out the way the big data
//                      provider's CMA lays them out
//   pricefinder-style  a sales evidence table, laid out the way the other
//                      big provider's report does
//
// MADE-UP DATA ONLY. Every office, agent, street, suburb and figure is
// invented, from a fixed seed so the files come out the same each time. No
// provider's name or logo is used: the two "style" reports carry made-up
// names. Each page says it is a made-up sample.
//
// The .json beside each PDF is the answer a correct read gives (what the
// reader should take from that report): the tests in
// src/lib/documents/sample-cmas.test.ts check the reader returns exactly that
// many sales. Needs Playwright's Chromium (pre-installed where Claude works;
// elsewhere `npx playwright install chromium`). The PDFs are committed, so
// nothing needs this to run except a change to the samples.

import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const { PDFDocument } = require("pdf-lib");

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT = join(ROOT, "samples", "cma");
const MADE_UP = "MADE-UP SAMPLE FOR TESTING. Not a real report: every name, address and figure is invented.";

// ── Made-up data, from a fixed seed ─────────────────────────────────────────
function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const STREETS = [
  "Sample Street", "Example Road", "Placeholder Avenue", "Testing Lane", "Mockup Crescent", "Dummy Close",
  "Fictional Parade", "Notreal Street", "Pretend Place", "Specimen Way", "Draft Avenue", "Prototype Road",
  "Template Street", "Madeup Drive", "Imaginary Grove", "Rehearsal Street", "Trialrun Court", "Sandbox Lane",
];
const SUBURBS = [
  ["Testville", "2999"], ["Sampleton", "2998"], ["Exampleton", "2997"],
];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function makeSales(rand, n, { from = "2026-04-01", to = "2026-10-24", near = 1.6 } = {}) {
  const start = Date.parse(from);
  const span = Date.parse(to) - start;
  const used = new Set();
  const sales = [];
  for (let i = 0; i < n; i++) {
    let address;
    do {
      const street = STREETS[Math.floor(rand() * STREETS.length)];
      const [suburb, postcode] = SUBURBS[Math.floor(rand() * (i % 4 === 3 ? 3 : 1))];
      address = `${1 + Math.floor(rand() * 98)} ${street}, ${suburb} NSW ${postcode}`;
    } while (used.has(address));
    used.add(address);
    const bedrooms = 3 + Math.floor(rand() * 3);
    const bathrooms = 1 + Math.floor(rand() * 3);
    const carSpaces = 1 + Math.floor(rand() * 2);
    const landSizeSqm = 420 + Math.floor(rand() * 380);
    const internalAreaSqm = i % 3 === 0 ? 140 + Math.floor(rand() * 110) : undefined;
    const salePrice = Math.round((900000 + bedrooms * 50000 + landSizeSqm * 350 + rand() * 150000) / 5000) * 5000;
    const saleDate = new Date(start + Math.floor(rand() * span)).toISOString().slice(0, 10);
    const distanceM = Math.round((0.15 + rand() * near) * 100) * 10;
    const propertyType = i % 7 === 6 ? "townhouse" : "house";
    const daysOnMarket = 9 + Math.floor(rand() * 50);
    sales.push({ address, salePrice, saleDate, bedrooms, bathrooms, carSpaces, landSizeSqm, internalAreaSqm, distanceM, propertyType, daysOnMarket });
  }
  return sales.sort((a, b) => (a.saleDate < b.saleDate ? 1 : -1));
}

function makeListings(rand, n) {
  return makeSales(rand, n, { from: "2026-09-01", to: "2026-10-25" }).map((s, i) => ({
    address: s.address,
    askingPrice:
      i % 3 === 0
        ? "Contact Agent"
        : `$${(Math.round(s.salePrice / 50000) * 50000).toLocaleString("en-AU")} - $${(Math.round(s.salePrice / 50000) * 50000 + 100000).toLocaleString("en-AU")}`,
    saleMethod: i % 3 === 1 ? "Auction" : "Private treaty",
    listedDate: s.saleDate,
    bedrooms: s.bedrooms,
    bathrooms: s.bathrooms,
    carSpaces: s.carSpaces,
    landSizeSqm: s.landSizeSqm,
    distanceM: s.distanceM,
    propertyType: s.propertyType,
  }));
}

const money = (n) => `$${n.toLocaleString("en-AU")}`;
const lowest = (sales) => Math.min(...sales.map((x) => x.salePrice));
const highest = (sales) => Math.max(...sales.map((x) => x.salePrice));
const longDate = (iso) => {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
};
const shortDate = (iso) => {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[m - 1].slice(0, 3)} ${y}`;
};
const slashDate = (iso) => iso.split("-").reverse().join("/");
const km = (m) => `${(m / 1000).toFixed(2)} km`;
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");

// ── The four reports ────────────────────────────────────────────────────────
const SUBJECT = {
  address: "8 Sample Street, Testville NSW 2999",
  bedrooms: 4,
  bathrooms: 2,
  carSpaces: 2,
  landSizeSqm: 604,
  internalAreaSqm: 212,
};

function samples() {
  const long = {
    name: "long-report",
    title: "Comparative Market Analysis",
    preparedBy: "Jordan Example, Testville Realty (made up)",
    preparedOn: "2026-10-28",
    subject: SUBJECT,
    estimate: { low: 1350000, high: 1450000 },
    sales: makeSales(seeded(27), 27),
    listings: makeListings(seeded(270), 3),
  };
  long.commentary =
    `The ${long.sales.length} sales nearby since April ranged from ${money(lowest(long.sales))} to ${money(highest(long.sales))}. ` +
    "The subject's renovated kitchen and north-facing yard place it in the upper half of that range, while its " +
    "single-level layout and the busier end of the street hold it below the top sales.";
  const scanned = {
    name: "scanned-report",
    title: "Market Appraisal",
    preparedBy: "Casey Sample, Exampleton Property (made up)",
    preparedOn: "2026-10-20",
    subject: { ...SUBJECT, address: "41 Example Road, Exampleton NSW 2997", landSizeSqm: 556, internalAreaSqm: undefined },
    estimate: { low: 1250000, high: 1350000 },
    commentary: "",
    sales: makeSales(seeded(9), 9),
    listings: [],
  };
  const coreStyle = {
    name: "corelogic-style",
    title: "Comparative Market Analysis",
    provider: "Banksia Property Data (made up)",
    preparedBy: "Riley Placeholder, Sampleton Estate Agents (made up)",
    preparedOn: "2026-10-25",
    subject: { ...SUBJECT, address: "17 Mockup Crescent, Sampleton NSW 2998", bedrooms: 3, landSizeSqm: 512, internalAreaSqm: 168 },
    estimate: { low: 1180000, high: 1260000 },
    sales: makeSales(seeded(12), 12),
    listings: makeListings(seeded(120), 4),
  };
  coreStyle.commentary =
    `Houses nearby have sold between ${money(lowest(coreStyle.sales))} and ${money(highest(coreStyle.sales))} since ` +
    "April. The closest matches in size and condition sit toward the lower half of that range.";
  const priceStyle = {
    name: "pricefinder-style",
    title: "Sales Evidence Report",
    provider: "Wattle Price Data (made up)",
    preparedBy: "Morgan Specimen, Testville Realty (made up)",
    preparedOn: "2026-10-27",
    subject: { ...SUBJECT, address: "5 Testing Lane, Testville NSW 2999", landSizeSqm: 688, internalAreaSqm: undefined },
    estimate: null,
    commentary: "",
    sales: makeSales(seeded(10), 10),
    listings: makeListings(seeded(100), 3),
  };
  return [long, scanned, coreStyle, priceStyle];
}

// ── Layouts ─────────────────────────────────────────────────────────────────
const BASE_CSS = `
  @page { size: A4; margin: 16mm 14mm; }
  * { box-sizing: border-box; }
  body { font-family: "DejaVu Sans", Arial, sans-serif; font-size: 10.5pt; color: #1d2733; margin: 0; }
  h1 { font-size: 20pt; margin: 0 0 4px; }
  h2 { font-size: 13pt; margin: 18px 0 8px; border-bottom: 1.5px solid #c9d2dc; padding-bottom: 3px; }
  .muted { color: #5b6b7c; }
  .madeup { font-size: 8pt; color: #8a2b2b; border: 1px solid #e4b4b4; background: #fbf1f1; padding: 3px 6px; margin: 6px 0 10px; }
  .facts span { display: inline-block; margin-right: 14px; }
  .page-break { break-before: page; }
`;

function subjectFacts(s) {
  return [
    `${s.bedrooms} bed`, `${s.bathrooms} bath`, `${s.carSpaces} car`, `Land ${s.landSizeSqm} m²`,
    s.internalAreaSqm ? `Floor ${s.internalAreaSqm} m²` : null,
  ].filter(Boolean).map((t) => `<span>${t}</span>`).join("");
}

function longHtml(r) {
  const block = (s) => `
    <div style="break-inside: avoid; border: 1px solid #d8dee5; border-radius: 6px; padding: 8px 10px; margin-bottom: 8px">
      <div style="font-weight: 700; font-size: 11pt">${esc(s.address)}</div>
      <div>Sold ${money(s.salePrice)} on ${longDate(s.saleDate)} · ${s.daysOnMarket} days on market</div>
      <div class="facts muted">${subjectFacts(s)}<span>${km(s.distanceM)} from the subject</span><span>${s.propertyType}</span></div>
    </div>`;
  return `<html><head><style>${BASE_CSS}</style></head><body>
    <h1>${r.title}</h1>
    <div class="muted">Prepared for ${esc(r.subject.address)} by ${esc(r.preparedBy)} on ${longDate(r.preparedOn)}</div>
    <div class="madeup">${MADE_UP}</div>
    <h2>The property</h2>
    <div class="facts">${subjectFacts(r.subject)}</div>
    <h2>Estimated selling price</h2>
    <p><b>${money(r.estimate.low)} to ${money(r.estimate.high)}</b></p>
    <p>${esc(r.commentary)}</p>
    <h2 class="page-break">Recent sales nearby (${r.sales.length})</h2>
    ${r.sales.map(block).join("")}
    <h2>On the market now (${r.listings.length})</h2>
    ${r.listings.map((l) => `
      <div style="break-inside: avoid; border: 1px dashed #c3ccd6; border-radius: 6px; padding: 8px 10px; margin-bottom: 8px">
        <div style="font-weight: 700">${esc(l.address)}</div>
        <div>For sale: ${esc(l.askingPrice)} · ${esc(l.saleMethod)} · listed ${longDate(l.listedDate)}</div>
        <div class="facts muted">${subjectFacts(l)}<span>${km(l.distanceM)} from the subject</span></div>
      </div>`).join("")}
    <p class="muted" style="font-size: 8.5pt; margin-top: 16px">This appraisal is an estimate only, prepared from recent sales. ${MADE_UP}</p>
  </body></html>`;
}

// Two pages, each a whole page of paper, so no line is cut in half between
// them: the first with the property and the first six sales, the second with
// the rest and the opinion. The scan's grey, blur and tilt are CSS.
function scannedPagesHtml(r) {
  const style = `<style>
    html { background: #f2f0ea; filter: grayscale(1) contrast(1.2) blur(0.4px); }
    body { font-family: "DejaVu Serif", "Times New Roman", serif; font-size: 12pt; color: #111; margin: 0; padding: 46px 58px;
           width: 794px; height: 1123px; box-sizing: border-box; background: #fbfaf6; transform: rotate(PAGE_TILTdeg); transform-origin: 50% 50%; }
    h1 { font-size: 19pt; text-align: center; letter-spacing: 1px; }
    table { border-collapse: collapse; width: 100%; font-size: 10.5pt; }
    td, th { border: 1px solid #333; padding: 6px; vertical-align: top; }
    th { background: #e6e6e6; }
    .madeup { font-size: 9pt; border: 1px solid #777; padding: 4px; margin: 8px 0 14px; }
  </style>`;
  const head = `<tr><th>#</th><th>Address</th><th>Sold</th><th>Price</th><th>Bed/Bath/Car</th><th>Land m²</th><th>Distance</th></tr>`;
  const row = (s, i) => `<tr><td>${i + 1}</td><td>${esc(s.address)}</td><td>${shortDate(s.saleDate)}</td><td>${money(s.salePrice)}</td>
    <td>${s.bedrooms}/${s.bathrooms}/${s.carSpaces}</td><td>${s.landSizeSqm}</td><td>${km(s.distanceM)}</td></tr>`;
  const first = r.sales.slice(0, 6);
  const rest = r.sales.slice(6);
  const page1 = `<html><head>${style.replace("PAGE_TILT", "0.45")}</head><body>
    <h1>${r.title.toUpperCase()}</h1>
    <p><b>Property:</b> ${esc(r.subject.address)}<br/>
       <b>Prepared by:</b> ${esc(r.preparedBy)}<br/>
       <b>Date:</b> ${longDate(r.preparedOn)}</p>
    <div class="madeup">${MADE_UP}</div>
    <p>The property is a ${r.subject.bedrooms} bedroom, ${r.subject.bathrooms} bathroom home with ${r.subject.carSpaces} car spaces on ${r.subject.landSizeSqm} m² of land.</p>
    <p><b>Recent sales considered (${r.sales.length}):</b></p>
    <table>${head}${first.map((s, i) => row(s, i)).join("")}</table>
    <p style="text-align: right; margin-top: 18px">Page 1 of 2 (continued over)</p>
  </body></html>`;
  const page2 = `<html><head>${style.replace("PAGE_TILT", "-0.6")}</head><body>
    <p><b>Recent sales considered, continued:</b></p>
    <table>${head}${rest.map((s, i) => row(s, i + 6)).join("")}</table>
    <p style="margin-top: 26px"><b>In our opinion the estimated selling price is ${money(r.estimate.low)} to ${money(r.estimate.high)}.</b></p>
    <p style="margin-top: 46px">Signed: ______________________ &nbsp;&nbsp; (agent)</p>
    <div class="madeup" style="margin-top: 40px">${MADE_UP}</div>
    <p style="text-align: right; margin-top: 18px">Page 2 of 2</p>
  </body></html>`;
  return [page1, page2];
}

function coreStyleHtml(r) {
  const card = (s, sold) => `
    <div style="break-inside: avoid; display: inline-block; vertical-align: top; width: 48.5%; margin: 0 1% 10px 0; border: 1px solid #cfd8e2; border-radius: 4px; overflow: hidden">
      <div style="background: #0f5f73; color: #fff; padding: 5px 8px; font-weight: 700; font-size: 10pt">${esc(s.address)}</div>
      <table style="width: 100%; font-size: 9pt; border-collapse: collapse">
        ${sold
          ? `<tr><td style="padding: 3px 8px">Sold price</td><td><b>${money(s.salePrice)}</b></td></tr>
             <tr><td style="padding: 3px 8px">Sold date</td><td>${slashDate(s.saleDate)}</td></tr>
             <tr><td style="padding: 3px 8px">Days on market</td><td>${s.daysOnMarket}</td></tr>`
          : `<tr><td style="padding: 3px 8px">Listing price</td><td><b>${esc(s.askingPrice)}</b></td></tr>
             <tr><td style="padding: 3px 8px">Method</td><td>${esc(s.saleMethod)}</td></tr>
             <tr><td style="padding: 3px 8px">First listed</td><td>${slashDate(s.listedDate)}</td></tr>`}
        <tr><td style="padding: 3px 8px">Bed · Bath · Car</td><td>${s.bedrooms} · ${s.bathrooms} · ${s.carSpaces}</td></tr>
        <tr><td style="padding: 3px 8px">Land size</td><td>${s.landSizeSqm}m²</td></tr>
        ${s.internalAreaSqm ? `<tr><td style="padding: 3px 8px">Floor area</td><td>${s.internalAreaSqm}m²</td></tr>` : ""}
        <tr><td style="padding: 3px 8px">Distance</td><td>${km(s.distanceM)}</td></tr>
        <tr><td style="padding: 3px 8px">Property type</td><td>${s.propertyType === "house" ? "House" : "Townhouse"}</td></tr>
      </table>
    </div>`;
  return `<html><head><style>${BASE_CSS}
    .bar { background: #0f5f73; color: #fff; padding: 10px 14px; display: flex; justify-content: space-between; align-items: center; }
  </style></head><body>
    <div class="bar"><div style="font-size: 15pt; font-weight: 700">${esc(r.provider)}</div><div>${r.title}</div></div>
    <div class="madeup">${MADE_UP}</div>
    <h1 style="margin-top: 10px">${esc(r.subject.address)}</h1>
    <div class="muted">Prepared by ${esc(r.preparedBy)} · ${slashDate(r.preparedOn)}</div>
    <h2>Subject property</h2>
    <div class="facts">${subjectFacts(r.subject)}<span>House</span></div>
    <h2>Comparable sold properties</h2>
    <div>${r.sales.map((s) => card(s, true)).join("")}</div>
    <h2 class="page-break">Comparable on market properties</h2>
    <div>${r.listings.map((l) => card(l, false)).join("")}</div>
    <h2>Market summary</h2>
    <p>Estimated price range: <b>${money(r.estimate.low)} - ${money(r.estimate.high)}</b></p>
    <p>${esc(r.commentary)}</p>
    <p class="muted" style="font-size: 8pt">${esc(r.provider)} data is supplied for appraisal purposes only. ${MADE_UP}</p>
  </body></html>`;
}

function priceStyleHtml(r) {
  const head = `<tr style="background: #6b5a1e; color: #fff"><th>Address</th><th>Sale date</th><th>Sale price</th><th>Beds</th><th>Baths</th><th>Cars</th><th>Area (m²)</th><th>Dist (km)</th><th>Type</th></tr>`;
  const row = (s) => `<tr><td>${esc(s.address)}</td><td>${shortDate(s.saleDate)}</td><td>${money(s.salePrice)}</td><td>${s.bedrooms}</td><td>${s.bathrooms}</td><td>${s.carSpaces}</td><td>${s.landSizeSqm}</td><td>${(s.distanceM / 1000).toFixed(2)}</td><td>${s.propertyType === "house" ? "House" : "Townhouse"}</td></tr>`;
  const lhead = `<tr style="background: #6b5a1e; color: #fff"><th>Address</th><th>Listed</th><th>Asking</th><th>Method</th><th>Beds</th><th>Baths</th><th>Cars</th><th>Area (m²)</th><th>Dist (km)</th></tr>`;
  const lrow = (l) => `<tr><td>${esc(l.address)}</td><td>${shortDate(l.listedDate)}</td><td>${esc(l.askingPrice)}</td><td>${esc(l.saleMethod)}</td><td>${l.bedrooms}</td><td>${l.bathrooms}</td><td>${l.carSpaces}</td><td>${l.landSizeSqm}</td><td>${(l.distanceM / 1000).toFixed(2)}</td></tr>`;
  return `<html><head><style>${BASE_CSS}
    table { border-collapse: collapse; width: 100%; font-size: 8.6pt; }
    td, th { border-bottom: 1px solid #e0d9c4; padding: 4px 5px; text-align: left; }
    tr:nth-child(even) td { background: #faf7ee; }
  </style></head><body>
    <div style="display: flex; justify-content: space-between; border-bottom: 3px solid #6b5a1e; padding-bottom: 6px">
      <div style="font-size: 16pt; font-weight: 700; color: #6b5a1e">${esc(r.provider)}</div>
      <div style="text-align: right">${r.title}<br/><span class="muted">${shortDate(r.preparedOn)}</span></div>
    </div>
    <div class="madeup">${MADE_UP}</div>
    <p><b>Subject:</b> ${esc(r.subject.address)} · ${r.subject.bedrooms} beds · ${r.subject.bathrooms} baths · ${r.subject.carSpaces} cars · ${r.subject.landSizeSqm} m²<br/>
       <span class="muted">Prepared by ${esc(r.preparedBy)}</span></p>
    <h2>Sales evidence (${r.sales.length} sales within 2 km, last 6 months)</h2>
    <table>${head}${r.sales.map(row).join("")}</table>
    <h2>Current listings</h2>
    <table>${lhead}${r.listings.map(lrow).join("")}</table>
    <p class="muted" style="font-size: 8pt; margin-top: 14px">Sales data: ${esc(r.provider)}. ${MADE_UP}</p>
  </body></html>`;
}

// ── What a correct read of each report is ───────────────────────────────────
function expectedAnswer(r) {
  const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
  const patches = [
    clean({
      itemKey: "a4c",
      ...(r.commentary ? { note: r.commentary } : {}),
      comparableSales: r.sales.map((s) =>
        clean({
          address: s.address,
          salePrice: s.salePrice,
          saleDate: s.saleDate,
          bedrooms: s.bedrooms,
          bathrooms: s.bathrooms,
          carSpaces: s.carSpaces,
          landSizeSqm: s.landSizeSqm,
          internalAreaSqm: s.internalAreaSqm,
          distanceM: s.distanceM,
          propertyType: s.propertyType,
        }),
      ),
      ...(r.listings.length
        ? {
            marketListings: r.listings.map((l) =>
              clean({
                address: l.address,
                askingPrice: l.askingPrice,
                saleMethod: l.saleMethod,
                listedDate: l.listedDate,
                bedrooms: l.bedrooms,
                bathrooms: l.bathrooms,
                carSpaces: l.carSpaces,
                landSizeSqm: l.landSizeSqm,
                distanceM: l.distanceM,
                propertyType: l.propertyType,
              }),
            ),
          }
        : {}),
      subjectProperty: clean({
        bedrooms: r.subject.bedrooms,
        bathrooms: r.subject.bathrooms,
        carSpaces: r.subject.carSpaces,
        landSizeSqm: r.subject.landSizeSqm,
        internalAreaSqm: r.subject.internalAreaSqm,
      }),
    }),
  ];
  if (r.estimate) patches.unshift({ itemKey: "a4", espLow: r.estimate.low, espHigh: r.estimate.high });
  return { documentIs: "comparable_sales", patches };
}

// ── Render ──────────────────────────────────────────────────────────────────
async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  try {
    for (const r of samples()) {
      const page = await browser.newPage();
      let pdf;
      if (r.name === "scanned-report") {
        // Printed and scanned: each page a slightly crooked greyscale picture
        // at about 190 dpi, and no text in the file at all.
        const context = await browser.newContext({ viewport: { width: 794, height: 1123 }, deviceScaleFactor: 2 });
        const scanner = await context.newPage();
        const doc = await PDFDocument.create();
        for (const html of scannedPagesHtml(r)) {
          await scanner.setContent(html);
          const png = await scanner.screenshot({ type: "png", clip: { x: 0, y: 0, width: 794, height: 1123 } });
          const image = await doc.embedPng(png);
          const p = doc.addPage([595.28, 841.89]);
          p.drawImage(image, { x: 0, y: 0, width: 595.28, height: 841.89 });
        }
        await context.close();
        doc.setTitle("Scanned appraisal (made up)");
        doc.setSubject(MADE_UP);
        doc.setProducer("RealComply sample maker (made up)");
        doc.setCreationDate(new Date("2026-10-20T00:00:00Z"));
        doc.setModificationDate(new Date("2026-10-20T00:00:00Z"));
        pdf = await doc.save();
      } else {
        const html = r.name === "long-report" ? longHtml(r) : r.name === "corelogic-style" ? coreStyleHtml(r) : priceStyleHtml(r);
        await page.setContent(html);
        // The made-up label on every page, not only the first.
        pdf = await page.pdf({
          format: "A4",
          printBackground: true,
          displayHeaderFooter: true,
          headerTemplate: "<span></span>",
          footerTemplate:
            `<div style="font-size:7px;width:100%;text-align:center;color:#8a2b2b;font-family:Arial,sans-serif">` +
            `${MADE_UP} Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>`,
          margin: { top: "16mm", bottom: "18mm", left: "14mm", right: "14mm" },
        });
        // And in the file's own properties, where a test can find it.
        const doc = await PDFDocument.load(pdf);
        doc.setTitle(`${r.title} (made up)`);
        doc.setSubject(MADE_UP);
        doc.setProducer("RealComply sample maker (made up)");
        doc.setCreationDate(new Date(`${r.preparedOn}T00:00:00Z`));
        doc.setModificationDate(new Date(`${r.preparedOn}T00:00:00Z`));
        pdf = await doc.save();
      }
      await page.close();
      writeFileSync(join(OUT, `${r.name}.pdf`), pdf);
      const answer = expectedAnswer(r);
      writeFileSync(
        join(OUT, `${r.name}.json`),
        JSON.stringify({ made_up: MADE_UP, sales: r.sales.length, listings: r.listings.length, answer }, null, 2) + "\n",
      );
      console.log(`${r.name}: ${r.sales.length} sales, ${r.listings.length} listings, ${(pdf.length / 1024).toFixed(0)} KB`);
    }
  } finally {
    await browser.close();
  }
}

await main();
