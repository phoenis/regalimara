# Configurazione di Supabase e GitHub Pages

1. Crea un progetto gratuito su https://supabase.com.
2. **SQL Editor**: incolla `supabase.sql` ed eseguilo.
3. **Authentication > Providers > Email**: lascia attivo l'accesso con email e password e **disattiva "Allow new users to sign up"**, così l'unico account sei tu.
4. **Authentication > Users > Add user**: crea il tuo utente (email e password). Con questi dati entri da "Area riservata".
5. **Project Settings > API**: copia "Project URL" e la chiave "anon public" in `config.js`.
6. Committa `config.js`. La chiave anon è pubblica per progettazione: i dati sono protetti dalle regole di `supabase.sql`.
7. **GitHub > Settings > Pages**: pubblica dal branch scelto, cartella root.

Note:
- Chi apre il link vede e prenota senza account. Chi prenota può annullare solo dallo stesso dispositivo.
- Chiunque ha il link può prenotare qualsiasi idea (non c'è un limite per persona). Dall'area riservata puoi liberare una prenotazione.
- Se `config.js` è vuoto la pagina mostra le idee di esempio in sola lettura.
