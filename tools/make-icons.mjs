// Kør: node tools/make-icons.mjs (kræver Chromium med Noto Color Emoji; CHROME_PATH kan sættes)
// Gengiver 🥃 (Noto Color Emoji) på brun baggrund i de størrelser, telefoner og browsere bruger.
import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
const sizes = [{ f: 'public/icons/icon-512.png', s: 512 }, { f: 'public/icons/icon-192.png', s: 192 }, { f: 'public/icons/apple-touch-icon.png', s: 180 }, { f: 'public/icons/favicon-32.png', s: 32 }];
for (const { f, s } of sizes) {
  const page = await (await browser.newContext({ viewport: { width: s, height: s }, deviceScaleFactor: 1 })).newPage();
  // Ikonet skal tåle maskering (rund/afrundet) – emojien fylder ca. 62 % af fladen
  await page.setContent(`<html><body style="margin:0;background:#5e2f0e;display:flex;align-items:center;justify-content:center;width:${s}px;height:${s}px"><div style="font-size:${Math.round(s * 0.66)}px;line-height:1;font-family:'Noto Color Emoji'">🥃</div></body></html>`);
  await page.screenshot({ path: f });
  console.log('skrev', f);
}
await browser.close();
