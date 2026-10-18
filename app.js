(function () {
  const cfg = window.REGALI_CONFIG || {};
  const sb = cfg.url && cfg.anonKey && window.supabase ? window.supabase.createClient(cfg.url, cfg.anonKey) : null;
  const seed = JSON.parse(document.getElementById('data').textContent).items;
  const $ = (id) => document.getElementById(id);
  const bands = ['var(--c1)', 'var(--c2)', 'var(--c3)', 'var(--c4)', 'var(--c5)'];
  const state = { items: sb ? [] : seed, reserved: new Set(), loading: !!sb, error: false };
  let filter = 'Tutte', admin = false;
  // Le prenotazioni fatte da questo dispositivo: idea -> codice segreto per annullarle.
  let mine = {};
  try { mine = JSON.parse(localStorage.getItem('regali-mine') || '{}'); } catch (e) {}
  const saveMine = () => { try { localStorage.setItem('regali-mine', JSON.stringify(mine)); } catch (e) {} };

  for (let i = 0; i < 40; i++) $('bunting').appendChild(document.createElement('i'));

  function el(tag, props, ...kids) {
    const n = document.createElement(tag);
    if (props) for (const k in props) { if (k === 'class') n.className = props[k]; else if (k.startsWith('on')) n.addEventListener(k.slice(2), props[k]); else n.setAttribute(k, props[k]); }
    for (const kid of kids) if (kid != null) n.append(kid);
    return n;
  }
  const cats = () => [...new Set(state.items.map((i) => i.cat).filter(Boolean))];
  const bandOf = (cat) => bands[Math.max(0, cats().indexOf(cat)) % bands.length];
  const safeUrl = (u) => /^https?:\/\//i.test(u || '') ? u : '';
  const safeImg = (u) => /^https:\/\//i.test(u || '') ? u : '';
  const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return ''; } };
  const isTaken = (it) => it.done || state.reserved.has(it.id);
  const MAX_IMGS = 4;

  function toast(text) {
    const t = el('div', { class: 'toast', role: 'status' }, text);
    document.body.appendChild(t); setTimeout(() => t.remove(), 3200);
  }

  // ---------- dati ----------
  async function load() {
    if (!sb) return;
    const [ideas, reserved] = await Promise.all([
      sb.from('ideas').select('*').order('created_at', { ascending: false }),
      sb.from('reserved').select('idea_id'),
    ]);
    state.loading = false;
    if (ideas.error) state.error = true;
    else { state.error = false; state.items = ideas.data.map((r) => ({ ...r, imgs: Array.isArray(r.imgs) ? r.imgs : [] })); }
    if (!reserved.error) {
      state.reserved = new Set(reserved.data.map((r) => r.idea_id));
      for (const k in mine) if (!state.reserved.has(k)) delete mine[k];
      saveMine();
    }
    render();
  }

  async function reserveItem(it) {
    modal('Lo prendi tu?', [el('p', { class: 'note' }, '«' + it.title + '» comparirà come già preso per tutti. Non serve nome né account. Se cambi idea, potrai annullare da questo telefono o computer.')],
      async (form, close) => {
        const id = crypto.randomUUID();
        const { error } = await sb.from('reservations').insert({ id, idea_id: it.id });
        if (error) {
          close();
          toast(error.code === '23505' ? 'Ops, qualcuno l\'ha appena preso.' : 'Non sono riuscito a prenotare. Riprova.');
          await load(); return;
        }
        mine[it.id] = id; saveMine(); state.reserved.add(it.id);
        close(); render(); toast('Perfetto, è tuo!');
      }, 'Sì, lo prendo io');
  }

  async function releaseMine(it) {
    const { error } = await sb.rpc('release_reservation', { rid: mine[it.id] });
    if (error) { toast('Non sono riuscito ad annullare. Riprova.'); return; }
    delete mine[it.id]; saveMine(); state.reserved.delete(it.id); render();
  }

  async function adminRelease(it) {
    const { error } = await sb.from('reservations').delete().eq('idea_id', it.id);
    if (error) { toast('Non sono riuscito a liberarlo.'); return; }
    state.reserved.delete(it.id); render();
  }

  async function toggleDone(it) {
    const { error } = await sb.from('ideas').update({ done: !it.done }).eq('id', it.id);
    if (error) { toast('Salvataggio non riuscito.'); return; }
    it.done = !it.done; render();
  }

  async function deleteItem(it) {
    if (!confirm('Eliminare «' + it.title + '»?')) return;
    const { error } = await sb.from('ideas').delete().eq('id', it.id);
    if (error) { toast('Non sono riuscito a eliminarla.'); return; }
    state.items = state.items.filter((x) => x.id !== it.id); render();
  }

  // ---------- schede ----------
  function mediaOf(it) {
    const imgs = (it.imgs || []).map(safeImg).filter(Boolean);
    const media = el('div', { class: 'media' });
    const ar = ['4 / 3', '1 / 1', '3 / 4', '5 / 4'][(parseInt(String(it.id).replace(/\D/g, ''), 10) || 0) % 4];
    const placeholder = () => el('div', { class: 'ph', style: '--ar:' + ar, 'aria-hidden': 'true' }, (it.title || '?').charAt(0).toUpperCase());
    if (!imgs.length) { media.appendChild(placeholder()); return media; }
    const main = el('img', { src: imgs[0], alt: it.title, loading: 'lazy', referrerpolicy: 'no-referrer' });
    main.addEventListener('error', () => main.replaceWith(placeholder()));
    media.appendChild(main);
    if (imgs.length > 1) {
      const thumbs = el('div', { class: 'thumbs' });
      imgs.forEach((src, n) => {
        const b = el('button', { type: 'button', 'aria-label': 'Foto ' + (n + 1), 'aria-current': String(n === 0) }, el('img', { src, alt: '', referrerpolicy: 'no-referrer' }));
        b.addEventListener('click', () => {
          main.src = src;
          thumbs.querySelectorAll('button').forEach((x) => x.setAttribute('aria-current', String(x === b)));
        });
        thumbs.appendChild(b);
      });
      media.appendChild(thumbs);
    }
    return media;
  }

  function render() {
    if (filter !== 'Tutte' && !cats().includes(filter)) filter = 'Tutte';
    const chips = $('chips'); chips.replaceChildren();
    ['Tutte', ...cats()].forEach((c) => chips.appendChild(el('button', { class: 'chip', type: 'button', 'aria-pressed': String(c === filter), onclick: () => { filter = c; render(); } }, c)));

    const list = state.items.filter((i) => filter === 'Tutte' || i.cat === filter);
    const grid = $('grid'); grid.replaceChildren();
    if (state.loading) grid.appendChild(el('div', { class: 'loading' }, 'Carico le idee…'));
    else if (state.error) grid.appendChild(el('div', { class: 'empty' }, 'Non riesco a caricare le idee. Riprova tra poco.'));
    else if (!list.length) grid.appendChild(el('div', { class: 'empty' }, admin ? 'Nessuna idea qui. Premi "Nuova idea" per aggiungerne una.' : 'Nessuna idea in questa categoria, per ora.'));
    list.forEach((it) => {
      const taken = isTaken(it), isMine = state.reserved.has(it.id) && !!mine[it.id];
      const card = el('article', { class: 'card' + (taken ? ' done' : ''), style: '--band:' + bandOf(it.cat) });
      if (taken) card.appendChild(el('div', { class: 'stamp' }, isMine ? 'Lo prendi tu' : 'Già preso'));
      const media = mediaOf(it); media.prepend(el('span', { class: 'tag' }, it.cat || 'Varie')); card.appendChild(media);
      const body = el('div', { class: 'body' }, el('h2', null, it.title));
      if (it.note) body.appendChild(el('p', { class: 'note' }, it.note));
      if (it.price) body.appendChild(el('div', { class: 'price' }, it.price));
      const url = safeUrl(it.link);
      if (url) body.appendChild(el('a', { class: 'link', href: url, target: '_blank', rel: 'noopener noreferrer' }, 'Guarda su ' + (hostOf(url) || 'il sito') + ' ↗'));
      if (!taken) body.appendChild(el('button', { class: 'btn primary reserve', type: 'button', onclick: () => sb ? reserveItem(it) : toast('La prenotazione non è ancora attiva su questa copia.') }, 'Lo prendo io'));
      else if (isMine) body.appendChild(el('button', { class: 'btn quiet reserve', type: 'button', onclick: () => releaseMine(it) }, 'Annulla, non lo prendo più'));
      if (admin) body.appendChild(el('div', { class: 'row-actions' },
        el('button', { class: 'btn', type: 'button', onclick: () => editItem(it) }, 'Modifica'),
        state.reserved.has(it.id)
          ? el('button', { class: 'btn', type: 'button', onclick: () => adminRelease(it) }, 'Libera prenotazione')
          : el('button', { class: 'btn', type: 'button', onclick: () => toggleDone(it) }, it.done ? 'Rimetti in lista' : 'Segna come preso'),
        el('button', { class: 'btn danger', type: 'button', onclick: () => deleteItem(it) }, 'Elimina')));
      card.appendChild(body); grid.appendChild(card);
    });
    const open = state.items.filter((i) => !isTaken(i)).length;
    $('count').textContent = state.loading ? '' : state.items.length + ' idee, ' + open + ' ancora da regalare';
    renderAdminBar();
  }

  function renderAdminBar() {
    const bar = $('adminbar'); bar.hidden = !admin; bar.className = admin ? 'admin-bar' : ''; bar.replaceChildren();
    $('open-admin').hidden = admin || !sb;
    if (!admin) return;
    bar.append(
      el('strong', null, 'Gestione attiva: le modifiche si salvano subito'),
      el('button', { class: 'btn', type: 'button', onclick: () => editItem(null) }, 'Nuova idea'),
      el('button', { class: 'btn', type: 'button', onclick: () => sb.auth.signOut() }, 'Esci'));
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

  function fileToBlob(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onerror = reject;
      fr.onload = () => {
        const im = new Image();
        im.onerror = reject;
        im.onload = () => {
          const s = Math.min(1, 1200 / Math.max(im.width, im.height));
          const c = document.createElement('canvas');
          c.width = Math.round(im.width * s); c.height = Math.round(im.height * s);
          c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
          c.toBlob((b) => (b ? resolve(b) : reject(new Error('blob'))), 'image/jpeg', 0.8);
        };
        im.src = fr.result;
      };
      fr.readAsDataURL(file);
    });
  }
  async function uploadPhoto(file, ideaId) {
    const blob = await fileToBlob(file);
    const path = ideaId + '/' + Date.now() + '-' + Math.random().toString(36).slice(2, 6) + '.jpg';
    const { error } = await sb.storage.from('foto').upload(path, blob, { contentType: 'image/jpeg' });
    if (error) throw error;
    return sb.storage.from('foto').getPublicUrl(path).data.publicUrl;
  }

  function editItem(it) {
    const isNew = !it;
    const data = it || { id: 'i' + Date.now().toString(36), title: '', note: '', cat: filter !== 'Tutte' ? filter : '', price: '', link: '', imgs: [], done: false };
    const dl = el('datalist', { id: 'f-cats' }, ...cats().map((c) => el('option', { value: c })));
    const imgs = (data.imgs || []).slice();
    const imgBox = el('div', { class: 'imgs' });
    const imgMsg = el('p', { class: 'hint' });
    function drawImgs() {
      imgBox.replaceChildren(...imgs.map((src, n) => el('div', { class: 'it' },
        el('img', { src, alt: '', referrerpolicy: 'no-referrer' }),
        el('button', { type: 'button', 'aria-label': 'Rimuovi foto', onclick: () => { imgs.splice(n, 1); drawImgs(); } }, '×'))));
      imgMsg.textContent = imgs.length + ' di ' + MAX_IMGS + ' foto. La prima è quella grande sulla scheda.';
    }
    const fileIn = el('input', { id: 'f-file', type: 'file', accept: 'image/*', multiple: '' });
    fileIn.addEventListener('change', async () => {
      for (const f of [...fileIn.files]) {
        if (imgs.length >= MAX_IMGS) { toast('Massimo ' + MAX_IMGS + ' foto per idea'); break; }
        imgMsg.textContent = 'Carico ' + f.name + '…';
        try { imgs.push(await uploadPhoto(f, data.id)); } catch (e) { toast('Non riesco a caricare ' + f.name); }
      }
      fileIn.value = ''; drawImgs();
    });
    const urlIn = el('input', { id: 'f-imgurl', type: 'url', placeholder: 'https://… indirizzo di un\'immagine' });
    const addUrl = () => {
      const u = urlIn.value.trim();
      if (!u) return;
      if (!/^https:\/\//i.test(u)) { toast('L\'indirizzo deve iniziare con https://'); return; }
      if (imgs.length >= MAX_IMGS) { toast('Massimo ' + MAX_IMGS + ' foto per idea'); return; }
      imgs.push(u); urlIn.value = ''; drawImgs();
    };
    urlIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addUrl(); } });
    drawImgs();
    modal(isNew ? 'Nuova idea' : 'Modifica idea', [
      ...field('f-title', 'Titolo', el('input', { id: 'f-title', type: 'text', value: data.title, maxlength: '80' })),
      ...field('f-note', 'Descrizione', el('textarea', { id: 'f-note', rows: '3', maxlength: '240' }, data.note)),
      ...field('f-cat', 'Categoria', el('input', { id: 'f-cat', type: 'text', value: data.cat, list: 'f-cats', maxlength: '24' })), dl,
      ...field('f-price', 'Prezzo indicativo', el('input', { id: 'f-price', type: 'text', value: data.price, maxlength: '24' })),
      ...field('f-link', 'Link dove comprarlo (facoltativo)', el('input', { id: 'f-link', type: 'url', value: data.link, placeholder: 'https://' })),
      ...field('f-file', 'Foto', fileIn), imgBox,
      el('div', { class: 'inline' }, urlIn, el('button', { class: 'btn', type: 'button', onclick: addUrl }, 'Aggiungi')),
      imgMsg,
      el('p', { class: 'hint' }, 'Su Amazon o altri negozi: tieni premuto sulla foto del prodotto, scegli "Copia indirizzo immagine" e incollalo qui. Oppure carica uno screenshot.'),
    ], async (form, close) => {
      const v = (id) => form.querySelector('#' + id).value.trim();
      if (!v('f-title')) return 'Scrivi almeno il titolo.';
      if (v('f-link') && !safeUrl(v('f-link'))) return 'Il link deve iniziare con http:// o https://';
      const row = { id: data.id, title: v('f-title'), note: v('f-note'), cat: v('f-cat'), price: v('f-price'), link: v('f-link'), imgs: imgs.slice(), done: !!data.done };
      const { error } = await sb.from('ideas').upsert(row);
      if (error) return 'Salvataggio non riuscito: ' + error.message;
      const i = state.items.findIndex((x) => x.id === row.id);
      if (i >= 0) state.items[i] = { ...state.items[i], ...row }; else state.items.unshift(row);
      close(); render();
    }, 'Salva idea');
  }

  function openLogin() {
    modal('Area riservata', [
      ...field('f-mail', 'Email', el('input', { id: 'f-mail', type: 'email', autocomplete: 'username' })),
      ...field('f-pw', 'Password', el('input', { id: 'f-pw', type: 'password', autocomplete: 'current-password' })),
    ], async (form, close) => {
      const { error } = await sb.auth.signInWithPassword({ email: form.querySelector('#f-mail').value.trim(), password: form.querySelector('#f-pw').value });
      if (error) return 'Email o password non corrette.';
      close();
    }, 'Entra');
  }

  $('open-admin').addEventListener('click', openLogin);
  if (sb) {
    sb.auth.onAuthStateChange((event, session) => { const now = !!session; if (now !== admin) { admin = now; render(); } });
    sb.auth.getSession().then(({ data }) => { if (data && data.session && !admin) { admin = true; render(); } });
  }
  render();
  load();
})();
