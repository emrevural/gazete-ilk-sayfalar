/* =========================================================
   KEŞANSPOR — Haberler, Fikstür/Skorlar, Puan Durumu
   Veri: TFF (tff.org) + Bing Haberler RSS — APK içinde canlı çekilir
   ========================================================= */
const KESAN_AYAR = {
  kulupID: '11183',                                   // TFF'de KEŞAN SPOR
  tffLig:  'https://www.tff.org/Default.aspx?pageID=1596', // Profesyonelliğe Geçiş Ligi (BAL) puan/fikstür
  varsayilanGrup: '3942',                             // 2026-27: 5. Grup (bulunamazsa otomatik aranır)
  haberRss: 'https://www.bing.com/news/search?q=Ke%C5%9Fanspor&format=rss&setlang=tr',
  onbellekDk: 15,
};

const Kesan = (() => {
  // Alt sekme adres çubuğundan okunur/yazılır: #kesanspor-haberler, -maclar, -puan, -lig
  const ALT = { haber:'haberler', fikstur:'maclar', puan:'puan', lig:'lig' };
  const altHash = () => { const p = decodeURIComponent(location.hash.slice(1)).toLowerCase().split('-');
                          return p[0] === 'kesanspor' ? Object.keys(ALT).find(k => ALT[k] === p[1]) : null; };
  let view = altHash() || 'fikstur';
  let data = null;                // { grup, grupAd, standings, matches, t }
  let news = null;
  let busy = false;

  const el = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const kid = a => ((a && a.getAttribute('href') || '').match(/kulupID=(\d+)/i) || [])[1];
  const trUp = s => s.toLocaleUpperCase('tr-TR');
  const title = s => s.toLocaleLowerCase('tr-TR').replace(/(^|[\s.(/-])(\p{L})/gu, (m,a,b)=>a+b.toLocaleUpperCase('tr-TR'))
                      .replace(/ Spor Kulübü$/,' SK');
  const cache = {
    get(k){ try{ return JSON.parse(localStorage.getItem('ks_'+k)||'null'); }catch{ return null; } },
    set(k,v){ try{ localStorage.setItem('ks_'+k, JSON.stringify(v)); }catch{} },
  };
  const parse = html => new DOMParser().parseFromString(html, 'text/html');

  /* ---------- TFF ayrıştırma ---------- */
  function parseStandings(doc){
    const rows = [];
    doc.querySelectorAll('tr').forEach(tr => {
      if(tr.querySelector('table')) return;
      const a = tr.querySelector('a[href*="kulupID" i]');
      if(!a) return;
      const m = a.textContent.trim().match(/^(\d+)\.\s*(.+)$/);
      if(!m) return;
      const nums = [...tr.children].slice(1).map(td => td.textContent.trim()).filter(t => /^-?\d+$/.test(t)).map(Number);
      if(nums.length < 8) return;
      const [O,G,B,M,A,Y,AV,P] = nums;
      rows.push({ sira:+m[1], ad:m[2].trim(), id:kid(a), O,G,B,M,A,Y,AV,P });
    });
    // aynı tablo birden fazla kez çıkabilir → sıraya göre tekilleştir
    const seen = new Set();
    return rows.filter(r => !seen.has(r.sira) && seen.add(r.sira)).sort((a,b)=>a.sira-b.sira);
  }

  function parseMatches(doc, hafta){
    const out = [];
    doc.querySelectorAll('tr').forEach(tr => {
      if(tr.querySelector('table')) return;
      const teams = [...tr.querySelectorAll('a[href*="kulupID" i]')];
      if(teams.length !== 2) return;
      const dm = tr.textContent.match(/(\d{2})\.(\d{2})\.(\d{4})(?:\s+(\d{2}):(\d{2}))?/);
      if(!dm) return;
      const cells = [...tr.children];
      const hi = cells.findIndex(c => c.contains(teams[0])), ai = cells.findIndex(c => c.contains(teams[1]));
      const between = cells.slice(hi+1, ai).map(c => c.textContent.trim()).join(' ');
      const sm = between.match(/(\d+)\s*-\s*(\d+)/);
      const macA = tr.querySelector('a[href*="macId" i]');
      out.push({
        hafta,
        tarih: new Date(+dm[3], +dm[2]-1, +dm[1], +(dm[4]||0), +(dm[5]||0)).getTime(),
        saatVar: !!dm[4],
        ev: teams[0].textContent.trim(), evId: kid(teams[0]),
        dep: teams[1].textContent.trim(), depId: kid(teams[1]),
        evG: sm ? +sm[1] : null, depG: sm ? +sm[2] : null,
        macId: macA ? ((macA.getAttribute('href').match(/macId=(\d+)/i)||[])[1]) : null,
      });
    });
    return out;
  }

  const groupUrl = (g, hafta) => `${KESAN_AYAR.tffLig}&grupID=${g}` + (hafta ? `&hafta=${hafta}` : '');

  async function findGroup(){
    const tryG = async g => {
      const doc = parse(await getHtml(groupUrl(g)));
      return parseStandings(doc).some(r => r.id === KESAN_AYAR.kulupID) ? doc : null;
    };
    const known = cache.get('grup') || KESAN_AYAR.varsayilanGrup;
    let doc = await tryG(known).catch(()=>null);
    if(doc) return { grup: known, doc };
    // Sezon/grup değiştiyse tüm grupları tara
    const base = parse(await getHtml(KESAN_AYAR.tffLig));
    const ids = [...new Set([...base.querySelectorAll('a[href*="grupID="]')]
                 .map(a => (a.getAttribute('href').match(/grupID=(\d+)/)||[])[1]).filter(Boolean))];
    for(const g of ids){
      doc = await tryG(g).catch(()=>null);
      if(doc){ cache.set('grup', g); return { grup: g, doc }; }
    }
    throw new Error('Keşan Spor TFF gruplarında bulunamadı');
  }

  async function pool(items, n, fn){
    const res = []; let i = 0;
    await Promise.all(Array.from({length:n}, async () => {
      while(i < items.length){ const k = i++; res[k] = await fn(items[k]).catch(()=>[]); }
    }));
    return res;
  }

  async function loadTff(){
    const { grup, doc } = await findGroup();
    const standings = parseStandings(doc);
    const grupAd = ([...doc.querySelectorAll('a,span,td')].map(e=>e.textContent.trim())
                    .find(t => /^\d+\.\s*GRUP\s*\(/i.test(t)) || '').replace(/\s*\(.*$/,'');
    const weeks = [...doc.querySelectorAll('a[href*="hafta="]')]
                    .map(a => +((a.getAttribute('href').match(/hafta=(\d+)/)||[])[1]||0));
    const maxW = Math.max(...weeks, 1);
    const lists = await pool(Array.from({length:maxW}, (_,i)=>i+1), 4,
                    async w => parseMatches(parse(await getHtml(groupUrl(grup, w))), w));
    const seen = new Set();
    const tum = lists.flat()
      .filter(m => { const k = m.hafta+'|'+m.evId+'|'+m.depId; return !seen.has(k) && seen.add(k); })
      .sort((a,b) => a.hafta - b.hafta || a.tarih - b.tarih)
      .map(({macId, ...m}) => m);
    const matches = tum.filter(m => m.evId === KESAN_AYAR.kulupID || m.depId === KESAN_AYAR.kulupID)
      .sort((a,b) => a.tarih - b.tarih || a.hafta - b.hafta);
    const gm = doc.body.textContent.match(/\((\d+)\.\s*hafta\)/i);
    return { grup, grupAd, standings, matches, tum, haftaSayisi: maxW, guncelHafta: gm ? +gm[1] : null, t: Date.now() };
  }

  /* ---------- Haberler (Bing RSS) ---------- */
  async function loadNews(){
    const xml = new DOMParser().parseFromString(await getHtml(KESAN_AYAR.haberRss), 'text/xml');
    const tag = (it, n) => { const e = it.getElementsByTagName(n)[0]; return e ? e.textContent.trim() : ''; };
    const items = [...xml.getElementsByTagName('item')].map(it => {
      const link = tag(it,'link');
      let url = link; try{ url = new URL(link).searchParams.get('url') || link; }catch{}
      const img = tag(it,'News:Image');
      return {
        baslik: tag(it,'title'), ozet: tag(it,'description'), url,
        kaynak: tag(it,'News:Source') || (()=>{ try{ return new URL(url).hostname.replace(/^www\./,''); }catch{ return ''; } })(),
        tarih: Date.parse(tag(it,'pubDate')) || 0,
        resim: img ? img.replace(/^http:/,'https:') + '&w=240&h=180&c=14' : '',
      };
    }).filter(n => /keşan/i.test(n.baslik + ' ' + n.ozet));
    items.sort((a,b) => b.tarih - a.tarih);
    return { items, t: Date.now() };
  }

  /* ---------- Görünüm ---------- */
  const fmtDate = (t, saat=true) => new Date(t).toLocaleString('tr-TR',
      saat ? {weekday:'short', day:'numeric', month:'short', hour:'2-digit', minute:'2-digit'}
           : {day:'numeric', month:'long', year:'numeric'});
  const sonuc = m => {
    if(m.evG == null) return null;
    const me = m.evId === KESAN_AYAR.kulupID ? [m.evG, m.depG] : [m.depG, m.evG];
    return me[0] > me[1] ? 'W' : me[0] < me[1] ? 'L' : 'D';
  };
  const harf = { W:'G', D:'B', L:'M' };

  function matchCard(m, cls=''){
    const r = sonuc(m), meH = m.evId === KESAN_AYAR.kulupID;
    const score = m.evG != null
      ? `<div class="score ${r}">${m.evG} - ${m.depG}</div>`
      : `<div class="score up">${m.saatVar ? new Date(m.tarih).toLocaleTimeString('tr-TR',{hour:'2-digit',minute:'2-digit'}) : 'vs'}</div>`;
    const g = m.goller || [];
    const det = (g.length || m.stad || m.hakem) ? `<div class="mdet">
        ${g.map(x=>`<div class="gol ${x.takim==='dep'?'r':''}">⚽ ${esc(x.dk||'')}' ${esc(title(x.oyuncu||''))}</div>`).join('')}
        ${m.stad ? `<div class="minfo">🏟 ${esc(title(m.stad))}</div>` : ''}
        ${m.hakem ? `<div class="minfo">Hakem: ${esc(title(m.hakem))}</div>` : ''}</div>` : '';
    return `<div class="match ${cls} ${det?'hasdet':''}" onclick="this.classList.toggle('open')">
      <div class="meta"><span>${m.hafta}. Hafta</span><span>${fmtDate(m.tarih, m.saatVar)}</span></div>
      <div class="row">
        <div class="t r ${meH?'me':''}">${esc(title(m.ev))}</div>${score}<div class="t ${!meH?'me':''}">${esc(title(m.dep))}</div>
      </div>${det}</div>`;
  }

  function header(){
    const me = data && data.standings.find(r => r.id === KESAN_AYAR.kulupID);
    const played = data ? data.matches.filter(m => m.evG != null) : [];
    const form = played.slice(-5).map(sonuc);
    return `<div class="ks-head">
      <div class="ks-crest">K</div>
      <div><h2>Keşanspor</h2>
        <div class="sub">${data ? 'Prof. Geçiş Ligi · ' + esc(title(data.grupAd || 'Grup')) : 'Yükleniyor…'}</div>
        ${form.length ? `<div class="form" style="margin-top:6px">${form.map(f=>`<i class="${f}">${harf[f]}</i>`).join('')}</div>` : ''}
      </div>
      ${me ? `<div class="ks-stats"><div><b>${me.sira}.</b><span>Sıra</span></div><div><b>${me.P}</b><span>Puan</span></div></div>` : ''}
    </div>
    <div class="seg">
      <button data-v="haber" class="${view==='haber'?'on':''}">Haberler</button>
      <button data-v="fikstur" class="${view==='fikstur'?'on':''}">Maçlar</button>
      <button data-v="puan" class="${view==='puan'?'on':''}">Puan</button>
      <button data-v="lig" class="${view==='lig'?'on':''}">Lig</button>
    </div>`;
  }

  function bodyFikstur(){
    if(!data) return '';
    const now = Date.now();
    const played = data.matches.filter(m => m.evG != null);
    const coming = data.matches.filter(m => m.evG == null && m.tarih >= now - 3*3600e3);
    let h = '';
    if(coming[0]) h += `<div class="sec-title">Sıradaki maç</div>` + matchCard(coming[0], 'next');
    if(played.length) h += `<div class="sec-title">Önceki skorlar</div>` + played.slice().reverse().map(m=>matchCard(m)).join('');
    if(coming.length > 1) h += `<div class="sec-title">Sonraki maçlar</div>` + coming.slice(1).map(m=>matchCard(m)).join('');
    if(!h) h = '<div class="status">Fikstür bilgisi bulunamadı.</div>';
    if((window.BULUT||window.STATIK) && played.length + coming.length < 4)
      h += '<div class="small">Tam fikstür bir sonraki otomatik güncellemede eklenecek.</div>';
    return h + `<div class="small">Kaynak: TFF · ${fmtDate(data.t)} güncellendi</div>`;
  }

  function bodyPuan(){
    if(!data) return '';
    return `<table class="st"><thead><tr><th>#</th><th style="text-align:left">Takım</th><th>O</th><th>G</th><th>B</th><th>M</th><th>AV</th><th>P</th></tr></thead><tbody>
      ${data.standings.map(r => `<tr class="${r.id===KESAN_AYAR.kulupID?'me':''}"><td>${r.sira}</td><td class="tm">${esc(title(r.ad))}</td>
        <td>${r.O}</td><td>${r.G}</td><td>${r.B}</td><td>${r.M}</td><td>${r.AV>0?'+':''}${r.AV}</td><td class="p">${r.P}</td></tr>`).join('')}
      </tbody></table><div class="small">Kaynak: TFF · ${fmtDate(data.t)} güncellendi</div>`;
  }

  /* ---------- Lig: hafta seçici + maç programı + form'lu puan durumu + çapraz tablo ---------- */
  let ligHafta = null;
  function formOf(tum, id){
    return tum.filter(m => m.evG != null && (m.evId === id || m.depId === id))
      .sort((a,b) => a.tarih - b.tarih).slice(-5).map(m => {
        const [a,b] = m.evId === id ? [m.evG, m.depG] : [m.depG, m.evG];
        return a > b ? 'W' : a < b ? 'L' : 'D';
      });
  }
  function bodyLig(){
    if(!data) return '';
    const tum = data.tum || [];
    if(!tum.length) return '<div class="status">Lig programı bir sonraki güncellemede eklenecek.</div>';
    const n = data.haftaSayisi || Math.max(...tum.map(m=>m.hafta));
    if(ligHafta == null){
      const oynanmamis = tum.filter(m => m.evG == null).map(m => m.hafta);
      ligHafta = data.guncelHafta || (oynanmamis.length ? Math.min(...oynanmamis) : n);
    }
    const yari = Math.ceil(n/2);
    const btn = w => `<button class="wk ${w===ligHafta?'on':''}" data-w="${w}">${w}</button>`;
    const range = (a,b) => Array.from({length:b-a+1}, (_,i)=>a+i);
    const me = KESAN_AYAR.kulupID;
    const haftaMac = tum.filter(m => m.hafta === ligHafta);
    const tarih = t => new Date(t).toLocaleDateString('tr-TR',{day:'2-digit',month:'2-digit',year:'numeric'});
    const saat = (m) => m.saatVar ? new Date(m.tarih).toLocaleTimeString('tr-TR',{hour:'2-digit',minute:'2-digit'}) : '';
    const ad = (nm,id) => `<span class="${id===me?'me':''}">${esc(title(nm))}</span>`;

    // Çapraz tablo: satır = ev sahibi, sütun = deplasman
    const takimlar = data.standings.map(r => ({id:r.id, ad:title(r.ad)}));
    const skor = {}; tum.forEach(m => { skor[m.evId+'|'+m.depId] = m.evG != null ? m.evG+'-'+m.depG : ''; });
    const kisa = s => s.replace(/ (Spor|SK|Futbol SK|Belediye Spor|Spor Kulübü)$/,'').slice(0,16);

    return `<div class="lig-title">Profesyonelliğe Geçiş Ligi ${esc(title(data.grupAd||''))} – 2026/27</div>
      <div class="weeks"><div><b>1. Devre</b>${range(1,yari).map(btn).join('')}</div>
        <div><b>2. Devre</b>${range(yari+1,n).map(btn).join('')}</div></div>
      <div class="fxlist">${haftaMac.length ? haftaMac.map(m => `<div class="fxrow ${m.evId===me||m.depId===me?'mine':''}">
          <div class="fxmeta">${m.tarih?tarih(m.tarih):''}${saat(m)?' · '+saat(m):''}</div>
          <div class="fxteams"><div class="r">${ad(m.ev,m.evId)}</div><div class="sc">${m.evG!=null?m.evG+' - '+m.depG:'-'}</div><div>${ad(m.dep,m.depId)}</div></div>
        </div>`).join('') : '<div class="status">Bu hafta için maç bilgisi yok.</div>'}</div>
      ${(() => { const bay = takimlar.filter(t => !haftaMac.some(m => m.evId===t.id || m.depId===t.id));
                 return haftaMac.length && bay.length ? `<div class="small" style="text-align:left">Bay: ${bay.map(t=>esc(t.ad)).join(', ')}</div>` : ''; })()}

      <div class="sec-title">Puan durumu</div>
      <div class="scroll"><table class="st">
        <thead><tr><th>#</th><th style="text-align:left">Takım</th><th>O</th><th>G</th><th>B</th><th>M</th><th class="gz">A</th><th class="gz">Y</th><th>Av.</th><th>P</th><th>Form</th></tr></thead>
        <tbody>${data.standings.map(r => `<tr class="${r.id===me?'me':''}"><td>${r.sira}.</td><td class="tm">${esc(title(r.ad))}</td>
          <td>${r.O}</td><td>${r.G}</td><td>${r.B}</td><td>${r.M}</td><td class="gz">${r.A}</td><td class="gz">${r.Y}</td><td>${r.AV}</td><td class="p">${r.P}</td>
          <td><span class="form">${formOf(tum, r.id).map(f=>`<i class="${f}" title="${{W:'Galibiyet',D:'Beraberlik',L:'Mağlubiyet'}[f]}">${harf[f]}</i>`).join('')}</span></td></tr>`).join('')}
        </tbody></table></div>

      <div class="sec-title">Çapraz tablo <span style="text-transform:none;font-weight:400">(satır: ev sahibi, sütun: misafir)</span></div>
      <div class="scroll"><table class="cx">
        <thead><tr><th></th>${takimlar.map((t,i)=>`<th title="${esc(t.ad)}">${i+1}</th>`).join('')}</tr></thead>
        <tbody>${takimlar.map((a,i) => `<tr class="${a.id===me?'me':''}"><th class="tm">${i+1}. ${esc(kisa(a.ad))}</th>${takimlar.map(b =>
          a.id===b.id ? '<td class="x"></td>' : `<td class="${(a.id===me||b.id===me)&&skor[a.id+'|'+b.id]?'mine':''}">${skor[a.id+'|'+b.id]||''}</td>`).join('')}</tr>`).join('')}
        </tbody></table></div>
      <div class="small">O: oynanan · G: galibiyet · B: beraberlik · M: mağlubiyet · A: attığı · Y: yediği · Av.: averaj · P: puan<br>
        Kaynak: TFF · ${fmtDate(data.t)} güncellendi</div>`;
  }

  function bodyHaber(){
    if(!news) return '<div class="status"><div class="spinner"></div>Haberler yükleniyor…</div>';
    if(!news.items.length) return '<div class="status">Keşanspor ile ilgili haber bulunamadı.</div>';
    return news.items.map((n,i) => `<div class="news" data-i="${i}">
        ${n.resim && !window.BULUT ? `<img loading="lazy" src="${esc(n.resim)}" alt="" referrerpolicy="no-referrer">` : ''}
        <div><h3>${esc(n.baslik)}</h3><div class="src">${esc(n.kaynak)} · ${n.tarih ? fmtDate(n.tarih,false) : ''}</div>
        <p>${esc(n.ozet)}</p></div></div>`).join('');
  }

  function paint(errMsg){
    if(state.tab !== 'kesan') return;
    let body;
    if(errMsg && !(view==='haber' ? news : data)){
      body = `<div class="status">Veri alınamadı.<br><small>${esc(errMsg)}</small><br><button class="btn" id="ks-retry">Tekrar dene</button></div>`;
    } else if(view !== 'haber' && !data){
      body = '<div class="status"><div class="spinner"></div>TFF verileri çekiliyor…<br><small>(ilk açılışta birkaç saniye sürebilir)</small></div>';
    } else {
      body = view==='haber' ? bodyHaber() : view==='puan' ? bodyPuan() : view==='lig' ? bodyLig() : bodyFikstur();
    }
    const c = el('#content');
    c.innerHTML = header() + body;
    c.querySelectorAll('.seg button').forEach(b => b.onclick = () => {
      view = b.dataset.v;
      try{ history.replaceState(history.state, '', '#kesanspor-' + ALT[view]); }catch{}
      paint(); ensure();
    });
    c.querySelectorAll('.news').forEach(d => d.onclick = () => openReader(news.items[+d.dataset.i]));
    c.querySelectorAll('.wk').forEach(b => b.onclick = () => { ligHafta = +b.dataset.w; paint(); });
    const r = c.querySelector('#ks-retry'); if(r) r.onclick = () => ensure(true);
  }

  async function ensure(force=false){
    if(window.BULUT || window.STATIK){      // statik sürüm: veriler sitenin kendi JSON dosyasından
      if(!data || force){
        paint();
        try{
          const j = window.STATIK ? await getLatest(force) : await (await fetch('data.json?t=' + Date.now())).json();
          data = j.tff; news = j.news; paint();
        }catch(e){ paint('data.json okunamadı'); }
      } else paint();
      return;
    }
    const ttl = KESAN_AYAR.onbellekDk * 60e3;
    if(!data){ data = cache.get('tff'); }
    if(!news){ news = cache.get('news'); }
    const needT = force || !data || Date.now() - data.t > ttl;
    const needN = force || !news || Date.now() - news.t > ttl;
    paint();
    if(busy) return; busy = true;
    let err = null;
    await Promise.all([
      needN && loadNews().then(n => { news = n; cache.set('news', n); paint(); }).catch(e => err = e.message),
      needT && loadTff().then(d => { data = d; cache.set('tff', d); paint(); }).catch(e => err = e.message),
    ]);
    busy = false;
    if(err) paint(err);
  }

  /* ---------- Uygulama içi haber okuyucu ---------- */
  function extractArticle(html, url){
    const doc = parse(html);
    const meta = n => (doc.querySelector(`meta[property="${n}"],meta[name="${n}"]`)||{}).content || '';
    doc.querySelectorAll('script,style,noscript,iframe,nav,header,footer,aside,form,[class*="related"],[class*="comment"],[class*="share"],[class*="reklam"],[class*="ads"]').forEach(e=>e.remove());
    // en çok paragraf metnine sahip kapsayıcıyı bul
    let best = null, bestLen = 0;
    doc.querySelectorAll('article, [itemprop="articleBody"], [class*="content"], [class*="detail"], [class*="haber"], main, div').forEach(e => {
      const len = [...e.querySelectorAll(':scope > p, :scope > div > p')].reduce((s,p)=>s+p.textContent.trim().length, 0);
      if(len > bestLen){ bestLen = len; best = e; }
    });
    const paras = (best ? [...best.querySelectorAll('p')] : [...doc.querySelectorAll('p')])
      .map(p => p.textContent.replace(/\s+/g,' ').trim()).filter(t => t.length > 40);
    let img = meta('og:image'); try{ img = img ? new URL(img, url).href : ''; }catch{ img = ''; }
    return { baslik: meta('og:title') || (doc.querySelector('h1')||{}).textContent || '', resim: img, paras };
  }

  async function openReader(n){
    el('#rsrc').textContent = n.kaynak;
    const body = el('#rbody');
    body.innerHTML = `<h1>${esc(n.baslik)}</h1><div class="rmeta">${esc(n.kaynak)} · ${n.tarih?fmtDate(n.tarih,false):''}</div>
      <div class="status"><div class="spinner"></div>Haber açılıyor…</div>`;
    el('#reader').classList.add('open'); body.scrollTop = 0;
    try{ history.pushState({reader:true}, ''); }catch{}
    if(window.BULUT || window.STATIK){
      body.innerHTML = `<h1>${esc(n.baslik)}</h1><div class="rmeta">${esc(n.kaynak)} · ${n.tarih?fmtDate(n.tarih,false):''}</div>
        ${n.resim && window.STATIK ? `<img class="rimg" src="${esc(n.resim.replace(/&w=240&h=180&c=14$/,''))}" alt="" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}
        <div class="rtext">${n.ozet ? `<p>${esc(n.ozet)}</p>` : '<p class="small" style="text-align:left">Bu haber için kaynak sitesi özet yayınlamamış.</p>'}</div>
        <div class="small">Kaynak: ${esc(n.kaynak)}</div>`;
      return;
    }
    try{
      const a = extractArticle(await getHtml(n.url), n.url);
      if(!el('#reader').classList.contains('open')) return;
      const text = a.paras.length ? a.paras.map(p=>`<p>${esc(p)}</p>`).join('') : `<p>${esc(n.ozet)}</p>`;
      body.innerHTML = `<h1>${esc(a.baslik.trim() || n.baslik)}</h1>
        <div class="rmeta">${esc(n.kaynak)} · ${n.tarih?fmtDate(n.tarih,false):''}</div>
        ${a.resim ? `<img class="rimg" src="${esc(a.resim)}" alt="" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}
        <div class="rtext">${text}</div>
        <div class="small">Kaynak: ${esc(n.kaynak)}</div>`;
    }catch(e){
      body.innerHTML = `<h1>${esc(n.baslik)}</h1><div class="rmeta">${esc(n.kaynak)}</div>
        <div class="rtext"><p>${esc(n.ozet)}</p></div>
        <div class="small">Haberin tamamı yüklenemedi (${esc(e.message)}).</div>
        <div class="small">Kaynak: ${esc(n.kaynak)}</div>`;
    }
  }
  el('#rclose').onclick = () => history.back();
  window.addEventListener('popstate', () => { if(el('#reader').classList.contains('open')) el('#reader').classList.remove('open'); });

  return { show: ensure, altSekme: () => ALT[view], _test:{ parseStandings, parseMatches, extractArticle, loadTff, loadNews } };
})();
