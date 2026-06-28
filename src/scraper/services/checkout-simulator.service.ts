import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Page } from 'playwright';
import { PlaywrightService } from '../playwright.service';
import { ProductSource } from '../../common/enums/product-source.enum';
import { parsePriceToDecimalString } from '../utils/normalize-price.util';

/**
 * US forwarding address used for all checkout tax simulations.
 * Dallas, TX — combined state + local sales tax rate ≈ 8.25%.
 * Items are quoted as if shipping here; we capture the marketplace's
 * actual tax calculation for this address rather than using our flat estimate.
 */
export const SIMULATION_ADDRESS = {
  firstName: 'BELIEVE',
  lastName: 'OKOBIA',
  address1: '11969 PLANO RD',
  city: 'DALLAS',
  state: 'TX',
  zip: '75243',
  country: 'US',
  // 214 area code + provided suffix; not a real number but valid format for form validation
  phone: '2145503204',
} as const;

const SIMULATION_TIMEOUT_MS = 90_000;

@Injectable()
export class CheckoutSimulatorService {
  private readonly logger = new Logger(CheckoutSimulatorService.name);
  private readonly enabled: boolean;

  constructor(
    private readonly playwright: PlaywrightService,
    private readonly config: ConfigService,
  ) {
    const flag = this.config.get<string>('CHECKOUT_SIMULATION_ENABLED')?.trim().toLowerCase();
    this.enabled = flag !== 'false' && flag !== '0';
  }

  /**
   * Navigate to the marketplace's guest checkout and return the actual tax
   * shown in the order summary for SIMULATION_ADDRESS.
   * Returns null if the marketplace is unsupported, simulation fails, or is disabled.
   * Never throws — always safe to call fire-and-forget.
   */
  async simulate(url: string, source: ProductSource): Promise<number | null> {
    if (!this.enabled) return null;

    // Nike's Akamai Bot Manager (ak_bmsc) blocks the cart API (api.nike.com/buy/carts/v2)
    // with a 403 for any automated session regardless of cookies or stealth settings.
    // Dallas TX flat rate (8.25%) is accurate and is used as the fallback.
    // Amazon and Walmart use less aggressive bot protection and can be simulated.
    const supported: Partial<Record<ProductSource, (url: string) => Promise<number | null>>> = {
      [ProductSource.AMAZON]: (u) => this.withTimeout(this.simulateAmazon(u)),
      [ProductSource.WALMART]: (u) => this.withTimeout(this.simulateWalmart(u)),
    };

    const handler = supported[source];
    if (!handler) return null;

    try {
      const tax = await handler(url);
      if (tax !== null) {
        this.logger.log(
          `[checkout-sim] source=${source} url=${url} taxAmountUsd=${tax.toFixed(2)}`,
        );
      } else {
        this.logger.warn(
          `[checkout-sim] source=${source} url=${url} result=null — could not extract tax`,
        );
      }
      return tax;
    } catch (e) {
      this.logger.warn(
        `[checkout-sim] source=${source} url=${url} error=${e instanceof Error ? e.message : String(e)}`,
      );
      return null;
    }
  }

  // ── Nike ─────────────────────────────────────────────────────────────────────
  // Nike's cart API (api.nike.com/buy/carts/v2) is protected by Akamai Bot Manager.
  // The ak_bmsc sensor cookie fingerprints the browser and the API returns 403 for
  // any automated session, regardless of stealth settings or cookie manipulation.
  // Simulation is therefore not feasible without a commercial anti-bot proxy.
  // Nike checkout tax at Dallas TX (our forwarding address) = 8.25% flat, which is
  // used as the fallback estimate in marketplace-estimates.ts.

  // ── Amazon ───────────────────────────────────────────────────────────────────

  private async simulateAmazon(url: string): Promise<number | null> {
    const context = await this.playwright.newScrapeContext(
      { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36' },
      url,
    );
    try {
      const page = await context.newPage();

      // 1. Load PDP
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await page.waitForTimeout(2000);

      // 2. Add to Cart
      const addClicked = await this.clickFirst(page, [
        '#add-to-cart-button',
        'input[id="add-to-cart-button"]',
        'button[name="submit.add-to-cart"]',
      ]);
      if (!addClicked) {
        this.logger.warn('[checkout-sim:amazon] add-to-cart not found');
        return null;
      }
      await page.waitForTimeout(2500);

      // 3. Proceed to checkout (skip "just added" upsell modal if shown)
      await this.clickFirst(page, [
        '#hlb-ptc-btn',        // "Proceed to Checkout" in the cart flyout
        '#sc-buy-box-ptc-button',
        'a:has-text("Proceed to checkout")',
        'input[name="proceedToRetailCheckout"]',
      ]);
      await page.waitForTimeout(3000);

      // 4. Guest checkout — sign in page
      await this.clickFirst(page, [
        '#createAccountSubmit',  // "Continue as guest" on newer Amazon checkout
        '#ap_guest_submit',
        'input[name="continue"]',
        'a:has-text("Continue as guest")',
      ]);
      await page.waitForTimeout(2000);

      // 5. Fill address
      await this.fillAmazonAddress(page);
      await page.waitForTimeout(3000);

      // 6. Extract tax
      return await this.extractTaxFromPage(page, [
        '#order-summary-tax-amount',
        '#subtotals-marketplace-table .estimated-tax-amount',
        'tr:has-text("Estimated tax") td:last-child',
        'span[id*="tax"]',
        'td.grand-total-price ~ td.price-align',
      ]);
    } finally {
      await context.close();
    }
  }

  private async fillAmazonAddress(page: Page): Promise<void> {
    const addr = SIMULATION_ADDRESS;
    const fill = async (sel: string, value: string) => {
      try { const el = await page.$(sel); if (el) await el.fill(value); } catch { /* ignore */ }
    };

    await fill('#address-ui-widgets-enterAddressFullName', `${addr.firstName} ${addr.lastName}`);
    await fill('#address-ui-widgets-enterAddressLine1', addr.address1);
    await fill('#address-ui-widgets-enterAddressCity', addr.city);
    await fill('#address-ui-widgets-enterAddressPostalCode', addr.zip);
    await fill('#address-ui-widgets-enterAddressPhoneNumber', addr.phone);

    try {
      await page.selectOption('#address-ui-widgets-enterAddressStateOrRegion', addr.state);
    } catch { /* ignore */ }

    await this.clickFirst(page, [
      '#address-ui-widgets-form-submit-button',
      'input[name="address-ui-widgets-submit-button"]',
      'button:has-text("Use this address")',
    ]);
  }

  // ── Walmart ──────────────────────────────────────────────────────────────────

  private async simulateWalmart(url: string): Promise<number | null> {
    const context = await this.playwright.newScrapeContext(
      { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36' },
      url,
    );
    try {
      const page = await context.newPage();

      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await page.waitForTimeout(2000);

      const addClicked = await this.clickFirst(page, [
        'button[data-automation-id="add-to-cart"]',
        'button:has-text("Add to cart")',
        '[data-testid="add-to-cart-btn"]',
      ]);
      if (!addClicked) return null;
      await page.waitForTimeout(2000);

      await this.clickFirst(page, [
        'button:has-text("Continue to checkout")',
        'button:has-text("Checkout")',
        'a:has-text("Checkout")',
      ]);
      await page.waitForTimeout(3000);

      // Walmart shows zip-based tax estimate without login
      const zipInput = await page.$('input[placeholder*="ZIP"]');
      if (zipInput) {
        await zipInput.fill(SIMULATION_ADDRESS.zip);
        await this.clickFirst(page, ['button:has-text("Apply")', 'button[type="submit"]']);
        await page.waitForTimeout(2000);
      }

      return await this.extractTaxFromPage(page, [
        '[data-automation-id="tax"]',
        'span:has-text("Estimated tax") + span',
        '.cart-summary-tax-amount',
      ]);
    } finally {
      await context.close();
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  private async clickFirst(page: Page, selectors: string[]): Promise<boolean> {
    for (const sel of selectors) {
      try {
        const el = await page.$(sel);
        if (el) {
          await el.click();
          return true;
        }
      } catch { /* try next */ }
    }
    return false;
  }

  private async extractTaxFromPage(page: Page, selectors: string[]): Promise<number | null> {
    for (const sel of selectors) {
      try {
        const el = await page.$(sel);
        if (!el) continue;
        const text = await el.textContent();
        if (!text) continue;
        const parsed = parsePriceToDecimalString(text);
        if (parsed) {
          const n = parseFloat(parsed);
          if (n >= 0) return n;
        }
      } catch { /* try next */ }
    }

    // Broad fallback: scan all visible text for "tax" adjacent to a price
    const taxText = await page.evaluate(() => {
      const allText = document.body.innerText;
      const match = allText.match(/(?:estimated\s+)?tax[:\s]+\$?([\d,]+(?:\.\d{1,2})?)/i);
      return match ? match[1] : null;
    });
    if (taxText) {
      const parsed = parsePriceToDecimalString(taxText.replace(/,/g, ''));
      if (parsed) return parseFloat(parsed);
    }

    return null;
  }

  private async withTimeout<T>(promise: Promise<T>): Promise<T | null> {
    return Promise.race([
      promise,
      new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), SIMULATION_TIMEOUT_MS),
      ),
    ]);
  }
}
