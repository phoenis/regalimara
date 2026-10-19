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
  let filter = 'Tutte', admin = false;
  const myUid = () => (live ? (auth.currentUser ? auth.currentUser.uid : null) : 'demo');
  const isMineRes = (id) => state.reserved.has(id) && state.reserved.get(id) === myUid();

  if (!live) $('head').querySelector('.lede').after(el('p', { class: 'demo-note' }, 'Versione di prova: le prenotazioni restano solo su questo browser.'));
  if (ILLUSTRAZIONI.intestazione) {
    const hero = document.createElement('img');
    hero.className = 'hero'; hero.alt = ''; hero.src = ILLUSTRAZIONI.intestazione;
    hero.addEventListener('error', () => hero.remove());
    $('head').prepend(hero);
  }

  function el(tag, props, ...kids) {
    const n = document.createElement(tag);
    if (props) for (const k in props) { if (k === 'class') n.className = props[k]; else if (k.startsWith('on')) n.addEventListener(k.slice(2), props[k]); else n.setAttribute(k, props[k]); }
    for (const kid of kids) if (kid != null) n.append(kid);
    return n;
  }
  // Categorie ammesse, nell'ordine in cui compaiono nei filtri. Per aggiungerne una basta scriverla qui.
  const CATEGORIE = ['Casa', 'Cucina', 'Fai da te', 'Creatività', 'Benessere', 'Esperienze', 'Libri', 'Moda e accessori', 'Altro'];
  const catOf = (it) => (CATEGORIE.includes(it.cat) ? it.cat : 'Altro');
  // Nei filtri solo le categorie che hanno almeno un'idea.
  const cats = () => CATEGORIE.filter((c) => state.items.some((i) => catOf(i) === c));
  const safeUrl = (u) => /^https?:\/\//i.test(u || '') ? u : '';
  const safeImg = (u) => /^(https:\/\/|img\/[\w.-]+$)/i.test(u || '') ? u : '';
  // Nome del negozio da mostrare sul pulsante (i link corti di Amazon hanno un dominio incomprensibile).
  const shopOf = (u) => {
    const h = (() => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return ''; } })();
    if (/^(amzn\.(eu|to|com)|a\.co)$|(^|\.)amazon\./i.test(h)) return 'Amazon';
    if (/(^|\.)etsy\.com$/i.test(h)) return 'Etsy';
    return h;
  };
  const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return ''; } };
  const isTaken = (it) => it.done || state.reserved.has(it.id);
  const MAX_IMGS = 4;
  // Un'idea ha delle opzioni (stili, modelli, negozi), tutte sullo stesso livello: nome, prezzo, link e foto.
  // Le idee salvate col vecchio formato (prezzo, link e foto dell'idea + varianti) si leggono come opzioni.
  const MAX_OPTIONS = 8;
  const cleanOpt = (o) => ({ label: o.label || '', price: o.price || '', link: o.link || '', imgs: Array.isArray(o.imgs) ? o.imgs : [] });
  const optionsOf = (d) => {
    if (Array.isArray(d.options)) return d.options.map(cleanOpt);
    const base = cleanOpt({ price: d.price, link: d.link, imgs: d.imgs });
    const vs = (Array.isArray(d.variants) ? d.variants : []).map((v) => cleanOpt({ label: v.label, price: v.price, link: v.link, imgs: v.img ? [v.img] : [] }));
    return [...(base.price || base.link || base.imgs.length ? [base] : []), ...vs];
  };
  const norm = (d) => { const { price, link, imgs, variants, ...rest } = d; return { ...rest, options: optionsOf(d) }; };
  // Foto di un'idea, nell'ordine delle sue opzioni (la prima serve da miniatura nell'elenco).
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
    onSnapshot(collection(db, 'reservations'), (snap) => {
      state.reserved = new Map(snap.docs.map((d) => [d.id, d.data().uid]));
      render();
    });
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
    try { await updateDoc(doc(db, 'ideas', it.id), { done: !it.done }); } catch (e) { toast('Salvataggio non riuscito.'); }
  }

  // Copia un'idea (stesso titolo, descrizione, categoria e opzioni), libera e in cima all'elenco.
  async function duplicateItem(it) {
    const id = 'i' + Date.now().toString(36) + Math.random().toString(36).slice(2, 4);
    const row = { title: it.title, note: it.note || '', cat: it.cat, options: it.options.map((o) => ({ ...o, imgs: o.imgs.slice() })), done: false, createdAt: Date.now() };
    try { await setDoc(doc(db, 'ideas', id), row); toast('Idea duplicata'); } catch (e) { toast('Non sono riuscito a duplicarla.'); }
  }

  async function deleteItem(it) {
    if (!confirm('Eliminare «' + it.title + '»?')) return;
    try {
      if (state.reserved.has(it.id)) await deleteDoc(doc(db, 'reservations', it.id));
      await deleteDoc(doc(db, 'ideas', it.id));
    } catch (e) { toast('Non sono riuscito a eliminarla.'); }
  }

  // ---------- schede ----------
  function heartIcon() {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('class', 'heart');
    const p = document.createElementNS(ns, 'path');
    p.setAttribute('d', 'M12 20.5s-7.5-4.8-9.6-9.6A5.4 5.4 0 0 1 12 6.4a5.4 5.4 0 0 1 9.6 4.5c-2.1 4.8-9.6 9.6-9.6 9.6z');
    svg.appendChild(p);
    return svg;
  }

  function giftIcon() {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 64 64'); svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '3'); svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round');
    ['M10 26h44v28H10z', 'M8 18h48v8H8z', 'M32 18v36', 'M32 18c-6-10-18-9-16-3 1 4 10 3 16 3zm0 0c6-10 18-9 16-3-1 4-10 3-16 3z'].forEach((d) => {
      const p = document.createElementNS(ns, 'path'); p.setAttribute('d', d); svg.appendChild(p);
    });
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
    const main = el('img', { src: imgs[0], alt: it.title, loading: 'lazy', referrerpolicy: 'no-referrer' });
    main.addEventListener('error', () => main.replaceWith(placeholder()));
    media.appendChild(main);
    return media;
  }

  // ---------- pagina dettagli (indirizzo: #/idea/<id>) ----------
  const routeId = () => { const m = location.hash.match(/^#\/idea\/([^/]+)$/); return m ? decodeURIComponent(m[1]) : null; };
  let listScroll = 0, fromList = false, galIdx = 0, galFor = null;
  function goDetail(id) { listScroll = window.scrollY; fromList = true; location.hash = '#/idea/' + encodeURIComponent(id); }
  function backLink() {
    return el('a', { class: 'back', href: '#/', onclick: (e) => { e.preventDefault(); if (fromList) history.back(); else location.hash = '#/'; } }, '← Tutte le idee');
  }

  function adminActions(it) {
    return el('div', { class: 'admin-actions' },
      el('button', { type: 'button', onclick: () => editItem(it) }, 'Modifica'),
      el('button', { type: 'button', onclick: () => duplicateItem(it) }, 'Duplica'),
      state.reserved.has(it.id)
        ? el('button', { type: 'button', onclick: () => releaseRes(it) }, 'Libera prenotazione')
        : el('button', { type: 'button', onclick: () => toggleDone(it) }, it.done ? 'Rimetti in lista' : 'Segna come preso'),
      el('button', { type: 'button', class: 'danger', onclick: () => deleteItem(it) }, 'Elimina'));
  }

  function renderDetail(id) {
    const box = $('detail'); box.replaceChildren(backLink());
    const it = state.items.find((x) => x.id === id);
    if (!it) {
      box.appendChild(el('div', { class: 'empty-card' }, el('p', null, state.loading ? 'Carico l\'idea…' : 'Questa idea non c\'è più.')));
      document.title = 'Idee regalo per Mara'; return;
    }
    document.title = it.title + ' · Idee regalo per Mara';
    if (galFor !== id) { galFor = id; galIdx = 0; }
    const opts = it.options;
    const single = opts.length === 1 ? opts[0] : null;
    // Una sola opzione: galleria con le sue foto. Più opzioni: righe tutte uguali, senza una foto principale.
    const imgs = single ? single.imgs.map(safeImg).filter(Boolean) : [];
    if (galIdx >= imgs.length) galIdx = 0;
    const taken = isTaken(it), mine = isMineRes(it.id);
    const url = single ? safeUrl(single.link) : '';
    const page = el('div', { class: 'dpage' });

    if (opts.length <= 1) {
      const main = mediaOf({ ...it, options: [{ imgs: imgs.length ? [imgs[galIdx]] : [] }] });
      const gallery = el('div', { class: 'gallery' }, main);
      const go = (d) => { galIdx = (galIdx + d + imgs.length) % imgs.length; render(); };
      if (imgs.length > 1) {
        main.classList.add('swipe');
        main.append(
          el('button', { class: 'gnav prev', type: 'button', 'aria-label': 'Foto precedente', onclick: () => go(-1) }, '‹'),
          el('button', { class: 'gnav next', type: 'button', 'aria-label': 'Foto successiva', onclick: () => go(1) }, '›'),
          el('span', { class: 'gcount' }, (galIdx + 1) + '/' + imgs.length));
        let sx = null;
        main.addEventListener('pointerdown', (e) => { sx = e.clientX; });
        main.addEventListener('pointercancel', () => { sx = null; });
        main.addEventListener('pointerup', (e) => { if (sx == null) return; const dx = e.clientX - sx; sx = null; if (Math.abs(dx) > 40) go(dx < 0 ? 1 : -1); });
        gallery.appendChild(el('div', { class: 'gdots', 'aria-hidden': 'true' }, ...imgs.map((s, n) => el('span', { class: n === galIdx ? 'on' : '' }))));
        gallery.appendChild(el('div', { class: 'gthumbs' }, ...imgs.map((src, n) =>
          el('button', { type: 'button', 'aria-label': 'Foto ' + (n + 1), 'aria-current': String(n === galIdx), onclick: () => { galIdx = n; render(); } }, el('img', { src, alt: '', referrerpolicy: 'no-referrer' })))));
      }
      page.appendChild(gallery);
    }

    const info = el('div', { class: 'dinfo' });
    info.append(el('span', { class: 'chip-cat' }, catOf(it)), el('h1', { class: 'dtitle' }, it.title));
    if (single && single.price) info.appendChild(el('div', { class: 'dprice' }, single.price));
    if (it.note) info.appendChild(el('p', { class: 'full' }, it.note));

    if (opts.length > 1) {
      info.appendChild(el('div', { class: 'notice' }, heartIcon(), el('p', null, el('strong', null, 'Ne basta uno. '), 'Vanno bene tutti e ' + opts.length + ' gli stili: scegli quello che preferisci.')));
      const list = el('div', { class: 'opts' }, el('h2', null, opts.length + ' stili'));
      opts.forEach((o, n) => {
        const ourl = safeUrl(o.link), oimg = safeImg(o.imgs.map(safeImg).find(Boolean));
        const num = parseInt(String(it.id).replace(/\D/g, ''), 10) || 0;
        const thumb = oimg
          ? el('img', { src: oimg, alt: o.label || '', loading: 'lazy', referrerpolicy: 'no-referrer' })
          : el('div', { class: 'ph', 'data-t': String((num + n) % 5), 'aria-hidden': 'true' }, giftIcon());
        if (oimg) thumb.addEventListener('error', () => thumb.replaceWith(el('div', { class: 'ph', 'data-t': String((num + n) % 5), 'aria-hidden': 'true' }, giftIcon())));
        const pic = el('div', { class: 'opt-pic' }, thumb);
        const price = o.price || (!ourl ? 'Prezzo libero' : '');
        list.appendChild(el('div', { class: 'opt' + (!ourl && !oimg ? ' free' : '') },
          ourl ? el('a', { href: ourl, target: '_blank', rel: 'noopener noreferrer', 'aria-label': 'Apri ' + (o.label || 'stile ' + (n + 1)) }, pic) : pic,
          el('div', { class: 'opt-text' },
            el('div', { class: 'opt-info' },
              el('div', { class: 'opt-name' }, o.label || 'Stile ' + (n + 1)),
              price ? el('div', { class: 'opt-price' }, price) : null,
              !ourl ? el('div', { class: 'opt-any' }, 'Va bene da qualsiasi negozio') : null),
            ourl ? el('a', { class: 'btn outline small', href: ourl, target: '_blank', rel: 'noopener noreferrer', 'aria-label': 'Vedi su ' + (shopOf(ourl) || 'il sito') }, 'Vedi su ' + (shopOf(ourl) || 'il sito') + ' ↗') : null)));
      });
      info.appendChild(list);
    } else if (url) {
      info.appendChild(el('a', { class: 'btn outline wide', href: url, target: '_blank', rel: 'noopener noreferrer' }, 'Dove comprarlo: ' + (shopOf(url) || 'vai al sito') + ' ↗'));
    } else {
      info.appendChild(el('p', { class: 'hint-d' }, 'Per questa idea non c\'è un link: le foto servono a dare un\'idea.'));
    }

    const panel = el('div', { class: 'cta-panel' + (opts.length > 1 ? ' row' : '') });
    if (!taken) {
      panel.append(
        el('button', { class: 'btn primary wide', type: 'button', onclick: () => reserveItem(it) }, heartIcon(), 'Lo prendo io'),
        el('p', { class: 'note' }, opts.length > 1
          ? 'Prenoti l\'idea intera: vale per tutti e ' + opts.length + ' gli stili. Poi compri quello che preferisci.'
          : 'Gli altri lo vedranno come già preso. Se cambi idea puoi annullare da questo stesso telefono.'));
    } else if (mine) {
      panel.append(el('p', { class: 'note strong' }, 'Hai scelto tu questo regalo.'), el('button', { class: 'btn outline wide', type: 'button', onclick: () => releaseRes(it) }, 'Annulla, non lo prendo più'));
    } else {
      panel.append(el('p', { class: 'note strong' }, 'Qualcuno ha già scelto questo regalo.'));
    }
    info.appendChild(panel);
    if (admin) info.appendChild(el('div', { class: 'admin-box' }, adminActions(it)));
    page.appendChild(info);
    box.appendChild(page);
  }

  function render() {
    const rid = routeId();
    document.body.classList.toggle('is-detail', !!rid);
    if (rid) renderDetail(rid); else { $('detail').replaceChildren(); document.title = 'Idee regalo per Mara'; }
    if (filter !== 'Tutte' && !cats().includes(filter)) filter = 'Tutte';
    const chips = $('chips'); chips.replaceChildren();
    ['Tutte', ...cats()].forEach((c) => chips.appendChild(el('button', { class: 'chip', type: 'button', 'aria-pressed': String(c === filter), onclick: () => { filter = c; render(); } }, c)));

    const list = state.items.filter((i) => filter === 'Tutte' || catOf(i) === filter);
    const grid = $('grid'); grid.replaceChildren();
    if (state.loading) {
      grid.appendChild(el('p', { class: 'loading', role: 'status' }, 'Carico le idee…'));
      for (let n = 0; n < 4; n++) grid.appendChild(el('div', { class: 'card skeleton', 'aria-hidden': 'true' }, el('div', { class: 'sk sk-thumb' }), el('div', { class: 'sk-lines' }, el('div', { class: 'sk sk-l1' }), el('div', { class: 'sk sk-l2' })), el('div', { class: 'sk sk-round' })));
    } else if (state.error) {
      grid.appendChild(el('div', { class: 'empty-card' }, el('h2', null, 'Qualcosa non va'), el('p', null, 'Non riesco a caricare le idee. Riprova tra poco.')));
    } else if (!list.length) {
      const none = !state.items.length;
      grid.appendChild(el('div', { class: 'empty-card' },
        none ? el('div', { class: 'empty-art', 'aria-hidden': 'true' }, giftIcon()) : null,
        el('h2', null, none ? 'Le idee arrivano presto' : 'Nessuna idea qui'),
        el('p', null, admin ? 'Premi "+ Nuova idea" per aggiungerne una.' : none ? 'Mara sta ancora preparando la lista. Ripassa tra qualche giorno.' : 'Nessuna idea in questa categoria, per ora.')));
    }
    if (admin && state.items.length) {
      const prese = state.items.filter(isTaken).length;
      grid.appendChild(el('p', { class: 'counts' }, state.items.length + ' idee · ' + prese + ' prese · ' + (state.items.length - prese) + ' libere'));
    }
    list.forEach((it) => {
      const taken = isTaken(it), mine = isMineRes(it.id);
      const opts = it.options;
      const card = el('article', { class: 'card' + (taken && !mine ? ' done' : '') + (mine ? ' mine' : '') + (admin ? ' admin' : '') });
      const media = mediaOf(it);
      media.addEventListener('click', () => goDetail(it.id));
      card.appendChild(media);
      const body = el('div', { class: 'body' }, el('h2', null, el('button', { class: 'open', type: 'button', onclick: () => goDetail(it.id) }, it.title)));
      const price = opts.length > 1 ? null : (opts[0] && opts[0].price) || '';
      const tag = opts.length > 1
        ? el('span', { class: 'dots' }, el('i'), el('i'), el('i'), opts.length + ' stili')
        : price ? el('span', null, price) : null;
      if (admin) {
        const status = state.reserved.has(it.id) ? 'Preso da un invitato' : it.done ? 'Segnato preso da te' : '';
        body.appendChild(el('div', { class: 'meta' }, tag, tag && !status ? ' · Libera' : null, !tag && !status ? 'Libera' : null));
        if (status) body.appendChild(el('span', { class: 'chip-taken plain' }, status));
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
      else card.appendChild(el('span', { class: 'round ' + (mine ? 'on' : 'off'), 'aria-hidden': 'true' }, heartIcon()));
      grid.appendChild(card);
    });
    const open = state.items.filter((i) => !isTaken(i)).length;
    $('count').textContent = state.loading || !state.items.length || admin ? '' : state.items.length + ' idee, ' + open + ' ancora da regalare';
    renderAdminBar();
  }

  function renderAdminBar() {
    const bar = $('adminbar'); bar.hidden = !admin; bar.className = admin ? 'admin-bar' : ''; bar.replaceChildren();
    $('open-admin').hidden = admin || !live;
    if (!admin) return;
    bar.append(
      el('span', { class: 'dot', 'aria-hidden': 'true' }),
      el('strong', null, 'Gestione attiva'),
      el('button', { class: 'btn primary small', type: 'button', onclick: () => editItem(null) }, '+ Nuova idea'),
      el('button', { class: 'btn ghost small', type: 'button', onclick: () => signOut(auth) }, 'Esci'));
  }

  // ---------- finestre ----------
  function modal(title, fields, onSubmit, submitLabel, o = {}) {
    const layer = $('layer');
    const msg = el('p', { class: 'msg', role: 'alert' });
    const form = el('form', { class: 'dlg' + (o.sheet ? ' sheet' : ''), novalidate: '' },
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
    const overlay = el('div', { class: 'overlay' }, form);
    overlay.addEventListener('click', (e) => { if (e.target === overlay && o.sheet) close(); });
    layer.replaceChildren(overlay);
    const first = form.querySelector('input,textarea,select'); if (first) first.focus(); else submit.focus();
  }
  const field = (id, label, extra) => [el('label', { for: id }, label), extra];

  function editItem(it) {
    const isNew = !it;
    const data = it || { id: 'i' + Date.now().toString(36), title: '', note: '', cat: filter !== 'Tutte' ? filter : '', options: [], done: false };
    const catSelect = el('select', { id: 'f-cat' }, el('option', { value: '' }, 'Scegli una categoria'), ...CATEGORIE.map((c) => el('option', { value: c }, c)));
    catSelect.value = isNew ? (CATEGORIE.includes(filter) ? filter : '') : catOf(data);
    const options = data.options.map((o) => ({ ...o, imgs: o.imgs.slice() }));
    if (!options.length) options.push({ label: '', price: '', link: '', imgs: [] });
    // Foto di un'opzione: si aggiungono incollando l'indirizzo dell'immagine.
    function photoEditor(list) {
      const box = el('div', { class: 'imgs' });
      const msg = el('p', { class: 'hint' });
      const draw = () => {
        box.replaceChildren(...list.map((src, n) => el('div', { class: 'it' },
          el('img', { src, alt: '', referrerpolicy: 'no-referrer' }),
          el('button', { type: 'button', 'aria-label': 'Rimuovi foto', onclick: () => { list.splice(n, 1); draw(); } }, '×'))));
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
          options.length > 1 ? el('button', { class: 'btn danger', type: 'button', onclick: () => { options.splice(n, 1); drawOptions(); } }, 'Rimuovi opzione') : null);
      }));
    }
    const addOption = el('button', { class: 'btn', type: 'button', onclick: () => { if (options.length >= MAX_OPTIONS) { toast('Massimo ' + MAX_OPTIONS + ' opzioni'); return; } options.push({ label: '', price: '', link: '', imgs: [] }); drawOptions(); } }, 'Aggiungi un\'altra opzione');
    drawOptions();
    modal(isNew ? 'Nuova idea' : 'Modifica idea', [
      ...field('f-title', 'Titolo', el('input', { id: 'f-title', type: 'text', value: data.title, maxlength: '80' })),
      ...field('f-note', 'Descrizione', el('textarea', { id: 'f-note', rows: '3', maxlength: '240' }, data.note)),
      ...field('f-cat', 'Categoria', catSelect),
      el('label', null, 'Opzioni (stili, modelli, negozi)'),
      el('p', { class: 'hint' }, 'Tutte allo stesso livello: chi regala ne sceglie una e la prenotazione vale per l\'idea intera. Con una sola opzione la pagina mostra la sua galleria di foto. Da Pinterest, Amazon o Etsy: tieni premuto sulla foto (sul computer, tasto destro), scegli "Copia indirizzo immagine" e incollalo.'),
      oBox, addOption,
    ], async (form, close) => {
      const v = (id) => form.querySelector('#' + id).value.trim();
      if (!v('f-title')) return 'Scrivi almeno il titolo.';
      if (!v('f-cat')) return 'Scegli una categoria.';
      for (const o of options) {
        if (o.link && !safeUrl(o.link.trim())) return 'Il link di un\'opzione deve iniziare con http:// o https://';
      }
      const clean = options.map((o) => ({ label: (o.label || '').trim(), price: (o.price || '').trim(), link: (o.link || '').trim(), imgs: o.imgs.slice() })).filter((o) => o.label || o.price || o.link || o.imgs.length);
      const { id, ...row } = { id: data.id, title: v('f-title'), note: v('f-note'), cat: v('f-cat'), options: clean, done: !!data.done, createdAt: data.createdAt || Date.now() };
      try { await setDoc(doc(db, 'ideas', id), row); } catch (e) { return 'Salvataggio non riuscito. Sei ancora dentro?'; }
      close();
    }, 'Salva idea');
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

  $('open-admin').addEventListener('click', openLogin);
  window.addEventListener('hashchange', () => {
    render();
    if (routeId()) window.scrollTo(0, 0); else requestAnimationFrame(() => window.scrollTo(0, listScroll));
  });
  if (live) {
    onAuthStateChanged(auth, (u) => {
      admin = !!u && !u.isAnonymous;
      render();
      if (!u) signInAnonymously(auth).catch(() => {});
    });
  }
  render();
  listen();
}
