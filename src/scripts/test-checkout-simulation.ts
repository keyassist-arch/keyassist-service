/**
 * Live test of the Nike checkout flow for tax capture.
 *
 * Flow: PDP → dismiss popup → select size → Add to Bag (wait for bag update)
 *       → /cart (verify item) → Checkout → guest auth modal → fill form
 *       → Save and continue → read Estimated Tax
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register src/scripts/test-checkout-simulation.ts [url]
 */
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

chromium.use(StealthPlugin());

const ADDR = {
  firstName: 'BELIEVE',
  lastName: 'OKOBIA',
  address1: '11969 PLANO RD',
  city: 'DALLAS',
  state: 'TX',
  zip: '75243',
  phone: '2145503204',
} as const;

const TARGET_URL =
  process.argv[2] ??
  'https://www.nike.com/t/one-fitted-womens-dri-fit-cropped-tank-top-C5z8Kc/FN2806-414';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36';

type Pg = import('playwright').Page;

// ── helpers ───────────────────────────────────────────────────────────────────

async function dismissPopup(page: Pg) {
  // 1. Location-selector modal — click "United States" so locale is correct
  try {
    await page.waitForSelector('text="Select your Location"', { timeout: 6000 });
    console.log('  ✓ location modal detected');
    const usBtn = await page.$('a:has-text("United States"), button:has-text("United States")');
    if (usBtn) {
      await usBtn.click();
      console.log('  ✓ selected United States — waiting for page to settle…');
      await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
      await page.waitForTimeout(3000);
      console.log(`    url after US select: ${page.url()}`);
      return;
    }
    // Couldn't find US button — just close the modal
    const closeBtn = await page.$('button[data-testid="modal-close-button"], button[aria-label="Close Pop Up"], button[class*="close"]');
    if (closeBtn) { await closeBtn.click(); await page.waitForTimeout(800); console.log('  ✓ location modal closed'); }
  } catch { /* no location modal */ }

  // 2. Generic close-pop-up button (cookie/promo banners)
  try {
    const el = await page.$('button[aria-label="Close Pop Up"], button[data-testid="modal-close-button"]');
    if (el) { await el.click(); await page.waitForTimeout(800); console.log('  ✓ popup dismissed'); }
  } catch { /* no popup */ }
}

/** Normal Playwright click (with actionability checks — no force). */
async function clickFirst(page: Pg, selectors: string[], label = ''): Promise<string | null> {
  for (const sel of selectors) {
    try {
      const el = await page.$(sel);
      if (el) {
        await el.click();
        console.log(`  ✓ ${label || 'clicked'}: ${sel}`);
        return sel;
      }
    } catch { /* try next */ }
  }
  return null;
}

async function fillField(page: Pg, selectors: string[], value: string, label: string) {
  for (const sel of selectors) {
    try {
      const el = await page.$(sel);
      if (el) { await el.fill(value); console.log(`  ✓ ${label} = "${value}"`); return; }
    } catch { /* try next */ }
  }
  console.warn(`  ✗ ${label} not found`);
}

function dumpInputs(fields: Array<{ tag: string; type: string; name: string; id: string; placeholder: string; autocomplete: string; testid: string }>) {
  fields.forEach((f) =>
    console.log(`    <${f.tag} type="${f.type}" name="${f.name}" id="${f.id}" placeholder="${f.placeholder}" autocomplete="${f.autocomplete}" testid="${f.testid}">`),
  );
}

// ── main simulation ───────────────────────────────────────────────────────────

async function simulateNike(url: string): Promise<number | null> {
  const browser = await chromium.launch({ headless: false });
  const ctx = await browser.newContext({
    userAgent: UA,
    viewport: { width: 1280, height: 900 },
    // Pre-set US geoloc so Akamai fingerprints us as a US client from the first request.
    // Without this, the server detects our Nigerian IP and the ak_bmsc cookie gets
    // a fingerprint that's rejected by the cart API.
    extraHTTPHeaders: {
      'Accept-Language': 'en-US,en;q=0.9',
    },
    locale: 'en-US',
    timezoneId: 'America/Chicago',
    geolocation: { latitude: 32.77, longitude: -96.79 },
    permissions: ['geolocation'],
  });
  // Pre-set the geoloc cookie before ANY request to Nike
  await ctx.addCookies([
    { name: 'geoloc', value: 'cc=US,rc=TX,tp=vhigh,tz=GMT-5,la=32.77,lo=-96.79', domain: '.nike.com', path: '/', sameSite: 'Lax' as const },
    { name: 'NIKE_COMMERCE_COUNTRY', value: 'US', domain: '.nike.com', path: '/', sameSite: 'Lax' as const },
    { name: 'NIKE_COMMERCE_LANG_LOCALE', value: 'en_US', domain: '.nike.com', path: '/', sameSite: 'Lax' as const },
    { name: 'nike_locale', value: 'us/en_us', domain: '.nike.com', path: '/', sameSite: 'Lax' as const },
    { name: 'CONSUMERCHOICE', value: 'us/en_us', domain: '.nike.com', path: '/', sameSite: 'Lax' as const },
  ]);

  try {
    const page = await ctx.newPage();

    // ── 1. PDP ───────────────────────────────────────────────────────────────
    console.log('\n[1] Loading PDP…');
    await page.goto(url, { waitUntil: 'networkidle', timeout: 45_000 });
    await page.waitForTimeout(2500);
    console.log(`    ${await page.title()}`);
    await dismissPopup(page);

    // If location modal sent us back to homepage, reload the product URL
    if (!page.url().includes(new URL(url).pathname.slice(0, 20))) {
      console.log('  ↩ Navigated away by location modal — reloading product URL…');
      await page.goto(url, { waitUntil: 'networkidle', timeout: 45_000 });
      await page.waitForTimeout(2500);
      console.log(`    ${await page.title()}`);
      // Dismiss any remaining popup (usually gone now that locale is set)
      await dismissPopup(page);
    }
    console.log(`    url: ${page.url()}`);
    await page.screenshot({ path: '/tmp/nike-01-pdp.png' });

    // ── 2. Select size ───────────────────────────────────────────────────────
    console.log('\n[2] Selecting size…');
    // Do NOT click the container first — Nike's #size-selector is a dropdown
    // that opens a separate modal/overlay; clicking the wrapper may hide the ATB button.
    // Instead: directly click child elements without opening the container.
    const sizePattern = /^(XXS|XS|S|M|L|XL|XXL|\d{1,2}\.?\d?)(\s*\(.*\))?$/i;
    let sizeSelected = false;

    // Try to click a size using Playwright's locator on all descendants
    const sizeLoc = page.locator(
      '#size-selector *, [data-testid="size-selector"] *',
    );
    const totalSizeEls = await sizeLoc.count();
    console.log(`  Size descendants found: ${totalSizeEls}`);

    for (let i = 0; i < Math.min(totalSizeEls, 50); i++) {
      try {
        const el = sizeLoc.nth(i);
        const rawTxt = ((await el.textContent()) ?? '').trim();
        const txt = rawTxt.split('\n')[0].trim();
        if (txt.length > 20) continue;
        if (!sizePattern.test(txt)) continue;
        const isDisabled = await el.getAttribute('aria-disabled');
        if (isDisabled === 'true') { console.log(`  ✗ "${txt}" aria-disabled, skipping`); continue; }
        await el.click({ timeout: 3000 });
        console.log(`  ✓ size clicked: "${txt}"`);
        await page.waitForTimeout(800);
        // Verify ATB is now enabled — if still disabled, this size is sold out
        const atbEnabled = await page.evaluate(() => {
          const btn = document.querySelector('[data-testid="atb-button"]') as HTMLButtonElement | null;
          return btn ? !btn.disabled : false;
        });
        if (atbEnabled) { sizeSelected = true; break; }
        console.log(`    ATB still disabled after "${txt}" — trying next size`);
      } catch { /* not clickable, try next */ }
    }
    if (!sizeSelected) console.warn('  ✗ no available size found — may be sizeless or sold out');

    await page.waitForTimeout(2000);
    await page.screenshot({ path: '/tmp/nike-02-after-size.png' });

    // Verify ATB button after size selection
    const atbInfo = await page.evaluate(() => {
      const btn = document.querySelector('[data-testid="atb-button"]') as HTMLButtonElement | null;
      return btn ? { found: true, disabled: btn.disabled, text: btn.innerText.trim() } : { found: false };
    });
    console.log(`  ATB after size: ${JSON.stringify(atbInfo)}`);

    // ── 3. Add to Bag ────────────────────────────────────────────────────────
    console.log('\n[3] Adding to Bag…');

    // Root cause of 403: geoloc cookie = cc=NG (Nigeria). Nike's cart API blocks
    // non-US geolocs even when locale is US. Override with Dallas, TX.
    console.log('  Spoofing geoloc cookie to US/TX…');
    await ctx.addCookies([{
      name: 'geoloc',
      value: 'cc=US,rc=TX,tp=vhigh,tz=GMT-5,la=32.77,lo=-96.79',
      domain: '.nike.com',
      path: '/',
      sameSite: 'Lax' as const,
    }]);
    // Reload the page so the new geoloc is picked up by Nike's JS before ATB click
    await page.reload({ waitUntil: 'networkidle', timeout: 30_000 });
    await page.waitForTimeout(2000);
    await dismissPopup(page);

    // Re-select size after reload (page state reset)
    const sizeLocReload = page.locator('#size-selector *, [data-testid="size-selector"] *');
    for (let i = 0; i < Math.min(await sizeLocReload.count(), 50); i++) {
      try {
        const el = sizeLocReload.nth(i);
        const txt = ((await el.textContent()) ?? '').trim().split('\n')[0].trim();
        if (txt.length > 20 || !sizePattern.test(txt)) continue;
        if (await el.getAttribute('aria-disabled') === 'true') continue;
        await el.click({ timeout: 3000 });
        await page.waitForTimeout(600);
        const ok = await page.evaluate(() => !(document.querySelector('[data-testid="atb-button"]') as HTMLButtonElement)?.disabled);
        if (ok) { console.log(`  ✓ re-selected size: "${txt}"`); break; }
      } catch { /* skip */ }
    }

    // Capture the Authorization bearer token Nike uses for API calls
    let nikeAuthToken: string | null = null;
    const apiResponses: { url: string; status: number }[] = [];
    await ctx.route('**/api.nike.com/**', async (route) => {
      const req = route.request();
      const auth = req.headers()['authorization'];
      if (auth && auth.startsWith('Bearer ')) {
        nikeAuthToken = auth;
        console.log(`  [captured] auth token: ${auth.slice(0, 40)}...`);
      }
      await route.continue();
    });
    page.on('response', (resp) => {
      if (resp.url().includes('cart') || resp.url().includes('api.nike.com')) {
        apiResponses.push({ url: resp.url().slice(0, 120), status: resp.status() });
      }
    });

    // Human-like: scroll ATB into view, hover briefly, then click
    const atbSel = '[data-testid="atb-button"]';
    await page.locator(atbSel).scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
    await page.hover(atbSel);
    await page.waitForTimeout(400);
    await page.click(atbSel);
    console.log('  ✓ ATB clicked');

    await page.waitForTimeout(3000);
    await page.screenshot({ path: '/tmp/nike-03a-post-atb.png' });

    if (apiResponses.length > 0) {
      console.log('  Network responses during ATB:');
      apiResponses.forEach((r) => console.log(`    ${r.status} ${r.url}`));
    } else {
      console.warn('  No cart-related API calls detected');
    }
    console.log(`  Auth token captured: ${nikeAuthToken ? 'yes' : 'no'}`);

    const bagNow = await page.evaluate(() => {
      const el = document.querySelector('[aria-label*="Bag Items"]');
      const m = (el?.getAttribute('aria-label') ?? '').match(/Bag Items:\s*(\d+)/);
      return m ? parseInt(m[1]) : -1;
    });
    console.log(`  Bag count after ATB: ${bagNow}`);

    // ── 4. Cart ──────────────────────────────────────────────────────────────
    console.log('\n[4] Navigating to /cart…');
    await page.goto('https://www.nike.com/cart', { waitUntil: 'networkidle', timeout: 30_000 });
    await page.waitForTimeout(2500);
    await dismissPopup(page);

    // Verify cart is not empty
    const cartTitle = await page.title();
    console.log(`    ${cartTitle}`);
    const bagCount = await page.evaluate(() => {
      const el = document.querySelector('[aria-label*="Bag Items"]');
      const m = (el?.getAttribute('aria-label') ?? '').match(/Bag Items:\s*(\d+)/);
      return m ? parseInt(m[1]) : -1;
    });
    console.log(`    Bag count: ${bagCount}`);
    if (bagCount === 0) {
      console.warn('  Cart shows 0 items — ATB may have been blocked by Nike');
      await page.screenshot({ path: '/tmp/nike-03-cart.png' });
      // Continue anyway to see what the checkout page shows
    }
    await page.screenshot({ path: '/tmp/nike-03-cart.png' });

    // ── 5. Checkout ──────────────────────────────────────────────────────────
    console.log('\n[5] Clicking Checkout…');
    // Nike's checkout button: aria-label="Checkout", no testid
    const checkoutSel = await clickFirst(page, [
      'button[aria-label="Checkout"]',
      '[data-testid="checkout-cta-button"]',
      'button:has-text("Checkout")',
    ], 'Checkout');
    if (!checkoutSel) { console.error('  Checkout button not found'); return null; }

    // Wait for navigation or modal to appear
    await page.waitForTimeout(4000);
    const postCheckoutUrl = page.url();
    console.log(`    url after checkout click: ${postCheckoutUrl}`);
    await page.screenshot({ path: '/tmp/nike-04-post-checkout.png' });

    // ── 6. Handle auth modal / guest checkout ────────────────────────────────
    console.log('\n[6] Looking for guest checkout option…');

    // Dump all visible text + buttons to understand what appeared
    const pageContent = await page.evaluate(() => {
      // Look for auth/guest-related text
      const allText = document.body.innerText;
      const idx = Math.max(allText.search(/guest|sign.?in|member|checkout/i), 0);
      return allText.slice(idx, idx + 800);
    });
    console.log('  Page content excerpt:');
    pageContent.split('\n').slice(0, 30).forEach((l) => console.log(`    | ${l}`));

    const guestSel = await clickFirst(page, [
      'button:has-text("Guest Checkout")',
      'a:has-text("Guest Checkout")',
      'button:has-text("Continue as Guest")',
      'a:has-text("Continue as Guest")',
      '[data-qa="guest-checkout-btn"]',
      '[data-testid="guest-checkout"]',
      // Nike may use "Checkout as Guest" or label it differently
      'button:has-text("as Guest")',
    ], 'Guest Checkout');

    await page.waitForTimeout(3500);
    const postGuestUrl = page.url();
    console.log(`    url: ${postGuestUrl}`);
    await page.screenshot({ path: '/tmp/nike-05-post-guest.png' });

    // ── 7. Inspect checkout form ─────────────────────────────────────────────
    const formInputs = await page.evaluate(() =>
      Array.from(document.querySelectorAll('input, select, textarea')).map((el) => ({
        tag: el.tagName, type: el.getAttribute('type') ?? '',
        name: el.getAttribute('name') ?? '', id: el.id,
        placeholder: el.getAttribute('placeholder') ?? '',
        autocomplete: el.getAttribute('autocomplete') ?? '',
        testid: el.getAttribute('data-testid') ?? '',
      })),
    );
    console.log('\n[7] Form inputs on page:');
    dumpInputs(formInputs);

    if (formInputs.length <= 2) {
      console.error('  No address form found — stuck at auth/cart page. Cannot proceed.');
      return null;
    }

    // ── 8. Fill address ──────────────────────────────────────────────────────
    console.log('\n[8] Filling address…');
    await fillField(page, ['input[name="firstName"]', 'input[autocomplete="given-name"]', '#firstName'], ADDR.firstName, 'firstName');
    await fillField(page, ['input[name="lastName"]', 'input[autocomplete="family-name"]', '#lastName'], ADDR.lastName, 'lastName');
    await fillField(page, ['input[name="address1"]', 'input[autocomplete="address-line1"]', '#address1'], ADDR.address1, 'address1');
    await fillField(page, ['input[name="city"]', 'input[autocomplete="address-level2"]', '#city'], ADDR.city, 'city');
    await fillField(page, ['input[name="postalCode"]', 'input[autocomplete="postal-code"]', '#postalCode', '#zipCode'], ADDR.zip, 'zip');
    await fillField(page, ['input[name="phoneNumber"]', 'input[autocomplete="tel"]', '#phoneNumber'], ADDR.phone, 'phone');
    try {
      for (const sel of ['select[name="state"]', '#state', 'select[autocomplete="address-level1"]']) {
        const el = await page.$(sel);
        if (el) { await page.selectOption(sel, ADDR.state); console.log('  ✓ state = TX'); break; }
      }
    } catch { console.warn('  ✗ state dropdown not found'); }

    await page.screenshot({ path: '/tmp/nike-06-form-filled.png' });

    // ── 9. Save and continue ─────────────────────────────────────────────────
    console.log('\n[9] Save and continue…');
    await clickFirst(page, [
      'button:has-text("Save and continue")',
      'button:has-text("Save & Continue")',
      '[data-qa="address-submit-btn"]',
      '[data-testid="address-submit-btn"]',
      'button[type="submit"]',
    ], 'Save and continue');

    // Wait for order summary to recalculate with tax
    await page.waitForTimeout(6000);
    console.log(`    url: ${page.url()}`);
    await page.screenshot({ path: '/tmp/nike-07-after-save.png' });

    // ── 10. Extract tax ──────────────────────────────────────────────────────
    console.log('\n[10] Extracting Estimated Tax…');
    const allText = await page.evaluate(() => document.body.innerText);

    // Show full order summary section
    const taxIdx = allText.search(/Estimated Tax/i);
    if (taxIdx >= 0) {
      console.log('  Order summary:');
      allText.slice(Math.max(0, taxIdx - 80), taxIdx + 250)
        .split('\n').forEach((l) => console.log(`    | ${l}`));
    } else {
      console.warn('  "Estimated Tax" not found on page — dumping 600 chars of page text:');
      console.log(allText.slice(0, 600));
    }

    // Parse: "Estimated Tax\n$X.XX" or "Estimated Tax  $X.XX"
    const m = allText.match(/Estimated\s+Tax\s*\n?\s*\$?([\d,]+\.\d{2})/i);
    if (m) {
      const tax = parseFloat(m[1].replace(/,/g, ''));
      console.log(`  ✓ Estimated Tax: $${tax.toFixed(2)}`);
      return tax;
    }

    // Last-resort: look for any "Tax $X.XX" pattern
    const m2 = allText.match(/Tax\s*\n?\s*\$?([\d,]+\.\d{2})/i);
    if (m2) {
      const tax = parseFloat(m2[1].replace(/,/g, ''));
      // Sanity check: tax should be < subtotal (not a price tag)
      if (tax < 200) {
        console.log(`  ✓ Tax (fallback): $${tax.toFixed(2)}`);
        return tax;
      }
    }

    console.warn('  ✗ Could not extract tax');
    return null;

  } finally {
    await ctx.close();
    await browser.close();
  }
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('══════════════════════════════════════════════════════════');
  console.log(' Nike Checkout Simulation — Tax Capture');
  console.log('══════════════════════════════════════════════════════════');
  console.log(`URL  : ${TARGET_URL}`);
  console.log(`Addr : ${ADDR.address1}, ${ADDR.city} ${ADDR.state} ${ADDR.zip}`);

  const start = Date.now();
  const tax = await simulateNike(TARGET_URL).catch((e) => { console.error(e); return null; });
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);

  console.log('\n══════════════════════════════════════════════════════════');
  if (tax !== null) {
    console.log(` ✓ Estimated Tax: $${tax.toFixed(2)} USD`);
  } else {
    console.log(' ✗ Tax not captured — check /tmp/nike-*.png screenshots');
  }
  console.log(` Time: ${elapsed}s`);
  console.log('══════════════════════════════════════════════════════════');
}

main().catch((e) => { console.error(e); process.exit(1); });
