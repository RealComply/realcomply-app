# Made-up comparable-sales reports (CMAs)

Made up for testing the document reader (Adam, 1 Nov 2026). Every office,
agent, address, suburb and figure in them is invented, and every page says so.
No provider's name or logo is used: the two "style" reports carry made-up
names and only follow the layout of the big providers' reports.

| File | What it is | Sales | On the market |
| --- | --- | --- | --- |
| long-report.pdf | An agency's own CMA over four pages | 27 | 3 |
| scanned-report.pdf | A typed appraisal printed and scanned: pictures of pages, no text in the file | 9 | 0 |
| corelogic-style.pdf | Property cards, laid out like the big data provider's CMA | 12 | 4 |
| pricefinder-style.pdf | A sales evidence table, laid out like the other big provider's report | 10 | 3 |

Each `.json` beside a PDF is the answer a correct read gives.

- Read on every pull request by `src/lib/documents/sample-cmas.test.ts`, with a
  stand-in for the reader. They fail if the reader's limit goes back to 1,536
  tokens, where the long report's answer was cut off on 30 Oct 2026.
- `long-report.pdf` is read by the real reader every morning on live: the daily
  reader check (`src/lib/documents/reader-check.ts`), which emails Adam if the
  read fails or doesn't find 27 sales.
- To change them, edit and run `node scripts/samples/make-sample-cmas.mjs`
  (needs Playwright's Chromium), then update the counts in
  `src/lib/documents/sample-cmas.ts`.
