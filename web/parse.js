/* BİK gazete sayfası ayrıştırıcı (web + güncelleme betiği ortak kullanır) */
const SKIP = /logo|icon|ikon|sprite|banner|reklam|avatar|loading|spinner|placeholder|\.svg(\?|$)|\.gif(\?|$)/i;
const IMG_EXT = /\.(jpe?g|png|webp)(\?|#|$)/i;

function abs(u, base){ try{ return new URL(u, base).href; }catch{ return null; } }

function parseNewspapers(html, base){
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const out = [], seen = new Set();
  doc.querySelectorAll('img').forEach(img=>{
    const raw = img.getAttribute('data-src') || img.getAttribute('data-original') ||
                img.getAttribute('data-lazy') || img.getAttribute('src');
    if(!raw || raw.startsWith('data:') || SKIP.test(raw)) return;
    const w = parseInt(img.getAttribute('width')||'0',10);
    if(w && w < 60) return;                       // küçük ikonları ele

    const a = img.closest('a');
    const href = a && a.getAttribute('href');
    const big = (a && (a.getAttribute('data-src')||a.getAttribute('data-image')||a.getAttribute('data-big'))) ||
                (href && IMG_EXT.test(href) ? href : null) ||
                img.getAttribute('data-big') || img.getAttribute('data-zoom') || raw;

    const thumb = abs(raw, base), full = abs(big, base);
    if(!full || seen.has(full)) return;
    seen.add(full);

    const card = img.closest('[class*="card"],[class*="item"],[class*="gazete"],li,figure,.col,[class*="col-"]');
    const txt = card ? card.textContent.replace(/\s+/g,' ').trim() : '';
    let name = (img.getAttribute('alt')||img.getAttribute('title')||(a&&a.getAttribute('title'))||'').trim();
    if(!name || /^(resim|image|gazete|img)$/i.test(name)) name = txt.slice(0,60);
    if(!name) name = decodeURIComponent(full.split('/').pop().split('?')[0]).replace(IMG_EXT,'');
    // BİK: "20 Kasım 2026 - Cuma tarihli BATI EKSPRES gazetesi ilk sayfası" → "Batı Ekspres"
    name = name.replace(/^.*?tarihli\s+/i, '').replace(/\s+gazetesi\s+ilk\s+sayfas[ıi]\s*$/i, '').trim();
    if(name === name.toLocaleUpperCase('tr-TR')){
      name = name.toLocaleLowerCase('tr-TR').replace(/(^|[\s.(/-])(\p{L})/gu, (m,a,b)=>a+b.toLocaleUpperCase('tr-TR'));
    }
    out.push({ name, thumb, full });
  });
  return out;
}
