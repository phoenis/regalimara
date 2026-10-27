const fb = (window.REGALI_CONFIG || {}).firebase || {};
const live = !!fb.apiKey;
const CDN = 'https://www.gstatic.com/firebasejs/10.12.2/';
// Firebase si carica solo se config.js è compilato: senza, la pagina funziona in modalità demo.
const [fbApp, fbAuth, fbStore] = live
  ? await Promise.all([import(CDN + 'firebase-app.js'), import(CDN + 'firebase-auth.js'), import(CDN + 'firebase-firestore.js')])
  : [{}, {}, {}];
const { initializeApp } = fbApp;
const { getAuth, onAuthStateChanged, signInAnonymously, signInWithEmailAndPassword, signOut } = fbAuth;
const { getFirestore, collection, doc, onSnapshot, setDoc, updateDoc, deleteDoc, writeBatch, query, orderBy } = fbStore;

{
  const app = live ? initializeApp(fb) : null;
  const auth = live ? getAuth(app) : null;
  const db = live ? getFirestore(app) : null;
  const seed = JSON.parse(document.getElementById('data').textContent).items;
  const $ = (id) => document.getElementById(id);
  // Illustrazioni: metti i file nella cartella img/ e scrivi qui i percorsi.
  // intestazione: un'immagine accanto al titolo. segnaposto: una o più immagini per le idee senza foto (si alternano).
  const ILLUSTRAZIONI = { intestazione: '', segnaposto: [] }; // es. { intestazione: 'img/torta.png', segnaposto: ['img/regalo.png', 'img/fiori.png'] }
  // In demo le prenotazioni restano solo in questo browser, per poter provare il funzionamento.
  let demoRes = {};
  try { demoRes = JSON.parse(localStorage.getItem('regali-demo') || '{}'); } catch (e) {}
  const saveDemo = () => { try { localStorage.setItem('regali-demo', JSON.stringify(demoRes)); } catch (e) {} };
  const state = { items: live ? [] : seed, reserved: new Map(live ? [] : Object.keys(demoRes).map((k) => [k, 'demo'])), loading: live, error: false };
  let filter = 'Tutte', admin = false, showArchive = false, searchText = '', sortMode = 'name';
  try { if (localStorage.getItem('regali-sort') === 'rating') sortMode = 'rating'; } catch (e) { /* senza memoria locale: ordine per nome */ }
  const myUid = () => (live ? (auth.currentUser ? auth.currentUser.uid : null) : 'demo');
  const isMineRes = (id) => !admin && state.reserved.has(id) && state.reserved.get(id) === myUid();

  if (!live) $('head').querySelector('.lede').after(el('p', { class: 'demo-note' }, 'Versione di prova: le prenotazioni restano solo su questo browser.'));
  if (ILLUSTRAZIONI.intestazione) {
    const hero = document.createElement('img');
    hero.className = 'hero'; hero.alt = ''; hero.src = ILLUSTRAZIONI.intestazione;
    hero.addEventListener('error', () => hero.remove());
    $('head').prepend(hero);
  }

  function el(tag, props, ...kids) {
    const n = document.createElement(tag);
    if (props) for (const k in props) { if (props[k] == null || props[k] === false) continue; if (k === 'class') n.className = props[k]; else if (k.startsWith('on')) n.addEventListener(k.slice(2), props[k]); else n.setAttribute(k, props[k]); }
    for (const kid of kids) if (kid != null) n.append(kid);
    return n;
  }
  // Categorie ammesse, nell'ordine in cui compaiono nei filtri. Per aggiungerne una basta scriverla qui.
  // L'elenco si gestisce dall'area riservata (salvato in Firebase). "Altro" c'è sempre, in fondo.
  const CATEGORIE_BASE = ['Casa', 'Cucina', 'Fai da te', 'Creatività', 'Benessere', 'Esperienze', 'Libri', 'Moda e accessori'];
  let CATEGORIE = [...CATEGORIE_BASE, 'Altro'];
  const setCategorie = (list) => { CATEGORIE = [...list.filter((c) => c !== 'Altro'), 'Altro']; };
  // Categorie di un'idea: quelle scelte (cats) oppure la vecchia singola (cat); nessuna valida = "Altro".
  const catsOf = (it) => {
    const raw = Array.isArray(it.cats) ? it.cats : it.cat ? [it.cat] : [];
    const ok = [...new Set(raw.filter((c) => CATEGORIE.includes(c)))];
    return ok.length ? ok : ['Altro'];
  };
  const sortedCats = () => [...CATEGORIE.filter((c) => c !== 'Altro')].sort((x, y) => x.localeCompare(y, 'it', { sensitivity: 'base' })).concat('Altro');
  // Nei filtri solo le categorie che hanno almeno un'idea.
  const cats = () => CATEGORIE.filter((c) => state.items.some((i) => catsOf(i).includes(c)));
  const safeUrl = (u) => /^https?:\/\//i.test(u || '') ? u : '';
  const safeImg = (u) => /^(https:\/\/|img\/[\w.-]+$)/i.test(u || '') ? u : '';
  // Nome del negozio da mostrare sul pulsante (i link corti di Amazon hanno un dominio incomprensibile).
  const shopOf = (u) => {
    const h = (() => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return ''; } })();
    if (/^(amzn\.[a-z]+|a\.co)$/i.test(h)) return 'Amazon';
    return h;
  };
  const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return ''; } };
  // Dal pannello del proprietario le prenotazioni non si vedono (niente sorprese rovinate): solo l'archivio dei regali ricevuti.
  const isTaken = (it) => it.done || (!admin && state.reserved.has(it.id));
  const MAX_IMGS = 4;
  // Un'idea ha delle opzioni (stili, modelli, negozi), tutte sullo stesso livello: nome, prezzo, link e foto.
  // Le idee salvate col vecchio formato (prezzo, link e foto dell'idea + varianti) si leggono come opzioni.
  const MAX_OPTIONS = 8;
  const cleanOpt = (o) => ({ label: o.label || '', price: o.price || '', link: o.link || '', imgs: Array.isArray(o.imgs) ? o.imgs : [], fav: !!o.fav });
  const optionsOf = (d) => {
    if (Array.isArray(d.options)) return d.options.map(cleanOpt);
    const base = cleanOpt({ price: d.price, link: d.link, imgs: d.imgs });
    const vs = (Array.isArray(d.variants) ? d.variants : []).map((v) => cleanOpt({ label: v.label, price: v.price, link: v.link, imgs: v.img ? [v.img] : [] }));
    return [...(base.price || base.link || base.imgs.length ? [base] : []), ...vs];
  };
  const norm = (d) => { const { price, link, imgs, variants, ...rest } = d; return { ...rest, options: optionsOf(d) }; };
  // Foto di un'idea, nell'ordine delle sue opzioni (la prima serve da miniatura nell'elenco).
  // Copertina scelta dal proprietario, se è ancora tra le foto dell'idea; altrimenti la prima foto.
  const coverOf = (it) => { const all = imgsOf(it); const c = safeImg(it.cover); return c && all.includes(c) ? c : all[0]; };
  // Preferenza del proprietario: da 1 a 5 stelle (0 = nessun voto).
  const ratingOf = (it) => { const n = Math.round(Number(it.rating)); return n >= 1 && n <= 5 ? n : 0; };
  const STAR = 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z';
  const starIcon = () => starsEl(1).firstChild.cloneNode(true);
  function starsEl(n) {
    const ns = 'http://www.w3.org/2000/svg';
    const box = el('span', { class: 'stars', role: 'img', 'aria-label': 'Preferenza: ' + n + ' su 5' });
    for (let i = 1; i <= 5; i++) {
      const svg = document.createElementNS(ns, 'svg'); svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
      if (i > n) svg.setAttribute('class', 'off');
      const p = document.createElementNS(ns, 'path'); p.setAttribute('d', STAR); svg.appendChild(p); box.appendChild(svg);
    }
    return box;
  }
  const fold = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const matches = (it) => { const q = fold(searchText).trim(); if (!q) return true; const hay = fold([it.title, it.note, ...catsOf(it), ...it.options.flatMap((o) => [o.label, o.price])].join(' ')); return q.split(/\s+/).every((w) => hay.includes(w)); };
  const imgsOf = (it) => [...new Set(it.options.flatMap((o) => o.imgs).map(safeImg).filter(Boolean))];

  function toast(text) {
    const t = el('div', { class: 'toast', role: 'status' }, text);
    document.body.appendChild(t); setTimeout(() => t.remove(), 3200);
  }

  // ---------- dati ----------
  function listen() {
    if (!live) return;
    onSnapshot(query(collection(db, 'ideas'), orderBy('createdAt', 'desc')), (snap) => {
      state.loading = false; state.error = false;
      state.items = snap.docs.map((d) => norm({ id: d.id, ...d.data() }));
      render();
    }, () => { state.loading = false; state.error = true; render(); });
    onSnapshot(doc(db, 'settings', 'categories'), (snap) => {
      const list = snap.exists() ? snap.data().list : null;
      setCategorie(Array.isArray(list) && list.length ? list.filter((c) => typeof c === 'string' && c.trim()) : CATEGORIE_BASE);
      render();
    }, () => {});
    onSnapshot(collection(db, 'reservations'), (snap) => {
      state.reserved = admin ? new Map() : new Map(snap.docs.map((d) => [d.id, d.data().uid]));
      render();
    }, () => {});
  }
  async function ensureUid() {
    if (auth.currentUser) return auth.currentUser.uid;
    return (await signInAnonymously(auth)).user.uid;
  }

  function reserveItem(it) {
    modal('Lo prendi tu?', [
      el('p', { class: 'sheet-text' }, '«' + it.title + '» risulterà preso per tutti gli altri.'),
      el('p', { class: 'sheet-sub' }, 'Potrai annullare da questo telefono, quando vuoi.')],
      async (form, close) => {
        if (!live) { demoRes[it.id] = 1; saveDemo(); state.reserved.set(it.id, 'demo'); close(); render(); toast('Prenotato! (in prova, solo su questo browser)'); return; }
        try {
          const uid = await ensureUid();
          await setDoc(doc(db, 'reservations', it.id), { uid, createdAt: Date.now() });
        } catch (e) {
          close();
          toast(e && e.code === 'permission-denied' ? 'Ops, qualcuno l\'ha appena preso.' : 'Non sono riuscito a prenotare. Riprova.');
          return;
        }
        close(); toast('Perfetto, è tuo!');
      }, 'Sì, lo prendo io', { sheet: true, cancel: 'Non ancora' });
  }

  async function releaseRes(it) {
    if (!live) { delete demoRes[it.id]; saveDemo(); state.reserved.delete(it.id); render(); return; }
    try { await deleteDoc(doc(db, 'reservations', it.id)); } catch (e) { toast('Non sono riuscito ad annullare. Riprova.'); }
  }

  async function toggleDone(it) {
    try {
      await updateDoc(doc(db, 'ideas', it.id), { done: !it.done });
      try { await deleteDoc(doc(db, 'reservations', it.id)); } catch (e) { /* nessuna prenotazione da togliere */ }
      toast(it.done ? 'Rimessa in lista.' : 'Spostata nell\'archivio.');
    } catch (e) { toast('Salvataggio non riuscito.'); }
  }

  async function deleteItem(it) {
    if (!confirm('Eliminare «' + it.title + '»?')) return;
    try {
      try { await deleteDoc(doc(db, 'reservations', it.id)); } catch (e) { /* nessuna prenotazione */ }
      await deleteDoc(doc(db, 'ideas', it.id));
    } catch (e) { toast('Non sono riuscito a eliminarla.'); }
  }

  // ---------- schede ----------
  function svgIcon(...paths) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('class', 'ico');
    paths.forEach(([tag, attrs]) => { const n = document.createElementNS(ns, tag); Object.entries(attrs).forEach(([k, v]) => n.setAttribute(k, v)); svg.appendChild(n); });
    return svg;
  }
  // regalo: idea ancora libera
  function heartIcon() {
    return svgIcon(['rect', { x: 3, y: 8, width: 18, height: 4, rx: 1 }], ['path', { d: 'M5 12v9h14v-9M12 8v13' }],
      ['path', { d: 'M12 8H7.5a2.5 2.5 0 1 1 2.5-2.5C10 7 12 8 12 8Z' }], ['path', { d: 'M12 8h4.5A2.5 2.5 0 1 0 14 5.5C14 7 12 8 12 8Z' }]);
  }
  // spunta: idea prenotata
  function checkIcon() {
    return svgIcon(['circle', { cx: 12, cy: 12, r: 9 }], ['path', { d: 'm8 12 2.5 2.5L16 9' }]);
  }

  function giftIcon() {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
    for (let n = 0; n < 8; n++) {
      const ang = (n * Math.PI) / 4, r1 = n % 2 ? 4 : 3.5, r2 = n % 2 ? 7 : 9;
      const l = document.createElementNS(ns, 'path');
      l.setAttribute('d', 'M' + (12 + Math.cos(ang) * r1).toFixed(2) + ' ' + (12 + Math.sin(ang) * r1).toFixed(2) + 'L' + (12 + Math.cos(ang) * r2).toFixed(2) + ' ' + (12 + Math.sin(ang) * r2).toFixed(2));
      svg.appendChild(l);
    }
    return svg;
  }

  function arrowIcon() {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('class', 'arrow');
    const p = document.createElementNS(ns, 'path');
    p.setAttribute('d', 'M7 17L17 7M8.5 7H17v8.5');
    svg.appendChild(p);
    return svg;
  }

  function chevron(dir) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
    const p = document.createElementNS(ns, 'path');
    p.setAttribute('d', dir < 0 ? 'M15 5l-7 7 7 7' : 'M9 5l7 7-7 7');
    svg.appendChild(p);
    return svg;
  }

  function mediaOf(it) {
    const imgs = imgsOf(it);
    const media = el('div', { class: 'media' });
    const ar = ['4 / 3', '1 / 1', '3 / 4', '5 / 4'][(parseInt(String(it.id).replace(/\D/g, ''), 10) || 0) % 4];
    const num = parseInt(String(it.id).replace(/\D/g, ''), 10) || 0;
    const placeholder = () => {
      const ph = el('div', { class: 'ph', style: '--ar:' + ar, 'data-t': String(num % 5), 'aria-hidden': 'true' });
      const arts = ILLUSTRAZIONI.segnaposto;
      if (arts.length) {
        const img = el('img', { src: arts[num % arts.length], alt: '' });
        img.addEventListener('error', () => img.replaceWith(giftIcon()));
        ph.appendChild(img);
      } else ph.appendChild(giftIcon());
      return ph;
    };
    if (!imgs.length) { media.appendChild(placeholder()); return media; }
    const main = el('img', { src: coverOf(it), alt: it.title, loading: 'lazy', referrerpolicy: 'no-referrer' });
    main.addEventListener('error', () => main.replaceWith(placeholder()));
    media.appendChild(main);
    return media;
  }

  // ---------- pagina dettagli (indirizzo: #/idea/<id>) ----------
  const routeId = () => { const m = location.hash.match(/^#\/idea\/([^/]+)$/); return m ? decodeURIComponent(m[1]) : null; };
  let listScroll = 0, fromList = false, galIdx = 0, galFor = null;
  function goDetail(id) { listScroll = window.scrollY; fromList = true; location.hash = '#/idea/' + encodeURIComponent(id); }
  function backLink(over) {
    return el('a', { class: 'back' + (over ? ' over' : ''), href: '#/', 'aria-label': 'Torna a tutte le idee', onclick: (e) => { e.preventDefault(); if (fromList) history.back(); else location.hash = '#/'; } }, chevron(-1));
  }

  function adminActions(it) {
    return el('div', { class: 'admin-actions' },
      el('button', { type: 'button', onclick: () => editItem(it) }, 'Modifica'),
      el('button', { type: 'button', onclick: () => toggleDone(it) }, it.done ? 'Rimetti in lista' : 'Segna come ricevuto'),
      el('button', { type: 'button', class: 'danger', onclick: () => deleteItem(it) }, 'Elimina'));
  }

  function renderDetail(id) {
    const box = $('detail'); box.replaceChildren(backLink(false));
    const it = state.items.find((x) => x.id === id && (admin || !x.done));
    if (!it) {
      box.appendChild(el('div', { class: 'empty-card' }, el('p', null, state.loading ? 'Carico l\'idea…' : 'Questa idea non c\'è più.')));
      document.title = 'Idee regalo per Mara'; return;
    }
    document.title = it.title + ' · Idee regalo per Mara';
    const opts = it.options;
    box.replaceChildren(backLink(true));
    const single = opts.length === 1 ? opts[0] : null;
    // In cima la galleria con le foto di tutte le opzioni; sotto, la lista completa delle opzioni.
    const slides = [];
    opts.forEach((o, n) => o.imgs.map(safeImg).filter(Boolean).forEach((src) => { if (!slides.some((s) => s.src === src)) slides.push({ src, label: (o.fav && opts.length > 1 ? '★ ' : '') + (o.label || 'Opzione ' + (n + 1)) }); }));
    const imgs = slides.map((s) => s.src);
    if (galFor !== id) { galFor = id; galIdx = Math.max(0, imgs.indexOf(safeImg(it.cover))); }
    if (galIdx >= imgs.length) galIdx = 0;
    const taken = isTaken(it), mine = isMineRes(it.id);
    const url = single ? safeUrl(single.link) : '';
    const page = el('div', { class: 'dpage' });

    {
      const status = admin ? null : !taken
        ? el('button', { class: 'fab top', type: 'button', 'aria-label': 'Libero: lo prendo io', title: 'Lo prendo io', onclick: () => reserveItem(it) }, heartIcon(), el('span', null, 'Libero'))
        : el('span', { class: 'fab top ' + (mine ? 'on' : 'off') }, checkIcon(), el('span', null, 'Preso'));
      const gallery = el('div', { class: 'gallery' + (taken ? ' taken' : '') });
      if (!imgs.length) {
        const main = mediaOf({ ...it, options: [{ imgs: [] }] });
        if (status) main.appendChild(status);
        gallery.appendChild(main);
      } else {
        const track = el('div', { class: 'track' }, ...slides.map((s) => {
          const img = el('img', { src: s.src, alt: s.label, loading: 'lazy', draggable: 'false', referrerpolicy: 'no-referrer' });
          return el('div', { class: 'slide' }, img);
        }));
        const main = el('div', { class: 'media gal' }, track, status);
        gallery.appendChild(main);
        const cap = opts.length > 1 ? el('span', { class: 'gcap' }, slides[galIdx].label) : null;
        if (cap) main.appendChild(cap);
        if (imgs.length > 1) {
          const count = el('span', { class: 'gcount' }, (galIdx + 1) + '/' + imgs.length);
          const dots = imgs.map((s, n) => el('span', { class: n === galIdx ? 'on' : '' }));
          const thumbs = imgs.map((src, n) => el('button', { type: 'button', 'aria-label': 'Foto ' + (n + 1), 'aria-current': String(n === galIdx), onclick: () => goTo(n) }, el('img', { src, alt: '', referrerpolicy: 'no-referrer' })));
          const goTo = (n) => track.scrollTo({ left: n * track.clientWidth, behavior: 'smooth' });
          const step = (d) => goTo((galIdx + d + imgs.length) % imgs.length);
          main.append(
            el('button', { class: 'gnav prev', type: 'button', 'aria-label': 'Foto precedente', onclick: () => step(-1) }, chevron(-1)),
            el('button', { class: 'gnav next', type: 'button', 'aria-label': 'Foto successiva', onclick: () => step(1) }, chevron(1)),
            count);
          track.addEventListener('scroll', () => {
            if (!track.clientWidth) return;
            const n = Math.min(imgs.length - 1, Math.max(0, Math.round(track.scrollLeft / track.clientWidth)));
            if (n === galIdx) return;
            galIdx = n;
            count.textContent = (n + 1) + '/' + imgs.length;
            if (cap) cap.textContent = slides[n].label;
            dots.forEach((d, i) => { d.className = i === n ? 'on' : ''; });
            thumbs.forEach((t, i) => t.setAttribute('aria-current', String(i === n)));
          }, { passive: true });
          gallery.append(el('div', { class: 'gdots', 'aria-hidden': 'true' }, ...dots), el('div', { class: 'gthumbs' }, ...thumbs));
        }
        requestAnimationFrame(() => { track.scrollLeft = galIdx * track.clientWidth; });
      }
      page.appendChild(gallery);
    }

    const info = el('div', { class: 'dinfo' });
    info.append(el('div', { class: 'cat-chips' }, ...catsOf(it).map((c) => el('span', { class: 'chip-cat' }, c)),), el('h1', { class: 'dtitle' }, it.title), ...(ratingOf(it) ? [el('div', { class: 'dstars' }, starsEl(ratingOf(it)), el('span', null, 'Preferenza'))] : []));
    if (it.note) info.append(el('h3', { class: 'sec' }, 'Dettagli'), el('p', { class: 'full' }, it.note));

    if (opts.length > 1) {
      info.appendChild(el('div', { class: 'notice' }, heartIcon(), el('p', null, el('strong', null, 'Ne basta una. '), 'Vanno bene tutte e ' + opts.length + ' le opzioni: scegli quella che preferisci.')));
      const list = el('div', { class: 'opts' }, el('h2', null, opts.length + ' opzioni'));
      opts.forEach((o, n) => {
        const ourl = safeUrl(o.link), ofotos = o.imgs.map(safeImg).filter(Boolean), oimg = ofotos.includes(safeImg(it.cover)) ? safeImg(it.cover) : ofotos[0];
        const num = parseInt(String(it.id).replace(/\D/g, ''), 10) || 0;
        const thumb = oimg
          ? el('img', { src: oimg, alt: o.label || '', loading: 'lazy', referrerpolicy: 'no-referrer' })
          : el('div', { class: 'ph', 'data-t': String((num + n) % 5), 'aria-hidden': 'true' }, giftIcon());
        if (oimg) thumb.addEventListener('error', () => thumb.replaceWith(el('div', { class: 'ph', 'data-t': String((num + n) % 5), 'aria-hidden': 'true' }, giftIcon())));
        const pic = el('div', { class: 'opt-pic' }, thumb);
        list.appendChild(el('div', { class: 'opt' + (!ourl && !oimg ? ' free' : '') },
          ourl ? el('a', { href: ourl, target: '_blank', rel: 'noopener noreferrer', 'aria-label': 'Apri ' + (o.label || 'opzione ' + (n + 1)) }, pic) : pic,
          el('div', { class: 'opt-text' },
            el('div', { class: 'opt-info' },
              o.fav && opts.length > 1 ? el('span', { class: 'fav-tag' }, starIcon(), 'La mia preferita') : null,
              el('div', { class: 'opt-name' }, o.label || 'Opzione ' + (n + 1)),
              !ourl ? el('div', { class: 'opt-any' }, 'Va bene da qualsiasi negozio') : null),
            ourl ? el('a', { class: 'btn outline small', href: ourl, target: '_blank', rel: 'noopener noreferrer', 'aria-label': 'Vedi su ' + (shopOf(ourl) || 'il sito') }, 'Vedi su ' + (shopOf(ourl) || 'il sito'), arrowIcon()) : null)));
      });
      info.appendChild(list);
    } else if (url) {
      info.appendChild(el('div', { class: 'buybox' }, el('h2', null, 'Idee su dove comprarlo'),
        el('a', { class: 'btn outline wide', href: url, target: '_blank', rel: 'noopener noreferrer' }, 'Vedi su ' + (shopOf(url) || 'il sito'), arrowIcon())));
    }

    const bbAction = !taken
      ? el('button', { class: 'btn primary', type: 'button', onclick: () => reserveItem(it) }, heartIcon(), 'Lo prendo io')
      : mine
        ? el('button', { class: 'btn outline', type: 'button', onclick: () => releaseRes(it) }, 'Annulla')
        : el('span', { class: 'btn disabled' }, 'Preso');
    const bar = el('div', { class: 'buybar' }, el('div', { class: 'bb-in' },
      taken ? el('div', { class: 'bb-price' }, el('span', { class: 'bb-l' }, mine ? 'Hai scelto tu questo regalo' : 'Già scelto da qualcuno')) : null,
      bbAction));
    if (admin) info.appendChild(el('div', { class: 'admin-box' }, adminActions(it)));
    page.appendChild(info);
    box.append(page, ...(admin ? [] : [bar]));
  }

  // Scheda dell'elenco: foto su riquadro chiaro, regalo sull'angolo, titolo e prezzo sotto.
  function tileFor(it) {
    const taken = isTaken(it), mine = isMineRes(it.id), opts = it.options;
    const tile = el('article', { class: 'tile' + (taken && !mine ? ' done' : '') + (mine ? ' mine' : '') });
    const media = mediaOf(it);
    media.addEventListener('click', () => goDetail(it.id));
    media.appendChild(!taken
      ? el('button', { class: 'fab', type: 'button', 'aria-label': 'Lo prendo io: ' + it.title, title: 'Lo prendo io', onclick: (e) => { e.stopPropagation(); reserveItem(it); } }, heartIcon())
      : el('span', { class: 'fab ' + (mine ? 'on' : 'off'), 'aria-hidden': 'true' }, checkIcon()));
    const body = el('div', { class: 'tbody' }, el('div', { class: 'tcats' }, ...catsOf(it).map((c) => el('span', { class: 'chip-cat' }, c))), el('h2', null, el('button', { class: 'open', type: 'button', onclick: () => goDetail(it.id) }, it.title)), ratingOf(it) ? starsEl(ratingOf(it)) : null);
    const price = opts.length > 1 ? null : (opts[0] && opts[0].price) || '';
    if (mine) body.appendChild(el('div', { class: 'meta mine-meta' }, el('strong', null, 'Lo regali tu'), ' · ', el('button', { class: 'linkbtn', type: 'button', 'aria-label': 'Annulla la prenotazione di ' + it.title, onclick: () => releaseRes(it) }, 'Annulla')));
    else if (taken) body.appendChild(el('span', { class: 'chip-taken' }, '✓ Preso'));
    else if (opts.length > 1) body.appendChild(el('div', { class: 'meta' }, el('span', { class: 'dots' }, el('i'), el('i'), el('i'), opts.length + ' opzioni')));
    else if (price) body.appendChild(el('div', { class: 'meta' }, price));
    tile.append(media, body);
    return tile;
  }

  function render() {
    const rid = routeId();
    document.body.classList.toggle('is-detail', !!rid);
    document.body.classList.toggle('is-admin', admin);
    document.body.classList.toggle('is-empty', !state.loading && !state.error && !state.items.some((i) => !i.done) && !admin);
    if (rid) renderDetail(rid); else { $('detail').replaceChildren(); document.title = 'Idee regalo per Mara'; }
    if (filter !== 'Tutte' && !cats().includes(filter)) filter = 'Tutte';
    $('search').hidden = !admin || !!rid;
    const sortBar = $('sort'); sortBar.replaceChildren(el('span', null, 'Ordina per'),
      ...[['name', 'Nome'], ['rating', 'Preferenza ★']].map(([k, label]) => el('button', { type: 'button', class: 'sortbtn', 'aria-pressed': String(sortMode === k), onclick: () => { sortMode = k; try { localStorage.setItem('regali-sort', k); } catch (e) { /* ok */ } render(); } }, label)));
    const chips = $('chips'); chips.replaceChildren();
    ['Tutte', ...cats()].forEach((c) => chips.appendChild(el('button', { class: 'chip', type: 'button', 'aria-pressed': String(c === filter), onclick: () => { filter = c; render(); } }, c)));

    const list = state.items.filter((i) => (admin ? i.done === showArchive : !i.done) && (filter === 'Tutte' || catsOf(i).includes(filter)) && (!admin || matches(i))).sort((x, y) => (sortMode === 'rating' ? ratingOf(y) - ratingOf(x) : 0) || x.title.localeCompare(y.title, 'it', { sensitivity: 'base', numeric: true }));
    const grid = $('grid'); grid.replaceChildren();
    if (state.loading) {
      grid.appendChild(el('p', { class: 'loading', role: 'status' }, 'Carico le idee…'));
      for (let n = 0; n < 4; n++) grid.appendChild(el('div', { class: 'tile skeleton', 'aria-hidden': 'true' }, el('div', { class: 'sk sk-media' }), el('div', { class: 'sk sk-l1' }), el('div', { class: 'sk sk-l2' })));
    } else if (state.error) {
      grid.appendChild(el('div', { class: 'empty-card' }, el('h2', null, 'Qualcosa non va'), el('p', null, 'Non riesco a caricare le idee. Riprova tra poco.')));
    } else if (!list.length) {
      const none = !state.items.some((i) => admin ? i.done === showArchive : !i.done);
      grid.appendChild(el('div', { class: 'empty-card' },
        none ? el('div', { class: 'empty-art', 'aria-hidden': 'true' }, giftIcon()) : null,
        el('h2', null, admin && (searchText || filter !== 'Tutte') && !none ? 'Nessun risultato' : admin && showArchive ? 'Archivio vuoto' : none ? 'Le idee arrivano presto' : 'Nessuna idea qui'),
        el('p', null, admin && (searchText || filter !== 'Tutte') && !none ? 'Prova con un\'altra parola o scegli «Tutte» tra le categorie.' : admin && showArchive ? 'Qui finiscono i regali che hai già ricevuto: usa «Segna come ricevuto» su un\'idea della lista.' : admin ? 'Premi "+ Nuova idea" per aggiungerne una.' : none ? 'Mara sta ancora preparando la lista. Ripassa tra qualche giorno.' : 'Nessuna idea in questa categoria, per ora.')));
    }
    if (admin) {
      const archived = state.items.filter((i) => i.done).length;
      grid.prepend(el('div', { class: 'counts' },
        el('span', null, showArchive ? (searchText || filter !== 'Tutte' ? 'Archivio · ' + list.length + ' trovate' : 'Archivio · ' + archived + (archived === 1 ? ' ricevuto' : ' ricevuti')) : (searchText || filter !== 'Tutte' ? list.length + ' trovate' : (state.items.length - archived) + ' idee in lista')),
        el('span', { class: 'counts-links' },
          el('button', { class: 'linkbtn', type: 'button', onclick: () => { showArchive = !showArchive; render(); window.scrollTo(0, 0); } }, showArchive ? '← Lista' : 'Archivio (' + archived + ')'),
          el('button', { class: 'linkbtn', type: 'button', onclick: manageCats }, 'Categorie'))));
    }
    list.forEach((it) => {
      if (!admin) { grid.appendChild(tileFor(it)); return; }
      const taken = isTaken(it), mine = isMineRes(it.id);
      const opts = it.options;
      const card = el('article', { class: 'card' + (it.done ? ' done' : '') + ' admin' });
      const media = mediaOf(it);
      media.addEventListener('click', () => goDetail(it.id));
      card.appendChild(media);
      const body = el('div', { class: 'body' }, el('h2', null, el('button', { class: 'open', type: 'button', onclick: () => goDetail(it.id) }, it.title)), ratingOf(it) ? starsEl(ratingOf(it)) : null);
      const price = opts.length > 1 ? null : (opts[0] && opts[0].price) || '';
      const tag = opts.length > 1
        ? (admin ? el('span', null, opts.length + ' opzioni') : el('span', { class: 'dots' }, el('i'), el('i'), el('i'), opts.length + ' opzioni'))
        : price ? el('span', null, price) : null;
      if (admin) {
        if (tag) body.appendChild(el('div', { class: 'meta' }, tag));
        if (it.done) body.appendChild(el('div', { class: 'adm-state' }, el('span', { class: 'chip-state taken' }, checkIcon(), 'Ricevuto')));
      } else if (mine) {
        body.appendChild(el('div', { class: 'meta mine-meta' }, el('strong', null, 'Lo regali tu'), ' · ', el('button', { class: 'linkbtn', type: 'button', 'aria-label': 'Annulla la prenotazione di ' + it.title, onclick: () => releaseRes(it) }, 'Annulla')));
      } else if (taken) {
        body.appendChild(el('span', { class: 'chip-taken' }, '✓ Preso'));
      } else if (tag) {
        body.appendChild(el('div', { class: 'meta' }, tag));
      }
      card.appendChild(body);
      if (admin) card.appendChild(adminActions(it));
      else if (!taken) card.appendChild(el('button', { class: 'round', type: 'button', 'aria-label': 'Lo prendo io: ' + it.title, title: 'Lo prendo io', onclick: () => reserveItem(it) }, heartIcon()));
      else card.appendChild(el('span', { class: 'round ' + (mine ? 'on' : 'off'), 'aria-hidden': 'true' }, checkIcon()));
      grid.appendChild(card);
    });
    const pub = state.items.filter((i) => !i.done);
    const open = pub.filter((i) => !isTaken(i)).length;
    if (admin && list.length) grid.appendChild(el('p', { class: 'admin-note' }, 'Elimina chiede sempre conferma prima di cancellare.'));
    $('count').textContent = state.loading || !pub.length || admin ? '' : pub.length + ' idee, ' + open + ' ancora da regalare';
    renderAdminBar();
  }

  function renderAdminBar() {
    const bar = $('adminbar'); bar.hidden = !admin; bar.className = admin ? 'admin-bar' : ''; bar.replaceChildren();
    let add = $('newfab');
    if (!admin) { if (add) add.remove(); return; }
    if (!add) { add = el('button', { id: 'newfab', class: 'newfab', type: 'button', onclick: () => editItem(null) }, el('span', { 'aria-hidden': 'true' }, '+'), 'Nuova idea'); document.body.appendChild(add); }
    bar.append(
      el('span', { class: 'dot', 'aria-hidden': 'true' }),
      el('strong', null, 'Gestione attiva'),
      el('button', { class: 'btn ghost small', type: 'button', onclick: () => { signOut(auth); history.replaceState(null, '', '#/'); } }, 'Esci'));
  }

  // ---------- categorie ----------
  function manageCats() {
    const rows = CATEGORIE.filter((c) => c !== 'Altro').map((c) => ({ orig: c, name: c }));
    const box = el('div', { class: 'catlist' });
    const usage = (c) => state.items.filter((i) => catsOf(i).includes(c)).length;
    const draw = () => {
      box.replaceChildren(...rows.map((r, n) => {
        const input = el('input', { type: 'text', value: r.name, maxlength: '24', 'aria-label': 'Nome della categoria ' + (n + 1) });
        input.addEventListener('input', () => { r.name = input.value; });
        const swap = (d) => { const m = n + d; [rows[n], rows[m]] = [rows[m], rows[n]]; draw(); };
        const used = r.orig ? usage(r.orig) : 0;
        return el('div', { class: 'catrow' },
          input,
          el('span', { class: 'catuse', title: used + (used === 1 ? ' idea' : ' idee') }, used ? String(used) : ''),
          el('button', { type: 'button', 'aria-label': 'Sposta su', disabled: n === 0 ? '' : null, onclick: () => swap(-1) }, '↑'),
          el('button', { type: 'button', 'aria-label': 'Sposta giù', disabled: n === rows.length - 1 ? '' : null, onclick: () => swap(1) }, '↓'),
          el('button', { type: 'button', class: 'danger', 'aria-label': 'Rimuovi la categoria ' + r.name, onclick: () => { rows.splice(n, 1); draw(); } }, '×'));
      }), el('div', { class: 'catrow fixed' }, el('span', null, 'Altro'), el('span', { class: 'hint' }, 'sempre presente, in fondo')));
    };
    const newIn = el('input', { type: 'text', maxlength: '24', placeholder: 'Nuova categoria', 'aria-label': 'Nuova categoria' });
    const addCat = () => { const v = newIn.value.trim(); if (!v) return; rows.push({ orig: '', name: v }); newIn.value = ''; draw(); };
    newIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addCat(); } });
    draw();
    modal('Categorie', [
      el('p', { class: 'hint' }, 'Le categorie sono quelle del menu delle idee e dei filtri. Il numero accanto al nome è quante idee la usano. Se rinomini una categoria, le sue idee la seguono. Se ne rimuovi una, le sue idee passano a "Altro".'),
      box,
      el('div', { class: 'inline' }, newIn, el('button', { class: 'btn', type: 'button', onclick: addCat }, 'Aggiungi'))],
    async (form, close) => {
      const names = rows.map((r) => r.name.trim());
      if (names.some((n) => !n)) return 'Una categoria non ha il nome.';
      const low = names.map((n) => n.toLowerCase());
      if (new Set(low).size !== low.length) return 'Due categorie hanno lo stesso nome.';
      if (low.includes('altro') || low.includes('tutte')) return '"Altro" e "Tutte" ci sono già: scegli un altro nome.';
      const toNew = new Map(rows.filter((r) => r.orig).map((r) => [r.orig, r.name.trim()]));
      const batch = writeBatch(db);
      state.items.forEach((i) => {
        const was = catsOf(i);
        const now = [...new Set(was.map((c) => (c === 'Altro' ? c : toNew.has(c) ? toNew.get(c) : 'Altro')))];
        if (JSON.stringify(now) !== JSON.stringify(was)) batch.update(doc(db, 'ideas', i.id), { cats: now });
      });
      batch.set(doc(db, 'settings', 'categories'), { list: names, updatedAt: Date.now() });
      try { await batch.commit(); } catch (e) { console.error(e); return 'Salvataggio non riuscito (' + ((e && e.code) || 'errore') + '). ' + (e && e.code === 'permission-denied' ? 'Le regole di Firestore non ti riconoscono come proprietario: controlla che nelle regole ci sia il tuo UID e non "IL-TUO-UID".' : ''); }
      close(); toast('Categorie salvate');
    }, 'Salva categorie');
  }

  // ---------- finestre ----------
  function modal(title, fields, onSubmit, submitLabel, o = {}) {
    const layer = $('layer');
    const msg = el('p', { class: 'msg', role: 'alert' });
    const form = el('form', { class: 'dlg' + (o.sheet ? ' sheet' : '') + (o.page ? ' page' : ''), novalidate: '' },
      o.page ? el('button', { class: 'back-text', type: 'button', onclick: () => close() }, '← Torna all\'elenco') : null,
      o.sheet ? el('div', { class: 'grab', 'aria-hidden': 'true' }) : null,
      o.sheet ? el('div', { class: 'sheet-icon', 'aria-hidden': 'true' }, heartIcon()) : null,
      el('h3', null, title), ...fields, msg);
    const close = () => layer.replaceChildren();
    const submit = el('button', { class: 'btn primary' + (o.sheet ? ' wide' : ''), type: 'submit' }, submitLabel || 'Conferma');
    const cancel = el('button', { class: 'btn' + (o.sheet ? ' outline wide' : ''), type: 'button', onclick: close }, o.cancel || 'Annulla');
    form.append(el('div', { class: 'actions' }, ...(o.sheet ? [submit, cancel] : [cancel, submit])));
    form.addEventListener('submit', async (e) => {
      e.preventDefault(); submit.disabled = true;
      try { const err = await onSubmit(form, close); if (err) msg.textContent = err; }
      finally { submit.disabled = false; }
    });
    const overlay = el('div', { class: 'overlay' + (o.page ? ' page' : '') }, form);
    overlay.addEventListener('click', (e) => { if (e.target === overlay && o.sheet) close(); });
    layer.replaceChildren(overlay);
    const first = form.querySelector('input,textarea,select'); if (first) first.focus(); else submit.focus();
  }
  const field = (id, label, extra) => [el('label', { for: id }, label), extra];

  function editItem(it) {
    const isNew = !it;
    const data = it || { id: 'i' + Date.now().toString(36), title: '', note: '', cats: CATEGORIE.includes(filter) ? [filter] : [], options: [], done: false };
    const picked = new Set(isNew ? data.cats : catsOf(data));
    const catPick = el('div', { class: 'catpick', role: 'group', 'aria-label': 'Categorie' }, ...sortedCats().map((c) => {
      const box = el('input', { type: 'checkbox', value: c });
      box.checked = picked.has(c);
      box.addEventListener('change', () => { if (box.checked) picked.add(c); else picked.delete(c); label.classList.toggle('on', box.checked); });
      const label = el('label', { class: 'pickchip' + (box.checked ? ' on' : '') }, box, el('span', null, c));
      return label;
    }));
    let cover = safeImg(data.cover) || '';
    const options = data.options.map((o) => ({ ...o, imgs: o.imgs.slice() }));
    if (!options.length) options.push({ label: '', price: '', link: '', imgs: [] });
    // Foto di un'opzione: si aggiungono incollando l'indirizzo dell'immagine.
    function photoEditor(list) {
      const box = el('div', { class: 'imgs' });
      const msg = el('p', { class: 'hint' });
      const draw = () => {
        box.replaceChildren(...list.map((src, n) => el('div', { class: 'it' + (src === cover ? ' is-cover' : '') },
          el('img', { src, alt: '', referrerpolicy: 'no-referrer' }),
          el('button', { type: 'button', 'aria-label': 'Rimuovi foto', onclick: () => { if (src === cover) cover = ''; list.splice(n, 1); drawOptions(); } }, '×'),
          el('button', { type: 'button', class: 'cover-btn', 'aria-pressed': String(src === cover), 'aria-label': src === cover ? 'Questa è la copertina' : 'Usa come copertina', onclick: () => { cover = src; drawOptions(); } }, src === cover ? '★ Copertina' : '☆'))));
        msg.textContent = list.length + ' di ' + MAX_IMGS + ' foto.';
      };
      const input = el('input', { type: 'url', placeholder: 'Foto: indirizzo immagine https://…', 'aria-label': 'Foto: indirizzo immagine' });
      const add = () => {
        const u = input.value.trim();
        if (!u) return;
        if (!/^https:\/\//i.test(u)) { toast('L\'indirizzo deve iniziare con https://'); return; }
        if (/(^|\.)pinterest\.[a-z.]+\/pin\//i.test(u.replace(/^https:\/\//i, ''))) { toast('Questo è il link della scheda, non della foto. Tieni premuto sulla foto e scegli "Copia indirizzo immagine".'); return; }
        if (list.length >= MAX_IMGS) { toast('Massimo ' + MAX_IMGS + ' foto'); return; }
        list.push(u); input.value = ''; draw();
      };
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
      draw();
      return el('div', { class: 'photos' }, box, el('div', { class: 'inline' }, input, el('button', { class: 'btn', type: 'button', onclick: add }, 'Aggiungi foto')), msg);
    }
    const oBox = el('div', { class: 'vlist' });
    function drawOptions() {
      oBox.replaceChildren(...options.map((o, n) => {
        const inp = (ph, key, type) => { const i = el('input', { type: type || 'text', placeholder: ph, value: o[key] || '', 'aria-label': ph }); i.addEventListener('input', () => { o[key] = i.value; }); return i; };
        return el('div', { class: 'vedit' },
          el('strong', { class: 'vtitle' }, 'Opzione ' + (n + 1)),
          inp('Nome (es. Verde salvia)', 'label'), inp('Prezzo (es. 29 €)', 'price'), inp('Link dove comprarlo https://…', 'link', 'url'),
          photoEditor(o.imgs),
          options.length > 1 ? el('button', { class: 'favbtn' + (o.fav ? ' on' : ''), type: 'button', 'aria-pressed': String(!!o.fav), onclick: () => { const was = o.fav; options.forEach((x) => { x.fav = false; }); o.fav = !was; drawOptions(); } }, starIcon(), o.fav ? 'La mia preferita' : 'Segna come preferita') : null,
          options.length > 1 ? el('button', { class: 'btn danger', type: 'button', onclick: () => { options.splice(n, 1); drawOptions(); } }, 'Rimuovi opzione') : null);
      }));
    }
    const addOption = el('button', { class: 'btn', type: 'button', onclick: () => { if (options.length >= MAX_OPTIONS) { toast('Massimo ' + MAX_OPTIONS + ' opzioni'); return; } options.push({ label: '', price: '', link: '', imgs: [] }); drawOptions(); } }, 'Aggiungi un\'altra opzione');
    let rating = ratingOf(data);
    const rateBox = el('div', { class: 'ratepick', role: 'group', 'aria-label': 'Quanto lo vorresti' });
    const drawRate = () => {
      rateBox.replaceChildren(...[1, 2, 3, 4, 5].map((n) => {
        const b = el('button', { type: 'button', class: n <= rating ? 'on' : '', 'aria-label': n + ' su 5', 'aria-pressed': String(n === rating), onclick: () => { rating = rating === n ? 0 : n; drawRate(); } });
        b.appendChild(starIcon()); return b;
      }));
    };
    drawRate();
    drawOptions();
    modal(isNew ? 'Nuova idea' : 'Modifica idea', [
      ...field('f-title', 'Titolo', el('input', { id: 'f-title', type: 'text', value: data.title, maxlength: '80' })),
      ...field('f-note', 'Descrizione', el('textarea', { id: 'f-note', rows: '4' }, data.note)),
      el('p', { class: 'field-label' }, 'Categorie', el('span', null, ' · una o più')), catPick,
      el('p', { class: 'hint' }, 'L\'idea compare sotto ogni categoria scelta. Nessuna scelta = «Altro».'),
      el('p', { class: 'field-label' }, 'Preferenza', el('span', null, ' · facoltativa')), rateBox,
      el('p', { class: 'hint' }, 'Quanto vorresti riceverlo: da 1 a 5 stelle, visibili a tutti. Tocca di nuovo la stessa stella per toglierlo.'),
      el('label', null, 'Opzioni (modelli, colori, negozi)'),
      el('p', { class: 'hint' }, 'Tocca la ☆ su una foto per sceglierla come copertina: è quella che si vede nell\'elenco. Le opzioni sono tutte allo stesso livello: chi regala ne sceglie una e la prenotazione vale per l\'idea intera. Con una sola opzione la pagina mostra la sua galleria di foto. Da Pinterest, Amazon o Etsy: tieni premuto sulla foto (sul computer, tasto destro), scegli "Copia indirizzo immagine" e incollalo.'),
      oBox, addOption,
    ], async (form, close) => {
      const v = (id) => form.querySelector('#' + id).value.trim();
      if (!v('f-title')) return 'Scrivi almeno il titolo.';
      for (const o of options) {
        if (o.link && !safeUrl(o.link.trim())) return 'Il link di un\'opzione deve iniziare con http:// o https://';
      }
      const clean = options.map((o) => ({ label: (o.label || '').trim(), price: (o.price || '').trim(), link: (o.link || '').trim(), imgs: o.imgs.slice(), fav: !!o.fav })).filter((o) => o.label || o.price || o.link || o.imgs.length);
      if (clean.length < 2) clean.forEach((o) => { o.fav = false; });
      else { let seen = false; clean.forEach((o) => { if (o.fav && seen) o.fav = false; seen = seen || o.fav; }); }
      const { id, ...row } = { id: data.id, title: v('f-title'), note: v('f-note'), rating, cats: picked.size ? CATEGORIE.filter((c) => picked.has(c)) : ['Altro'], options: clean, cover: clean.some((o) => o.imgs.includes(cover)) ? cover : '', done: !!data.done, createdAt: data.createdAt || Date.now() };
      try { await setDoc(doc(db, 'ideas', id), row); } catch (e) { console.error(e); return 'Salvataggio non riuscito (' + ((e && e.code) || 'errore') + '). ' + (e && e.code === 'permission-denied' ? 'Le regole di Firestore non ti riconoscono come proprietario: controlla che nelle regole ci sia il tuo UID e non "IL-TUO-UID".' : 'Sei ancora dentro?'); }
      close();
    }, 'Salva idea', { page: true });
  }

  function openLogin() {
    modal('Area riservata', [
      ...field('f-mail', 'Email', el('input', { id: 'f-mail', type: 'email', autocomplete: 'username' })),
      ...field('f-pw', 'Password', el('input', { id: 'f-pw', type: 'password', autocomplete: 'current-password' })),
    ], async (form, close) => {
      try { await signInWithEmailAndPassword(auth, form.querySelector('#f-mail').value.trim(), form.querySelector('#f-pw').value); }
      catch (e) { return 'Email o password non corrette.'; }
      close();
    }, 'Entra');
  }

  // L'area riservata non ha un link in pagina: si entra dall'indirizzo #/admin.
  let authReady = false;
  function checkAdminRoute() {
    if (location.hash !== '#/admin') return;
    if (admin) { history.replaceState(null, '', '#/'); render(); return; }
    if (authReady && !$('layer').children.length) openLogin();
  }

  $('q').addEventListener('input', (e) => { searchText = e.target.value; render(); });
  window.addEventListener('hashchange', () => {
    render();
    checkAdminRoute();
    if (routeId()) window.scrollTo(0, 0); else if (location.hash !== '#/admin') requestAnimationFrame(() => window.scrollTo(0, listScroll));
  });
  if (live) {
    onAuthStateChanged(auth, (u) => {
      admin = !!u && !u.isAnonymous;
      if (!admin) { showArchive = false; searchText = ''; const q = $('q'); if (q) q.value = ''; } else state.reserved = new Map();
      authReady = true;
      render();
      checkAdminRoute();
      if (!u) signInAnonymously(auth).catch(() => {});
    });
  }
  render();
  listen();
}
