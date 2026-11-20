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
      // TFF windows-1254 (Türkçe) kullanıyor; karakter setini başlıktan ya da <meta>'dan bul
      const buf = Buffer.from(await r.arrayBuffer());
      let cs = (r.headers.get("content-type") || "").match(/charset=([\w-]+)/i)?.[1];
      if (!cs) cs = buf.subarray(0, 4096).toString("latin1").match(/<meta[^>]+charset=["']?([\w-]+)/i)?.[1];
      cs = (cs || "utf-8").toLowerCase();
      if (/^(iso-8859-9|latin5|windows-1254|cp1254)$/.test(cs)) cs = "windows-1254";
      try { return new TextDecoder(cs).decode(buf); } catch { return new TextDecoder("utf-8").decode(buf); }
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
w.eval(fs.readFileSync(path.join(WEB, "kesan.js"), "utf8") + "\nwindow.Kesan = Kesan; window.KESAN_AYAR = KESAN_AYAR;");
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

// 3) Keşanspor — haberler (Bing; boş gelirse Google Haberler)
async function googleNews() {
  const url = "https://news.google.com/rss/search?q=" + encodeURIComponent("Keşanspor") + "&hl=tr&gl=TR&ceid=TR:tr";
  const xml = new w.DOMParser().parseFromString(await getHtml(url), "text/xml");
  const tag = (it, n) => it.getElementsByTagName(n)[0]?.textContent.trim() || "";
  const items = [...xml.getElementsByTagName("item")].map(it => {
    const kaynak = tag(it, "source");
    let baslik = tag(it, "title");
    if (kaynak && baslik.endsWith(" - " + kaynak)) baslik = baslik.slice(0, -(kaynak.length + 3));
    return { baslik, url: tag(it, "link"), kaynak, tarih: Date.parse(tag(it, "pubDate")) || 0, ozet: "", resim: "" };
  }).filter(n => /keşan/i.test(n.baslik)).sort((a, b) => b.tarih - a.tarih).slice(0, 20);
  return { items, t: Date.now() };
}
// Google Haberler bağlantısını gerçek haber adresine çevir (yeni "CBMi…" biçimi imzalı istek ister)
async function googleGercekAdres(gurl) {
  try {
    const id = new URL(gurl).pathname.split("/").pop();
    const html = await getHtml("https://news.google.com/rss/articles/" + id, 1);
    const sg = html.match(/data-n-a-sg="([^"]+)"/)?.[1], ts = html.match(/data-n-a-ts="([^"]+)"/)?.[1];
    if (!sg || !ts) return null;
    const ic = `["garturlreq",[["X","X",["X","X"],null,null,1,1,"US:en",null,1,null,null,null,null,null,0,1],"X","X",1,[1,1,1],1,1,null,0,0,null,0],"${id}",${ts},"${sg}"]`;
    const body = "f.req=" + encodeURIComponent(JSON.stringify([[["Fbv4je", ic, null, "generic"]]]));
    const r = await fetch("https://news.google.com/_/DotsSplashUi/data/batchexecute", {
      method: "POST", body, signal: AbortSignal.timeout(15000),
      headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8", "User-Agent": UA },
    });
    const t = await r.text();
    const json = JSON.parse(t.split("\n\n")[1]);
    return JSON.parse(json[0][2])[1] || null;
  } catch (e) { console.log("Google adres çözülemedi: " + e.message); return null; }
}

// Haber sitesinin kendi paylaşım önizlemesi (og:description / og:image) — tam metin alınmaz
async function onizleme(url) {
  const html = await getHtml(url, 1);
  const doc = new w.DOMParser().parseFromString(html, "text/html");
  const meta = n => doc.querySelector(`meta[property="${n}"],meta[name="${n}"]`)?.getAttribute("content")?.trim() || "";
  let ozet = (meta("og:description") || meta("description") || meta("twitter:description")).replace(/\s+/g, " ");
  if (ozet.length > 400) ozet = ozet.slice(0, 400).replace(/\s+\S*$/, "") + "…";
  let resim = meta("og:image") || meta("twitter:image");
  try { resim = resim ? new URL(resim, url).href.replace(/^http:/, "https:") : ""; } catch { resim = ""; }
  return { ozet, resim };
}

try {
  let n = null;
  try { n = plain(await K.loadNews()); console.log(`Bing: ${n.items.length}`); } catch (e) { console.log("Bing: " + e.message); }
  if (!n || !n.items.length) {
    // Bing'i Türkiye pazarı ve masaüstü tarayıcı kimliğiyle bir kez daha dene
    try {
      w.KESAN_AYAR.haberRss = 'https://www.bing.com/news/search?q=Ke%C5%9Fanspor&format=rss&setlang=tr-TR&mkt=tr-TR&cc=TR';
      n = plain(await K.loadNews()); console.log(`Bing (tr-TR): ${n.items.length}`);
    } catch (e) { console.log("Bing (tr-TR): " + e.message); }
  }
  if (!n || !n.items.length) { console.log("Bing boş, Google Haberler deneniyor"); n = await googleNews(); }
  if (!n.items.length) throw new Error("hiç haber bulunamadı");

  // Detay: önceki çalıştırmadan özeti olanları koru, eksiklerini haber sitesinin önizlemesinden doldur
  const onceki = new Map((eski.news?.items || []).filter(x => x.ozet).map(x => [x.baslik, x]));
  let dolan = 0;
  for (const it of n.items) {
    const o = onceki.get(it.baslik);
    if (!it.ozet && o) { it.ozet = o.ozet; it.resim = it.resim || o.resim || ""; if (o.gercekUrl) it.gercekUrl = o.gercekUrl; continue; }
    if (it.ozet && it.resim) continue;
    let adres = it.url;
    if (/news\.google\.com/.test(adres)) adres = await googleGercekAdres(adres);
    if (!adres) continue;
    it.gercekUrl = adres;
    try {
      const on = await onizleme(adres);
      if (!it.ozet && on.ozet) { it.ozet = on.ozet; dolan++; }
      if (!it.resim && on.resim) it.resim = on.resim;
    } catch (e) { console.log(`Önizleme alınamadı (${adres}): ${e.message}`); }
  }
  yeni.news = n;
  console.log(`Haber: ${n.items.length} (yeni detay: ${dolan}, detaylı toplam: ${n.items.filter(x => x.ozet).length})`);
} catch (e) { hatalar.push("Haberler: " + e.message); }

// Teşhis: birkaç büyük görselin durumu ve boyutu
async function gorselBilgi(u) {
  try {
    const t0 = Date.now();
    const r = await fetch(u, { headers: { "User-Agent": UA, "Referer": "https://gazete.bik.gov.tr/" }, signal: AbortSignal.timeout(40000) });
    const b = Buffer.from(await r.arrayBuffer());
    let en = null, boy = null;
    if (b[0] === 0xFF && b[1] === 0xD8) { // JPEG boyutu (SOF)
      for (let i = 2; i < b.length - 9;) { if (b[i] !== 0xFF) { i++; continue; } const m = b[i+1];
        if (m >= 0xC0 && m <= 0xC3) { boy = b.readUInt16BE(i+5); en = b.readUInt16BE(i+7); break; }
        i += 2 + b.readUInt16BE(i+2); }
    }
    return { durum: r.status, tur: r.headers.get("content-type"), kb: Math.round(b.length/1024), en, boy, sn: (Date.now()-t0)/1000,
             bas: b[0] === 0xFF ? "jpeg" : b.subarray(0, 60).toString("latin1") };
  } catch (e) { return { u, hata: e.message }; }
}
const teshis = [];
let cerez = "";
async function gorselCerezle(u, sayfa) {
  try {
    if (!cerez) {
      const r0 = await fetch(sayfa, { headers: { "User-Agent": UA } });
      cerez = (r0.headers.getSetCookie?.() || []).map(c => c.split(";")[0]).join("; ");
    }
    const r = await fetch(u, { headers: { "User-Agent": UA, "Referer": sayfa, "Cookie": cerez, "Accept": "image/avif,image/webp,image/*,*/*;q=0.8" }, signal: AbortSignal.timeout(40000) });
    const b = Buffer.from(await r.arrayBuffer());
    return { durum: r.status, tur: r.headers.get("content-type"), kb: Math.round(b.length / 1024), cerezVar: !!cerez };
  } catch (e) { return { hata: e.message }; }
}
for (const [k, sayfa] of Object.entries(KAYNAK)) {
  const html = await getHtml(sayfa).catch(e => "HATA " + e.message);
  // ilk gazete kartının ham HTML'i ve sayfadaki tüm farklı bağlantı kalıpları
  const i = html.search(/first_pages/);
  const kalip = [...new Set([...html.matchAll(/(?:href|src|data-[\w-]+)="([^"]*(?:first_pages|IlkSayfa|Gazete)[^"]*)"/gi)].map(m => m[1].replace(/\d+/g, "#")))].slice(0, 15);
  const g = (yeni.gazete[k] || [])[0];
  teshis.push({ k, parca: i >= 0 ? html.slice(Math.max(0, i - 700), i + 700) : html.slice(0, 500), kalip,
                fullCerez: g ? await gorselCerezle(g.full, sayfa) : null, thumbCerez: g ? await gorselCerezle(g.thumb, sayfa) : null });
}

// Siteye küçük bir durum özeti (sorun ayıklamak için)
yeni.durum = {
  t: Date.now(),
  edirne: yeni.gazete.edirne?.length || 0, ulusal: yeni.gazete.yaygin?.length || 0,
  mac: yeni.tff?.matches?.length || 0, haber: yeni.news?.items?.length || 0,
  detayli: yeni.news?.items?.filter(x => x.ozet).length || 0, hatalar, teshis,
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(yeni));
if (hatalar.length) {
  for (const h of hatalar) console.log("::warning::" + h);
  if (hatalar.length === 3) { console.error("Hiçbir kaynak okunamadı"); process.exit(1); }
}
