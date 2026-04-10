import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { LlmGatewayService } from '../../llm/llm-gateway.service';
import type { ProductConfigurationPrice } from '../../products/entities/product.entity';
import { ScrapedProduct } from '../interfaces/scraped-product.interface';
import { parsePriceToDecimalString } from '../utils/normalize-price.util';

/** LLM output shape — must match merge rules below. */
interface LlmRefinedShape {
  title?: string | null;
  price?: string | number | null;
  currency?: string | null;
  compareAtPrice?: string | null;
  brand?: string | null;
  description?: string | null;
  availability?: string | null;
  variants?: Array<{ name: string; options: string[] }> | null;
  configurationPrices?: ProductConfigurationPrice[] | null;
}

/** System message for JSON-only scrape refinement (user prompt has full task). */
const REFINE_SYSTEM_PROMPT =
  'You are a strict e-commerce scrape normalizer. Reply with a single JSON object only — no markdown, no code fences, no commentary.';

function stripHtmlToText(html: string, maxLen: number): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
}

function parseAdapterPrice(s: number | string): number | null {
  const d = parsePriceToDecimalString(
    typeof s === 'number' ? s : String(s),
  );
  if (!d) return null;
  const n = parseFloat(d);
  return Number.isFinite(n) ? n : null;
}

function saneVsReference(
  llm: number,
  adapter: number | null,
): boolean {
  if (adapter == null || adapter <= 0) return llm > 0 && llm < 1_000_000;
  const ratio = llm / adapter;
  return ratio >= 0.25 && ratio <= 4;
}

@Injectable()
export class OpenRouterScrapeRefinementService {
  private readonly logger = new Logger(OpenRouterScrapeRefinementService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly llm: LlmGatewayService,
  ) {}

  isEnabled(): boolean {
    const flag = this.config.get<string>('SCRAPE_OPENROUTER_REFINE')?.trim();
    const on = flag === '1' || flag?.toLowerCase() === 'true';
    return Boolean(on && this.llm.llmAvailable);
  }

  /**
   * Optional lightweight HTML fetch for LLM context (no Playwright second pass).
   * Often blocked on heavy bot sites — refinement still runs on adapter JSON only.
   */
  private async fetchPageTextSnippet(url: string): Promise<string | undefined> {
    try {
      const { data } = await axios.get<string>(url, {
        timeout: 25_000,
        maxContentLength: 2_000_000,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
            '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          Accept:
            'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        validateStatus: (s) => s >= 200 && s < 400,
      });
      if (typeof data !== 'string' || data.length < 200) return undefined;
      const text = stripHtmlToText(data, 18_000);
      return text.length > 400 ? text : undefined;
    } catch {
      return undefined;
    }
  }

  private buildPrompt(
    url: string,
    scraped: ScrapedProduct,
    pageText: string | undefined,
  ): string {
    const base = JSON.stringify(scraped, null, 2);
    const pageBlock = pageText
      ? `\n\nVISIBLE_PAGE_TEXT (may be partial; use as ground truth for prices/sizes when it conflicts with ADAPTER_JSON):\n${pageText}\n`
      : '';
    return `You are a strict product-data normalizer for e-commerce.

URL: ${url}
${pageBlock}
ADAPTER_JSON (from site-specific scraper — may have wrong prices or misaligned variant rows):
${base}

Task: Return ONE JSON object with the SAME schema as ADAPTER_JSON (ScrapedProduct). Fix:
- Base price and currency to match the real selling price for the default/selected variant when possible.
- variants[].name and variants[].options must list every selectable axis (e.g. Size, Color) and values.
- configurationPrices: one row per priced variant combination when the site shows per-size or per-color prices. Each row must have:
  - label (short), originalPrice (decimal string like "49.99"), variantAxis and optionValue matching variants[].name and one of variants[].options for that axis.
  - currency optional per row; available boolean if you can infer.
- compareAtPrice only if there is a real "was" / list price.
- Do NOT invent prices: if unsure, keep the adapter value. Prefer VISIBLE_PAGE_TEXT over ADAPTER_JSON when they disagree on numbers.
- If you cannot improve data, return ADAPTER_JSON unchanged (same numbers).

Return ONLY valid JSON, no markdown.`;
  }

  private parseLlmJson(content: string): LlmRefinedShape | null {
    const trimmed = content.trim();
    const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    try {
      return JSON.parse(jsonMatch[0]) as LlmRefinedShape;
    } catch {
      return null;
    }
  }

  private merge(
    adapter: ScrapedProduct,
    llm: LlmRefinedShape,
  ): ScrapedProduct {
    const adapterBase = parseAdapterPrice(adapter.price);
    const out: ScrapedProduct = { ...adapter };

    if (typeof llm.title === 'string' && llm.title.trim()) {
      out.title = llm.title.trim().slice(0, 500);
    }
    if (typeof llm.brand === 'string' && llm.brand.trim()) {
      out.brand = llm.brand.trim().slice(0, 200);
    }
    if (typeof llm.description === 'string' && llm.description.trim()) {
      out.description = llm.description.trim();
    }
    if (
      typeof llm.availability === 'string' &&
      /in_stock|out_of_stock|unknown/i.test(llm.availability)
    ) {
      out.availability = llm.availability.toLowerCase().replace(/[^a-z_]/g, '');
    }

    if (llm.price != null) {
      const p = parseAdapterPrice(llm.price);
      if (p != null && p > 0 && saneVsReference(p, adapterBase)) {
        out.price = p.toFixed(2);
      }
    }

    if (llm.currency != null && /^[A-Z]{3}$/i.test(String(llm.currency).trim())) {
      out.currency = String(llm.currency).toUpperCase().slice(0, 8);
    }

    if (llm.compareAtPrice != null) {
      const c = parsePriceToDecimalString(String(llm.compareAtPrice));
      if (c && parseFloat(c) > 0) {
        const cmp = parseFloat(c);
        const base = parseAdapterPrice(out.price);
        if (base == null || cmp >= base) out.compareAtPrice = c;
      }
    }

    if (Array.isArray(llm.variants) && llm.variants.length > 0) {
      const cleaned = llm.variants
        .filter(
          (v) =>
            v &&
            typeof v.name === 'string' &&
            v.name.trim() &&
            Array.isArray(v.options) &&
            v.options.length > 0,
        )
        .map((v) => ({
          name: v.name.trim(),
          options: [...new Set(v.options.map((o) => String(o).trim()).filter(Boolean))],
        }));
      if (cleaned.length) out.variants = cleaned;
    }

    if (Array.isArray(llm.configurationPrices) && llm.configurationPrices.length > 0) {
      const rows: ProductConfigurationPrice[] = [];
      for (const row of llm.configurationPrices) {
        if (!row || typeof row !== 'object') continue;
        const op = parsePriceToDecimalString(String(row.originalPrice ?? ''));
        if (!op || parseFloat(op) <= 0) continue;
        const axis = String(row.variantAxis ?? '').trim();
        const opt = String(row.optionValue ?? '').trim();
        if (!axis || !opt) continue;
        rows.push({
          label: String(row.label ?? `${axis} ${opt}`).slice(0, 300),
          originalPrice: op,
          partNumber: row.partNumber,
          sku: row.sku,
          variantAxis: axis,
          optionValue: opt,
          currency: row.currency
            ? String(row.currency).toUpperCase().slice(0, 8)
            : undefined,
          available: row.available,
          displayLabel: row.displayLabel,
          metadata:
            row.metadata && typeof row.metadata === 'object'
              ? (row.metadata as Record<string, unknown>)
              : { source: 'openrouter-refine' },
        });
      }
      if (rows.length) out.configurationPrices = rows;
    }

    return out;
  }

  async refine(url: string, scraped: ScrapedProduct): Promise<ScrapedProduct> {
    if (!this.isEnabled()) return scraped;

    const pageText = await this.fetchPageTextSnippet(url);
    const prompt = this.buildPrompt(url, scraped, pageText);

    try {
      const content = await this.llm.generate(prompt, {
        jsonMode: true,
        systemPrompt: REFINE_SYSTEM_PROMPT,
      });

      if (!content) {
        this.logger.warn('[openrouter] empty response');
        return scraped;
      }

      const parsed = this.parseLlmJson(content);
      if (!parsed) {
        this.logger.warn('[openrouter] could not parse JSON from response');
        return scraped;
      }

      const merged = this.merge(scraped, parsed);
      this.logger.log(
        `[openrouter] refined url=${url} variants=${merged.variants?.length ?? 0} configRows=${merged.configurationPrices?.length ?? 0}`,
      );
      return merged;
    } catch (e) {
      this.logger.warn(
        `[openrouter] refine failed: ${e instanceof Error ? e.message : String(e)}`,
      );
      return scraped;
    }
  }
}
