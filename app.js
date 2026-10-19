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
  const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return ''; } };
  const isTaken = (it) => it.done || state.reserved.has(it.id);
  const MAX_IMGS = 4;
  const norm = (d) => ({ ...d, imgs: Array.isArray(d.imgs) ? d.imgs : [], variants: Array.isArray(d.variants) ? d.variants : [] });
  const MAX_VARIANTS = 8;
  // Tutte le foto di un'idea: quelle dell'idea e poi quelle degli stili, senza doppioni.
  const imgsOf = (it) => [...new Set([...(it.imgs || []), ...(it.variants || []).map((v) => v.img)].map(safeImg).filter(Boolean))];

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
    modal('Lo prendi tu?', [el('p', { class: 'note' }, '«' + it.title + '» comparirà come già preso per tutti. Non serve nome né account. Se cambi idea, potrai annullare da questo telefono o computer.')],
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
      }, 'Sì, lo prendo io');
  }

  async function releaseRes(it) {
    if (!live) { delete demoRes[it.id]; saveDemo(); state.reserved.delete(it.id); render(); return; }
    try { await deleteDoc(doc(db, 'reservations', it.id)); } catch (e) { toast('Non sono riuscito ad annullare. Riprova.'); }
  }

  async function toggleDone(it) {
    try { await updateDoc(doc(db, 'ideas', it.id), { done: !it.done }); } catch (e) { toast('Salvataggio non riuscito.'); }
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
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
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
    return el('div', { class: 'row-actions' },
      el('button', { class: 'btn', type: 'button', onclick: () => editItem(it) }, 'Modifica'),
      state.reserved.has(it.id)
        ? el('button', { class: 'btn', type: 'button', onclick: () => releaseRes(it) }, 'Libera prenotazione')
        : el('button', { class: 'btn', type: 'button', onclick: () => toggleDone(it) }, it.done ? 'Rimetti in lista' : 'Segna come preso'),
      el('button', { class: 'btn danger', type: 'button', onclick: () => deleteItem(it) }, 'Elimina'));
  }

  function renderDetail(id) {
    const box = $('detail'); box.replaceChildren(backLink());
    const it = state.items.find((x) => x.id === id);
    if (!it) {
      box.appendChild(el('div', { class: 'empty' }, state.loading ? 'Carico l\'idea…' : 'Questa idea non c\'è più.'));
      document.title = 'Idee regalo per Mara'; return;
    }
    document.title = it.title + ' · Idee regalo per Mara';
    if (galFor !== id) { galFor = id; galIdx = 0; }
    const imgs = imgsOf(it);
    if (galIdx >= imgs.length) galIdx = 0;
    const taken = isTaken(it), isMine = isMineRes(it.id);
    const url = safeUrl(it.link);

    const main = mediaOf({ ...it, variants: [], imgs: imgs.length ? [imgs[galIdx]] : [] });
    const gallery = el('div', { class: 'gallery' }, main);
    const go = (d) => { galIdx = (galIdx + d + imgs.length) % imgs.length; render(); };
    if (imgs.length > 1) {
      main.classList.add('swipe');
      main.append(
        el('button', { class: 'gnav prev', type: 'button', 'aria-label': 'Foto precedente', onclick: () => go(-1) }, '‹'),
        el('button', { class: 'gnav next', type: 'button', 'aria-label': 'Foto successiva', onclick: () => go(1) }, '›'),
        el('span', { class: 'gcount' }, (galIdx + 1) + ' / ' + imgs.length));
      let sx = null;
      main.addEventListener('pointerdown', (e) => { sx = e.clientX; });
      main.addEventListener('pointercancel', () => { sx = null; });
      main.addEventListener('pointerup', (e) => { if (sx == null) return; const dx = e.clientX - sx; sx = null; if (Math.abs(dx) > 40) go(dx < 0 ? 1 : -1); });
    }
    if (imgs.length > 1) gallery.appendChild(el('div', { class: 'gthumbs' }, ...imgs.map((src, n) =>
      el('button', { type: 'button', 'aria-label': 'Foto ' + (n + 1), 'aria-current': String(n === galIdx), onclick: () => { galIdx = n; render(); } }, el('img', { src, alt: '', referrerpolicy: 'no-referrer' })))));

    const info = el('div', { class: 'info' });
    info.append(el('span', { class: 'cat' }, catOf(it)), el('h1', { class: 'dtitle' }, it.title));
    if (it.price) info.appendChild(el('div', { class: 'price' }, it.price));
    if (it.note) info.appendChild(el('p', { class: 'full' }, it.note));
    const vars = (it.variants || []).filter((v) => v.label || safeUrl(v.link));
    if (vars.length) {
      const list = el('div', { class: 'variants' }, el('h2', null, vars.length > 1 ? 'Scegli lo stile che preferisci' : 'Dove trovarlo'));
      vars.forEach((v) => {
        const vi = imgs.indexOf(safeImg(v.img));
        const thumb = safeImg(v.img)
          ? el('button', { class: 'vthumb', type: 'button', 'aria-label': 'Mostra la foto: ' + (v.label || 'stile'), onclick: () => { if (vi >= 0) { galIdx = vi; render(); } } }, el('img', { src: safeImg(v.img), alt: '', referrerpolicy: 'no-referrer' }))
          : el('div', { class: 'vthumb' }, giftIcon());
        const vurl = safeUrl(v.link);
        list.appendChild(el('div', { class: 'variant' }, thumb,
          el('div', { class: 'vtext' },
            el('div', { class: 'vname' }, v.label || 'Stile', v.fav ? el('span', { class: 'fav' }, 'Il mio preferito') : null),
            v.price ? el('div', { class: 'vprice' }, v.price) : null,
            vurl ? el('a', { class: 'btn vlink', href: vurl, target: '_blank', rel: 'noopener noreferrer' }, 'Vedi su ' + (hostOf(vurl) || 'il sito') + ' ↗') : null)));
      });
      info.appendChild(list);
    }
    if (taken) info.appendChild(el('p', { class: 'taken' }, isMine ? 'Hai scelto tu questo regalo.' : 'Qualcuno ha già scelto questo regalo.'));
    if (url) info.appendChild(el('a', { class: 'btn ' + (taken ? '' : 'primary') + ' wide', href: url, target: '_blank', rel: 'noopener noreferrer' }, 'Dove comprarlo: ' + (hostOf(url) || 'vai al sito') + ' ↗'));
    else if (!vars.some((v) => safeUrl(v.link))) info.appendChild(el('p', { class: 'hint-d' }, 'Per questa idea non c\'è un link: le foto servono a dare un\'idea.'));
    if (!taken) info.appendChild(el('button', { class: 'btn ' + (url ? '' : 'primary') + ' wide', type: 'button', onclick: () => reserveItem(it) }, 'Lo prendo io'));
    else if (isMine) info.appendChild(el('button', { class: 'btn quiet wide', type: 'button', onclick: () => releaseRes(it) }, 'Annulla, non lo prendo più'));
    if (admin) info.appendChild(adminActions(it));
    box.appendChild(el('div', { class: 'dpage' }, gallery, info));
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
    if (state.loading) grid.appendChild(el('div', { class: 'loading' }, 'Carico le idee…'));
    else if (state.error) grid.appendChild(el('div', { class: 'empty' }, 'Non riesco a caricare le idee. Riprova tra poco.'));
    else if (!list.length) grid.appendChild(el('div', { class: 'empty' }, admin ? 'Nessuna idea qui. Premi "Nuova idea" per aggiungerne una.' : state.items.length ? 'Nessuna idea in questa categoria, per ora.' : 'Le idee regalo arrivano presto. Ripassa tra poco!'));
    list.forEach((it) => {
      const taken = isTaken(it), isMine = isMineRes(it.id);
      const card = el('article', { class: 'card' + (taken ? ' done' : '') });
      const media = mediaOf(it);
      media.addEventListener('click', () => goDetail(it.id));
      card.appendChild(media);
      const body = el('div', { class: 'body' }, el('h2', null, el('button', { class: 'open', type: 'button', onclick: () => goDetail(it.id) }, it.title)));
      const nv = (it.variants || []).length;
      if (it.price || nv > 1) body.appendChild(el('div', { class: 'price' }, it.price || '', nv > 1 ? el('span', { class: 'styles' }, (it.price ? ' · ' : '') + nv + ' stili') : null));
      card.appendChild(body);
      if (!taken) card.appendChild(el('button', { class: 'round', type: 'button', 'aria-label': 'Lo prendo io: ' + it.title, title: 'Lo prendo io', onclick: () => reserveItem(it) }, heartIcon()));
      else if (isMine) card.appendChild(el('button', { class: 'pill', type: 'button', 'aria-label': 'Annulla la prenotazione di ' + it.title, onclick: () => releaseRes(it) }, 'Annulla'));
      else card.appendChild(el('span', { class: 'pill taken' }, 'Preso'));
      if (admin) card.appendChild(adminActions(it));
      grid.appendChild(card);
    });
    const open = state.items.filter((i) => !isTaken(i)).length;
    $('count').textContent = state.loading || !state.items.length ? '' : state.items.length + ' idee, ' + open + ' ancora da regalare';
    renderAdminBar();
  }

  function renderAdminBar() {
    const bar = $('adminbar'); bar.hidden = !admin; bar.className = admin ? 'admin-bar' : ''; bar.replaceChildren();
    $('open-admin').hidden = admin || !live;
    if (!admin) return;
    bar.append(
      el('strong', null, 'Gestione attiva: le modifiche si salvano subito'),
      el('button', { class: 'btn', type: 'button', onclick: () => editItem(null) }, 'Nuova idea'),
      el('button', { class: 'btn', type: 'button', onclick: () => signOut(auth) }, 'Esci'));
  }

  // ---------- finestre ----------
  function modal(title, fields, onSubmit, submitLabel) {
    const layer = $('layer');
    const msg = el('p', { class: 'msg', role: 'alert' });
    const form = el('form', { class: 'dlg', novalidate: '' }, el('h3', null, title), ...fields, msg);
    const close = () => layer.replaceChildren();
    const submit = el('button', { class: 'btn primary', type: 'submit' }, submitLabel || 'Conferma');
    form.append(el('div', { class: 'actions' }, el('button', { class: 'btn', type: 'button', onclick: close }, 'Annulla'), submit));
    form.addEventListener('submit', async (e) => {
      e.preventDefault(); submit.disabled = true;
      try { const err = await onSubmit(form, close); if (err) msg.textContent = err; }
      finally { submit.disabled = false; }
    });
    layer.replaceChildren(el('div', { class: 'overlay' }, form));
    const first = form.querySelector('input,textarea,select'); if (first) first.focus();
  }
  const field = (id, label, extra) => [el('label', { for: id }, label), extra];

  function editItem(it) {
    const isNew = !it;
    const data = it || { id: 'i' + Date.now().toString(36), title: '', note: '', cat: filter !== 'Tutte' ? filter : '', price: '', link: '', imgs: [], done: false };
    const catSelect = el('select', { id: 'f-cat' }, el('option', { value: '' }, 'Scegli una categoria'), ...CATEGORIE.map((c) => el('option', { value: c }, c)));
    catSelect.value = isNew ? (CATEGORIE.includes(filter) ? filter : '') : catOf(data);
    const variants = (data.variants || []).map((v) => ({ ...v }));
    const vBox = el('div', { class: 'vlist' });
    function drawVariants() {
      vBox.replaceChildren(...variants.map((v, n) => {
        const inp = (ph, key, type) => { const i = el('input', { type: type || 'text', placeholder: ph, value: v[key] || '', 'aria-label': ph }); i.addEventListener('input', () => { v[key] = i.value; }); return i; };
        const fav = el('input', { type: 'checkbox' }); fav.checked = !!v.fav;
        fav.addEventListener('change', () => { variants.forEach((x) => { x.fav = false; }); v.fav = fav.checked; drawVariants(); });
        return el('div', { class: 'vedit' },
          inp('Nome dello stile (es. Verde salvia)', 'label'), inp('Prezzo (es. 29 €)', 'price'), inp('Link dove comprarlo https://…', 'link', 'url'), inp('Foto: indirizzo immagine https://…', 'img', 'url'),
          el('label', { class: 'favlabel' }, fav, ' Il mio preferito'),
          el('button', { class: 'btn danger', type: 'button', onclick: () => { variants.splice(n, 1); drawVariants(); } }, 'Rimuovi stile'));
      }));
    }
    const addVariant = el('button', { class: 'btn', type: 'button', onclick: () => { if (variants.length >= MAX_VARIANTS) { toast('Massimo ' + MAX_VARIANTS + ' stili'); return; } variants.push({ label: '', price: '', link: '', img: '', fav: false }); drawVariants(); } }, 'Aggiungi uno stile');
    drawVariants();
    const imgs = (data.imgs || []).slice();
    const imgBox = el('div', { class: 'imgs' });
    const imgMsg = el('p', { class: 'hint' });
    function drawImgs() {
      imgBox.replaceChildren(...imgs.map((src, n) => el('div', { class: 'it' },
        el('img', { src, alt: '', referrerpolicy: 'no-referrer' }),
        el('button', { type: 'button', 'aria-label': 'Rimuovi foto', onclick: () => { imgs.splice(n, 1); drawImgs(); } }, '×'))));
      imgMsg.textContent = imgs.length + ' di ' + MAX_IMGS + ' foto. La prima è quella grande sulla scheda.';
    }
    const urlIn = el('input', { id: 'f-imgurl', type: 'url', placeholder: 'https://… indirizzo di un\'immagine' });
    const addUrl = () => {
      const u = urlIn.value.trim();
      if (!u) return;
      if (!/^https:\/\//i.test(u)) { toast('L\'indirizzo deve iniziare con https://'); return; }
      if (/(^|\.)pinterest\.[a-z.]+\/pin\//i.test(u.replace(/^https:\/\//i, ''))) { toast('Questo è il link della scheda, non della foto. Tieni premuto sulla foto e scegli "Copia indirizzo immagine".'); return; }
      if (imgs.length >= MAX_IMGS) { toast('Massimo ' + MAX_IMGS + ' foto per idea'); return; }
      imgs.push(u); urlIn.value = ''; drawImgs();
    };
    urlIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addUrl(); } });
    drawImgs();
    modal(isNew ? 'Nuova idea' : 'Modifica idea', [
      ...field('f-title', 'Titolo', el('input', { id: 'f-title', type: 'text', value: data.title, maxlength: '80' })),
      ...field('f-note', 'Descrizione', el('textarea', { id: 'f-note', rows: '3', maxlength: '240' }, data.note)),
      ...field('f-cat', 'Categoria', catSelect),
      ...field('f-price', 'Prezzo indicativo', el('input', { id: 'f-price', type: 'text', value: data.price, maxlength: '24' })),
      ...field('f-link', 'Link dove comprarlo (facoltativo)', el('input', { id: 'f-link', type: 'url', value: data.link, placeholder: 'https://' })),
      el('label', null, 'Stili / varianti (facoltativo)'), el('p', { class: 'hint' }, 'Per più modelli della stessa idea: chi regala ne sceglie uno, la prenotazione vale per tutti.'), vBox, addVariant,
      el('label', null, 'Foto (da link)'), imgBox,
      el('div', { class: 'inline' }, urlIn, el('button', { class: 'btn', type: 'button', onclick: addUrl }, 'Aggiungi')),
      imgMsg,
      el('p', { class: 'hint' }, 'Da Pinterest, Amazon o altri siti: tieni premuto sulla foto (sul computer, tasto destro), scegli "Copia indirizzo immagine" e incollalo qui. Deve essere l\'indirizzo della foto, non della pagina.'),
    ], async (form, close) => {
      const v = (id) => form.querySelector('#' + id).value.trim();
      if (!v('f-title')) return 'Scrivi almeno il titolo.';
      if (!v('f-cat')) return 'Scegli una categoria.';
      if (v('f-link') && !safeUrl(v('f-link'))) return 'Il link deve iniziare con http:// o https://';
      for (const v of variants) {
        if (v.link && !safeUrl(v.link.trim())) return 'Il link di uno stile deve iniziare con http:// o https://';
        if (v.img && !safeImg(v.img.trim())) return 'La foto di uno stile deve essere un indirizzo https://';
      }
      const cleanVariants = variants.map((v) => ({ label: (v.label || '').trim(), price: (v.price || '').trim(), link: (v.link || '').trim(), img: (v.img || '').trim(), fav: !!v.fav })).filter((v) => v.label || v.link || v.img);
      const { id, ...row } = { id: data.id, title: v('f-title'), note: v('f-note'), cat: v('f-cat'), price: v('f-price'), link: v('f-link'), imgs: imgs.slice(), variants: cleanVariants, done: !!data.done, createdAt: data.createdAt || Date.now() };
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
