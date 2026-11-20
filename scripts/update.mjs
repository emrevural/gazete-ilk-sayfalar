// Günlük veri toplayıcı — GitHub Actions'ta çalışır, web/data/latest.json üretir.
// Sitedeki ayrıştırıcıların AYNISINI (web/parse.js, web/kesan.js) jsdom içinde kullanır.
// Gazete görselleri İNDİRİLMEZ: yalnızca BİK'teki adresleri kaydedilir, ziyaretçinin tarayıcısı
// görseli doğrudan BİK'ten yükler.
import { JSDOM } from "jsdom";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WEB = path.join(ROOT, "web");
const OUT = path.join(WEB, "data", "latest.json");
const BIK = "https://gazete.bik.gov.tr/Uygulamalar/GazeteIlkSayfalar";
const KAYNAK = { edirne: BIK + "?kapsam=yerel&il=37", yaygin: BIK + "?kapsam=yaygin" };
const UA = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131 Mobile Safari/537.36";

async function getHtml(url, tries = 3) {
  for (let i = 1; ; i++) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "tr-TR,tr;q=0.9" }, signal: AbortSignal.timeout(30000) });
      if (!r.ok) throw new Error("HTTP " + r.status);
      return await r.text();
    } catch (e) {
      if (i >= tries) throw new Error(`${url} → ${e.message}`);
      await new Promise(s => setTimeout(s, 2000 * i));
    }
  }
}

// Sitedeki kodu tarayıcı benzeri bir ortamda yükle
const dom = new JSDOM(`<!DOCTYPE html><div id="content"></div><div id="reader"><div id="rsrc"></div><div id="rbody"></div><button id="rclose"></button></div>`,
  { runScripts: "outside-only", url: "https://localhost/" });
const w = dom.window;
w.getHtml = getHtml;
w.eval("var state = { tab: 'yok' };");
w.eval(fs.readFileSync(path.join(WEB, "parse.js"), "utf8") + "\nwindow.parseNewspapers = parseNewspapers;");
w.eval(fs.readFileSync(path.join(WEB, "kesan.js"), "utf8") + "\nwindow.Kesan = Kesan;");
const K = w.Kesan._test;

const eski = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : {};
const yeni = { t: Date.now(), gazete: eski.gazete || {}, tff: eski.tff || null, news: eski.news || null };
const hatalar = [];
const plain = x => JSON.parse(JSON.stringify(x)); // jsdom nesnelerinden arındır

// 1) Gazeteler
try {
  const g = { t: Date.now() };
  for (const [id, url] of Object.entries(KAYNAK)) {
    g[id] = plain(w.parseNewspapers(await getHtml(url), url));
    console.log(`${id}: ${g[id].length} gazete`);
  }
  if (!g.edirne.length && !g.yaygin.length) throw new Error("BİK sayfasında gazete bulunamadı");
  yeni.gazete = g;
} catch (e) { hatalar.push("Gazeteler: " + e.message); }

// 2) Keşanspor — TFF
try {
  const d = plain(await K.loadTff());
  // Eski veride olup bu çalıştırmada gelmeyen maçları koru
  const anahtar = m => m.hafta + "|" + m.evId + "|" + m.depId;
  const yeniler = new Set(d.matches.map(anahtar));
  for (const m of (eski.tff?.matches || [])) if (!yeniler.has(anahtar(m))) d.matches.push(m);
  d.matches.sort((a, b) => a.tarih - b.tarih);
  yeni.tff = d;
  console.log(`TFF: ${d.grupAd}, ${d.standings.length} takım, ${d.matches.length} Keşan maçı`);
} catch (e) { hatalar.push("TFF: " + e.message); }

// 3) Keşanspor — haberler
try {
  yeni.news = plain(await K.loadNews());
  console.log(`Haber: ${yeni.news.items.length}`);
} catch (e) { hatalar.push("Haberler: " + e.message); }

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(yeni));
if (hatalar.length) {
  for (const h of hatalar) console.log("::warning::" + h);
  if (hatalar.length === 3) { console.error("Hiçbir kaynak okunamadı"); process.exit(1); }
}
