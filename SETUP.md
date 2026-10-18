# Configurazione di Firebase e GitHub Pages

1. Nella console Firebase apri il tuo progetto (o creane uno). Piano gratuito (Spark): non serve Cloud Storage perché le foto sono link.
2. **Build > Firestore Database > Crea database** (modalità produzione, regione europea).
3. **Build > Authentication > Metodo di accesso**: attiva **Email/password** e **Anonimo**.
4. **Authentication > Utenti > Aggiungi utente**: crea il tuo utente (email e password). Con questi dati entri da "Area riservata".
5. **Firestore > Regole**: incolla `firestore.rules`, sostituisci `TUA-EMAIL@esempio.it` con l'email del punto 4 e premi Pubblica.
6. **Impostazioni progetto > Le tue app > aggiungi app Web**: copia i valori di `firebaseConfig` in `config.js` e committa.
7. **Authentication > Impostazioni > Domini autorizzati**: aggiungi il dominio di GitHub Pages (`tuonome.github.io`).
8. **GitHub > Settings > Pages**: pubblica dal branch scelto, cartella root.
9. Apri la pagina, entra da "Area riservata" e premi "Carica le idee di esempio" (o aggiungi le tue).

Note:
- Chi apre il link vede e prenota senza account (Firebase gli assegna un accesso anonimo invisibile). Può annullare solo dallo stesso browser: se cancella i dati del sito, perde questa possibilità.
- Chiunque ha il link può prenotare qualsiasi idea. Dall'area riservata puoi liberare una prenotazione.
- Foto: in "Nuova idea" incolla l'indirizzo dell'immagine (su Pinterest "Copia indirizzo immagine", di solito `i.pinimg.com`). Se la scheda originale viene rimossa, la foto può sparire.
- Se `config.js` è vuoto la pagina mostra le idee di esempio in sola lettura.
