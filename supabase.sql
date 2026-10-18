-- Schema per "Idee regalo per Mara". Incollalo nel SQL Editor di Supabase ed eseguilo una volta.

-- Idee: tutti leggono, solo chi è loggato (tu) scrive.
create table if not exists public.ideas (
  id text primary key,
  title text not null,
  note text not null default '',
  cat text not null default '',
  price text not null default '',
  link text not null default '',
  imgs jsonb not null default '[]'::jsonb,
  done boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.ideas enable row level security;
create policy "idee visibili a tutti" on public.ideas for select using (true);
create policy "idee gestite dal proprietario" on public.ideas for all to authenticated using (true) with check (true);

-- Prenotazioni: chiunque può inserirne una (senza account), una sola per idea.
-- L'id è un codice segreto generato dal browser di chi prenota: serve per annullare.
create table if not exists public.reservations (
  id uuid primary key,
  idea_id text not null unique references public.ideas(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.reservations enable row level security;
create policy "chiunque puo prenotare" on public.reservations for insert to anon, authenticated with check (true);
create policy "il proprietario gestisce le prenotazioni" on public.reservations for all to authenticated using (true) with check (true);

-- Chi visita vede solo quali idee sono prese, mai i codici segreti.
create or replace view public.reserved as select idea_id from public.reservations;
grant select on public.reserved to anon, authenticated;

-- Annullare la propria prenotazione, conoscendo il codice.
create or replace function public.release_reservation(rid uuid) returns void
language sql security definer set search_path = public as $$
  delete from public.reservations where id = rid;
$$;
grant execute on function public.release_reservation(uuid) to anon, authenticated;

-- Foto: cartella pubblica in lettura, caricamento solo per te.
insert into storage.buckets (id, name, public) values ('foto', 'foto', true) on conflict (id) do nothing;
create policy "foto caricate dal proprietario" on storage.objects for insert to authenticated with check (bucket_id = 'foto');
create policy "foto modificate dal proprietario" on storage.objects for update to authenticated using (bucket_id = 'foto');
create policy "foto eliminate dal proprietario" on storage.objects for delete to authenticated using (bucket_id = 'foto');

-- Le 9 idee di partenza.
insert into public.ideas (id, title, note, cat, price) values
  ('i1', 'Corso di cucina in due', 'Una serata a impastare, tagliare e assaggiare insieme, con uno chef che spiega tutto passo per passo.', 'Esperienze', '80–120 €'),
  ('i2', 'Set di tè e infusi artigianali', 'Sei miscele in barattolini di latta, con un colino a forma di fiore. Da bere sul divano.', 'Cucina', '25–35 €'),
  ('i3', 'Un limone in vaso', 'Un alberello vero per il balcone, con terriccio e istruzioni per farlo fiorire.', 'Casa', '20–40 €'),
  ('i4', 'Libro di ricette illustrato', 'Uno di quelli grandi, con le foto, da sfogliare anche senza cucinare niente.', 'Libri', '20–30 €'),
  ('i5', 'Cena a sorpresa', 'Un tavolo prenotato in un posto nuovo. Il nome si scopre solo all''ingresso.', 'Esperienze', '60–100 €'),
  ('i6', 'Plaid in lana morbidissimo', 'Grande abbastanza per due, in un colore caldo. Per le sere d''autunno.', 'Casa', '40–60 €'),
  ('i7', 'Giornata alle terme', 'Ingresso per un pomeriggio di acqua calda e niente da fare.', 'Benessere', '50–90 €'),
  ('i8', 'Candela profumata fatta a mano', 'Cera di soia, profumo di fico e cedro, nel vasetto di vetro che poi si riusa.', 'Casa', '15–25 €'),
  ('i9', 'Kit per fare il pane', 'Lievito madre, cestino per la lievitazione e lama per incidere. La domenica profuma.', 'Cucina', '30–45 €')
on conflict (id) do nothing;
