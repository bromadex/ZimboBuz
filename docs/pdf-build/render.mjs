import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';

const [, , htmlPath, pdfPath, footerFlag] = process.argv;
const footer = footerFlag === '1';

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage();
await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
await page.pdf({
  path: pdfPath,
  format: 'A4',
  printBackground: true,
  preferCSSPageSize: true,
  displayHeaderFooter: footer,
  headerTemplate: '<div></div>',
  footerTemplate: footer
    ? `<div style="width:100%;font-family:Inter,Arial,sans-serif;font-size:8px;color:#5b6b64;padding:0 16mm;display:flex;justify-content:space-between;">
         <span>ZimERP Master Plan · Confidential · October 2026</span>
         <span><span class="pageNumber"></span> / <span class="totalPages"></span></span>
       </div>`
    : '<div></div>',
  margin: footer ? { top: '16mm', bottom: '18mm', left: '16mm', right: '16mm' } : { top: '0', bottom: '0', left: '0', right: '0' },
});
await browser.close();
