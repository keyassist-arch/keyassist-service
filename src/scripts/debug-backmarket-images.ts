import * as dotenv from 'dotenv';
dotenv.config();
import axios from 'axios';

const URL_TO_TEST = 'https://www.backmarket.com/en-us/p/iphone-15-plus';
const token = process.env.SCRAPE_DO_TOKEN?.trim();

async function main() {
  const params = new URLSearchParams({ token: token!, url: URL_TO_TEST, super: 'true', wait: '3000', render: 'true' });
  console.log('Fetching...');
  const { data: html } = await axios.get<string>(`http://api.scrape.do/?${params.toString()}`, { timeout: 60_000, maxContentLength: 10_000_000 });
  console.log('HTML length:', html.length);

  const scriptRe = /<script[^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  type NuxtNode = unknown;
  let arr: NuxtNode[] | null = null;
  while ((m = scriptRe.exec(html)) !== null) {
    const body = m[1].trim();
    if (body.startsWith('[') && body.length > 10_000) {
      try { arr = JSON.parse(body) as NuxtNode[]; break; } catch {}
    }
  }
  if (!arr) { console.log('no nuxt array'); return; }
  console.log('Nuxt array length:', arr.length);

  let productIdx: number | null = null;
  for (let i = 0; i < arr.length; i++) {
    const node = arr[i];
    if (node && typeof node === 'object' && !Array.isArray(node)) {
      for (const k of Object.keys(node as object)) {
        if (k.startsWith('pp-product-')) productIdx = (node as Record<string, number>)[k];
      }
    }
    if (productIdx !== null) break;
  }
  console.log('productIdx =', productIdx);
  if (productIdx === null) return;

  const pn = arr[productIdx] as Record<string, unknown>;
  console.log('product node keys:', Object.keys(pn));

  const imagesIdx = pn['images'];
  console.log('\nimages field value:', imagesIdx, '(type:', typeof imagesIdx, ')');
  if (typeof imagesIdx === 'number') {
    const imgs = arr[imagesIdx];
    console.log('images node (raw):', JSON.stringify(imgs)?.slice(0, 600));
    if (Array.isArray(imgs) && imgs.length > 0) {
      const firstRef = imgs[0];
      if (typeof firstRef === 'number') {
        const imgObj = arr[firstRef];
        console.log('\nfirst image object:', JSON.stringify(imgObj)?.slice(0, 400));
        if (imgObj && typeof imgObj === 'object' && !Array.isArray(imgObj)) {
          console.log('first image keys:', Object.keys(imgObj as object));
          for (const [k, v] of Object.entries(imgObj as Record<string, unknown>)) {
            const resolved = typeof v === 'number' ? arr[v] : v;
            console.log(`  ${k}:`, typeof resolved === 'string' ? resolved.slice(0, 100) : resolved);
          }
        }
      }
    }
  }

  // Also check CDN pattern in HTML
  const cdnMatches = (html.match(/d2e6ccujb3mkqf\.cloudfront\.net\/[^"']+/g) ?? []).slice(0, 3);
  console.log('\nCloudfront CDN matches in HTML:', cdnMatches.length > 0 ? cdnMatches : 'none');

  const bmImgMatches = (html.match(/https:\/\/[^"']*backmarket[^"']+\.(?:jpg|jpeg|png|webp)/gi) ?? []).slice(0, 3);
  console.log('Back Market image URLs in HTML:', bmImgMatches.length > 0 ? bmImgMatches : 'none');

  // Check for any URL patterns that look like product images
  const genericImgMatches = (html.match(/https:\/\/[^"']{30,200}\.(?:jpg|jpeg|png|webp)/gi) ?? []).slice(0, 5);
  console.log('Generic image URLs in HTML (first 5):', genericImgMatches);
}
main().catch(console.error);
