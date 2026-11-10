# CLAUDE.md — AnimaPage (ex pagina-viva)

## Cosa stai costruendo
Le specifiche complete sono in `docs/briefs/BRIEF_paginaviva.md`. Leggile prima di scrivere codice.

Studia anche i due prototipi in `docs/reference/prototypes/` (aprili nel browser e leggine il codice): sono il riferimento per comportamento e qualità minima dell'esperienza.

## Regole di lavoro
- Lavora una milestone alla volta. Alla fine di ognuna fermati e scrivi un riepilogo breve: cosa funziona, cosa no, decisioni prese, costi API sostenuti. Non passare alla successiva senza conferma.
- In M0 fai prima le domande del §10 del brief. Non procedere con supposizioni su telefono, chiavi o pubblico.
- Nessun comando di CLI, flag, ID di modello o parametro di API scritto a memoria: verificali con `--help` o nella documentazione ufficiale e annotali in `docs/` (`dev-setup.md`, `models.md`).
- Tutto deve funzionare anche in modalità **mock**, senza rete e senza chiavi. I test che richiedono chiavi si saltano da soli se mancano.
- Le chiavi API stanno solo nel server (`server/.env`, ignorato da git). Mai nel codice dell'app, nel ledger, nei log o nei commit.
- Le foto delle pagine sono materiale protetto da diritto d'autore: `fixtures/pages/` è in `.gitignore`. Di default l'app non le salva.
- Contenuti: ogni numero o data mostrato all'utente deve avere una fonte (la pagina o una fonte verificata). Mito e storia vanno sempre distinti.
- Video: solo incorporati con il player ufficiale, mai scaricati. Filtri per minori sempre attivi.
- Codice, commenti, README e documentazione tecnica in **inglese**. Testi dell'app in **italiano**. Comunicazione con l'utente in **italiano**, diretta e breve.

## Ambiente
- M0, M1 e la logica di M2–M4 si sviluppano e si testano con la modalità mock.
- Le chiamate reali a Claude e YouTube richiedono le chiavi fornite dall'utente in M0. Se mancano, segnalalo e prosegui in mock.
- M5 richiede il telefono dell'utente sulla stessa rete del PC, con HTTPS. Se l'AR non è disponibile sul dispositivo, segnalalo e usa il fallback 3D invece di simularla.
