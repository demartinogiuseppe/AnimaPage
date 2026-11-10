# BRIEF — pagina-viva v0.1
App per telefono: inquadri la pagina di un libro scolastico, l'app capisce l'argomento e lo mostra in realtà aumentata, con voce, approfondimenti, video e domande.

> Nome provvisorio: `pagina-viva`. Non serve verificarne la disponibilità ora: è un prototipo privato. Se l'utente vuole un altro nome, lo cambia in M0.

---

## 1. Contesto

Sono stati realizzati due prototipi HTML a mano, in `docs/reference/prototypes/`:

| File | Cosa mostra |
|---|---|
| `campania-ar.html` | geografia: rilievo 3D della Campania, eruzione del Vesuvio, colonne della popolazione, etichette toccabili |
| `micenei-troia.html` | storia: simulazione animata della guerra di Troia con linea del tempo, telecamera automatica, separazione tra «Mito» e «Storia», strati archeologici |

Entrambi hanno la stessa struttura didattica, che è il cuore del prodotto:
- **spiegazione** divisa in frasi, letta dalla voce, con la frase in corso evidenziata;
- **scena 3D sincronizzata** con la voce: ogni frase ha un istante sulla linea del tempo, e se la voce è lenta la scena aspetta;
- **etichette** sulla scena che pulsano quando vengono nominate e che si possono toccare;
- **approfondimenti** oltre il testo del libro;
- **domande**: a scelta multipla e «tocca sulla scena».

La pagina di prova reale è `docs/reference/pages/geografia_campania_p84.jpg`, fotografata dall'utente.

**Studia i due prototipi prima di scrivere codice.** Sono il riferimento per comportamento, contenuto e qualità minima. Il problema: sono scritti a mano per una sola pagina. La v0.1 deve produrre la stessa esperienza **in automatico**, per pagine diverse.

## 2. Obiettivo della v0.1

Un prototipo funzionante, da provare sul telefono dell'utente, che:

1. fotografa una pagina di libro;
2. capisce materia, argomento, concetti, luoghi, persone e date (analisi della pagina);
3. arricchisce l'argomento con **fatti verificati** da fonti web affidabili e con **2–3 video pertinenti**;
4. sceglie il **motore** di scena adatto e genera una **SceneSpec** (JSON) con narrazione, etichette, domande, approfondimenti, fonti e video;
5. mostra la scena in **realtà aumentata**, appoggiata su un piano reale (tavolo), con fallback in 3D normale.

Motori della v0.1, scelti per coprire i due prototipi più un caso generico:

| Motore | Copre | Riferimento |
|---|---|---|
| `map` | regioni, Paesi, territori: rilievo reale, confini, città, fiumi, colonne di dati | `campania-ar.html` |
| `battle` | battaglie, assedi, sbarchi: eserciti, navi, città fortificate, fasi sulla linea del tempo | `micenei-troia.html` |
| `timeline` | qualsiasi periodo storico: eventi 3D lungo una linea del tempo | nuovo |
| `card` | fallback senza 3D (grammatica, poesia, concetti astratti): testo, voce, video, domande | nuovo |

## 3. Non-obiettivi della v0.1

- pubblicazione sugli store, account utente, pagamenti;
- riconoscimento e aggancio del 3D alla pagina stampata (image tracking): v0.2;
- generazione di modelli 3D con AI (text-to-3D): troppo lenta e di qualità variabile;
- motori oltre i quattro elencati;
- modalità offline;
- area insegnanti o genitori;
- **download di video** da YouTube o altri siti: vietato dai termini d'uso, solo incorporamento ufficiale;
- copia integrale di testi da siti web: solo brevi riassunti con fonte citata.

## 4. Architettura

Monorepo TypeScript: un solo linguaggio per app, motore e server.

```
pagina-viva/
  packages/
    scene-spec/        # schemi zod della SceneSpec e dei 4 motori, tipi condivisi, validazione
    engine/            # renderer three.js: player comune + un modulo per motore
      player/          # linea del tempo, sincronia voce, etichette, domande, telecamera
      engines/map/
      engines/battle/
      engines/timeline/
      engines/card/
      assets/          # geometrie procedurali low-poly ed eventuali modelli CC0
  apps/
    web/               # app (PWA): fotocamera, caricamento foto, AR, interfaccia
  server/
    src/
      analyze/         # foto → PageAnalysis (Claude con visione)
      enrich/          # PageAnalysis → fatti verificati + video
      generate/        # PageAnalysis + fatti → SceneSpec (Claude), validazione, riparazione
      geo/             # dati geografici: rilievo, confini, coordinate
      cache/           # cache per pagina e per richiesta esterna
      ledger.ts        # registro JSONL di ogni elaborazione
  tools/
    eval/              # valutazione sul dataset di pagine (§7)
  fixtures/            # risposte registrate per la modalità mock
  docs/
```

### 4.1 SceneSpec: il contratto centrale

Tutto ruota intorno a un JSON validato. Il server lo produce e l'app lo riproduce. **Il renderer non chiama mai l'AI**: riceve solo dati.

Campi comuni a tutti i motori (indicativi, rifiniscili in M1):

```ts
SceneSpec {
  version: "0.1"
  engine: "map" | "battle" | "timeline" | "card"
  page: { subject, topic, bookPage?, language: "it" }
  kind: "history" | "myth" | "science" | "geography" | "mixed"   // etichetta visibile «Mito» / «Storia» per capitolo
  chapters: Chapter[]
  sources: Source[]                       // ogni fonte usata, con URL e data di accesso
  videos: Video[]
  disclaimers: string[]                   // es. "altezze esagerate 10 volte", "ricostruzione"
}
Chapter {
  id, title, kind, dates?
  duration: number                        // secondi di animazione
  narration: { at: number, text: string, speech?: string, highlight: PinId[], sourceIds: SourceId[] }[]
  camera: { at: number, position: Vec3, target: Vec3 }[]
  pins: Pin[]                             // etichette con info, visibilità per intervallo di tempo
  deep: { text: string, sourceIds: SourceId[] }[]
  quiz: ({ type: "choice", q, options, answer, explain } | { type: "pick", q, answerPins, explain })[]
  engineData: MapData | BattleData | TimelineData | CardData   // specifico del motore
}
```

Regole:
- `speech` è il testo da pronunciare quando differisce da quello mostrato (es. «a.C.» → «avanti Cristo», «VIIa» → «sette A»);
- **ogni numero o data** nella narrazione o negli approfondimenti deve avere almeno un `sourceId`: la pagina stessa (`page`) oppure una fonte esterna verificata. Senza fonte, la frase va riscritta senza il numero;
- i dati del motore sono **dichiarativi**: posizioni, fasi, movimenti come keyframe, mai codice.

### 4.2 Motori

Ogni motore è un modulo con `build(scene, engineData)` e `update(t)`. `update` deve essere **deterministico** rispetto al tempo `t`, così la linea del tempo si può spostare avanti e indietro, come nel prototipo di Troia.

- **`map`**: coordinate geografiche reali, con rilievo da dati di elevazione aperti (es. tile Terrarium AWS Open Data, senza chiave) ed esagerazione verticale dichiarata nei disclaimer. Confini da fonti aperte (Natural Earth; per l'Italia i confini ISTAT): verifica le licenze e citale. Livelli: altitudine, tipo di territorio, fiumi, città, colonne di dati, effetti (es. eruzione).
- **`battle`**: terreno semplice, schieramenti in formazione (InstancedMesh), unità come gruppi con keyframe, navi, carri, città fortificata parametrica, frecce, giorno e notte, fuoco. Prendi come base la logica di `micenei-troia.html`.
- **`timeline`**: eventi disposti nello spazio lungo una linea, con oggetti simbolici procedurali (colonna, corona, nave, libro…).
- **`card`**: nessun 3D, solo player, voce, video e domande.

Grafica: low-poly procedurale, come nei prototipi. Modelli esterni solo con licenza **CC0**, elencati in `docs/assets.md` con fonte e licenza.

### 4.3 Player comune

Riprendi e generalizza dai prototipi: sincronia voce e linea del tempo (la scena aspetta la voce), frase evidenziata, frase toccabile per saltare a quel momento, etichette che pulsano, scheda informativa al tocco, domande «tocca sulla scena» (durante la domanda tutte le etichette del capitolo sono visibili), visita guidata, telecamera automatica finché l'utente non la muove, pulsante «Centra».

Voce: Web Speech API con voce italiana, e fallback a evidenziazione temporizzata se manca. Prevedi un'interfaccia `TtsProvider` per sostituirla in futuro con una sintesi vocale migliore.

### 4.4 Analisi della pagina

Foto → `PageAnalysis` tramite Claude con visione e output strutturato (tool use / JSON schema):

```ts
PageAnalysis {
  subject, topic, gradeLevel?, confidence
  summary
  concepts: string[]
  entities: { name, type: "place"|"person"|"event"|"date"|"object"|"quantity", value?, onPage: true }[]
  claims: { text, onPage: true }[]          // affermazioni presenti sulla pagina, base per la narrazione
  exercises: string[]                       // domande già presenti sul libro, da riusare
  suggestedEngine, engineReason
}
```

- Modello: usa il modello Claude più recente adatto alla visione. **Non scrivere a memoria gli ID dei modelli né i parametri dell'API**: verificali nella documentazione ufficiale di Anthropic e annotali in `docs/models.md`.
- Se `confidence` è bassa o la foto è illeggibile, l'app chiede di rifare la foto.

### 4.5 Arricchimento: fatti e video

**Fatti** (`enrich/facts`):
- fonti della v0.1: **Wikipedia in italiano** (API REST e MediaWiki) e **Wikidata** (dati strutturati: date, coordinate, popolazione, altitudini), che non richiedono chiave;
- altre fonti solo da una **lista di domini consentiti** in `server/config/sources.yaml`, rispettando `robots.txt` e i termini d'uso. Niente scraping di siti che lo vietano;
- ogni fatto ha fonte, URL, data di accesso e, dove possibile, l'ID Wikidata;
- **verifica incrociata**: se un numero della pagina è diverso da quello delle fonti (dati aggiornati, arrotondamenti), non correggere il libro in silenzio. Mostra entrambi con le fonti (es. «sul libro: 5.590.076; ISTAT 2024: …»).

**Video** (`enrich/videos`):
- fonti: **YouTube Data API v3** (serve una chiave, solo lato server) e **Wikimedia Commons** (video con licenza libera, senza chiave);
- **sicurezza per minori, obbligatoria**:
  - `safeSearch=strict`;
  - preferenza per una **lista di canali educativi consentiti** in `server/config/video_channels.yaml`; la lista iniziale la propone Claude Code e la approva l'utente in M3;
  - filtro di pertinenza: il titolo e la descrizione del video vengono valutati rispetto alla `PageAnalysis`, e si scartano i video con punteggio basso;
  - durata massima configurabile (default 10 minuti);
- incorporamento solo con il player ufficiale in modalità privacy avanzata (`youtube-nocookie.com`), mai download;
- quota YouTube limitata: metti in cache i risultati per argomento e conta il consumo nel ledger.

### 4.6 Generazione della scena

`PageAnalysis` + fatti → `SceneSpec`, tramite Claude con output strutturato vincolato allo schema del motore scelto.

- **Gerarchia delle fonti**: prima la pagina del libro, poi i fatti verificati. Il modello non deve introdurre fatti che non stanno in nessuna delle due.
- Pipeline: generazione → validazione zod → controlli semantici (fonti per ogni numero, etichette usate dalle domande esistenti, tempi in ordine, coordinate dentro l'area della mappa) → al massimo **un** tentativo di riparazione → altrimenti fallback al motore `card`.
- **Etichetta «Mito»**: si applica a leggende, poemi e racconti (es. guerra di Troia) e il player la mostra in modo visibile.
- La narrazione è adatta all'età indicata dalla pagina: frasi brevi, lessico semplice.
- Prestazioni: l'utente deve vedere subito testo e voce del primo capitolo; la scena completa arriva dopo. Obiettivo: primo contenuto in meno di 10 s e scena completa in meno di 30 s su rete normale. Misura i tempi reali e riportali.

### 4.7 App e realtà aumentata

PWA con Vite + three.js.

- **Android (Chrome)**: WebXR `immersive-ar` con `hit-test`. L'utente tocca un piano e la scena si appoggia lì; poi può spostarla, ruotarla e scalarla.
- **iPhone**: Safari non supporta WebXR AR. Fallback: vista 3D normale, più una modalità «finestra» con il video della fotocamera dietro la scena (senza aggancio stabile al piano). Documenta il limite. Un'app nativa iOS (RealityKit) che legge la stessa SceneSpec è una v0.2.
- Per fotocamera e WebXR il telefono ha bisogno di HTTPS anche in sviluppo: usa un certificato locale o un tunnel. **Verifica i comandi con `--help`** e documentali in `docs/dev-setup.md`.
- Flusso: Scatta (o carica una foto) → avanzamento («Leggo la pagina… Cerco fonti… Preparo la scena…») → scena → pannello con spiegazione, approfondimenti, video, fonti e domande.

### 4.8 Ledger e cache

- `ledger.jsonl`: una riga per elaborazione, con tempi per fase, modello usato, token in ingresso e uscita, costo stimato, numero di richieste esterne, quota YouTube consumata, motore scelto, esito della validazione;
- **mai** chiavi, token, variabili d'ambiente o la foto nel ledger;
- cache per pagina (hash percettivo dell'immagine): la stessa pagina rifotografata si apre subito. Cache separata per le risposte di Wikipedia, Wikidata e YouTube.

## 5. Configurazione d'esempio

`server/.env.example` (solo nomi, mai valori reali):

```
ANTHROPIC_API_KEY=
YOUTUBE_API_KEY=
PAGINAVIVA_MODE=live          # live | mock
PAGINAVIVA_STORE_PHOTOS=false # di default le foto non vengono salvate
```

`server/config/sources.yaml`:

```yaml
facts:
  - wikipedia_it
  - wikidata
allowed_domains: []        # da proporre in M3, approvati dall'utente
videos:
  youtube:
    safe_search: strict
    max_duration_minutes: 10
    prefer_channels_file: video_channels.yaml
  wikimedia_commons: true
```

## 6. Dataset di prova

L'utente fotografa le pagine dei libri. Minimo per la v0.1: **15 pagine**, in `fixtures/pages/` (ignorate da git: sono materiale protetto da diritto d'autore):

- 5 di geografia (regioni o Paesi), compresa `geografia_campania_p84.jpg`;
- 5 di storia (Micenei, Egizi, Romani, una battaglia, un periodo);
- 2 di scienze;
- 3 fuori ambito per il 3D (grammatica, poesia, matematica), per provare il fallback `card`.

Per ogni pagina un file `*.expected.yaml` scritto con l'utente: materia, argomento, motore atteso, 3–5 fatti chiave che devono comparire.

## 7. Test e valutazione

- **Modalità mock**: tutte le chiamate a Claude, Wikipedia, Wikidata e YouTube hanno risposte registrate in `fixtures/`. Tutto il codice si deve poter testare **senza rete e senza chiavi**.
- Test unitari: schemi SceneSpec, validatori semantici, `update(t)` deterministico, sincronia voce e timeline (con TTS finto), filtri dei video.
- Test end-to-end del player in Chromium headless: carica le SceneSpec di riferimento e fai screenshot dei capitoli.
- `tools/eval`: esegue la pipeline sul dataset e produce `docs/eval/report-<data>.md` con:
  - argomento riconosciuto e motore scelto, contro l'atteso;
  - fatti chiave presenti o mancanti;
  - numeri senza fonte (deve essere 0);
  - tempi per fase e costo per pagina;
  - video proposti, con spazio per il voto manuale dell'utente (1–5);
  - elenco per la revisione umana degli errori di contenuto.
- Test che richiedono chiavi o rete reale: saltati automaticamente se le chiavi mancano.

## 8. Stack

- Node.js LTS, TypeScript strict, pnpm workspaces
- `three` (r150 o successiva; verifica la versione stabile corrente), `zod`, Vite, `vite-plugin-pwa`
- Server: Fastify, SDK ufficiale Anthropic per TypeScript
- Test: Vitest, Playwright
- Licenza del codice: da decidere con l'utente in M0 (default: tutti i diritti riservati, progetto privato)
- Codice, commenti, README e documentazione tecnica **in inglese**; testi dell'app per l'utente **in italiano**

## 9. Milestone

| # | Contenuto | Criterio di completamento |
|---|---|---|
| M0 | Decisioni con l'utente (§10), scaffold del monorepo, `.env.example`, CI locale con test | `pnpm test` verde; `docs/decisions.md` compilato |
| M1 | `scene-spec` + `engine` + player, **senza AI**: SceneSpec scritte a mano per Campania (`map`) e Troia (`battle`), più un esempio `timeline` e uno `card` | Le due scene riproducono i prototipi in un browser desktop; screenshot in `docs/m1/` |
| M2 | Analisi della pagina (mock + reale) | `PageAnalysis` corretta sulla pagina della Campania e su almeno 10 pagine del dataset; report |
| M3 | Arricchimento: fatti da Wikipedia e Wikidata, video da YouTube e Commons, filtri, cache | Per ogni pagina: fatti con fonte e 2–3 video; lista dei canali approvata dall'utente |
| M4 | Generazione SceneSpec, validazione, riparazione, fallback; flusso completo nel browser con caricamento della foto | Report di `tools/eval` su tutto il dataset; 0 numeri senza fonte |
| M5 | App sul telefono: fotocamera, AR WebXR su Android, fallback iPhone, installazione PWA | Prova reale sul telefono dell'utente con almeno 3 pagine; tempi misurati |
| M6 | README e documentazione | Sezioni del §11; demo riproducibile in modalità mock con un solo comando |

**Fermati alla fine di ogni milestone** con un riepilogo breve: cosa funziona, cosa no, decisioni prese, costi API sostenuti. Non passare alla successiva senza conferma.

Dopo M2 e dopo M4 mostra anche gli errori di contenuto trovati, prima di proseguire.

## 10. Decisioni da chiedere all'utente in M0

Chiedi e registra in `docs/decisions.md` (non procedere con supposizioni):
1. telefono usato per le prove: Android o iPhone (cambia la parte AR);
2. sistema operativo del PC;
3. disponibilità delle chiavi `ANTHROPIC_API_KEY` e `YOUTUBE_API_KEY`: senza chiavi si procede solo in mock;
4. età e classe a cui è rivolta l'app (influenza il linguaggio della narrazione);
5. nome definitivo e licenza.

## 11. README — contenuti obbligatori

- cosa fa l'app, con screenshot;
- **onestà sui limiti**:
  - le scene sono ricostruzioni semplificate;
  - i contenuti sono generati da AI e possono contenere errori, quindi ogni fatto ha una fonte consultabile;
  - c'è distinzione tra mito e storia;
  - funziona meglio su materie e argomenti concreti;
  - su iPhone l'AR è limitata;
- privacy: le foto non vengono salvate di default, nessun tracciamento, video incorporati in modalità privacy avanzata;
- fonti e licenze dei dati (elevazione, confini, Wikipedia CC BY-SA, Wikidata CC0, asset 3D);
- come avviare in modalità mock con un solo comando e come avviare con le chiavi;
- costo stimato per pagina, misurato in M4.

## 12. Criteri di accettazione della v0.1

1. Fotografando la pagina della Campania, l'app produce in automatico una scena `map` paragonabile al prototipo: rilievo, città, Vesuvio, isole, voce, domande, fonti, video.
2. Su una pagina di storia con una battaglia o un assedio, l'app produce una scena `battle` animata con la linea del tempo e, quando serve, l'etichetta «Mito».
3. Su una pagina di grammatica, l'app sceglie `card` senza produrre una scena 3D forzata.
4. Nessun numero o data viene mostrato senza fonte. Le differenze tra libro e fonti sono mostrate, non nascoste.
5. I video proposti rispettano i filtri per minori e sono incorporati, mai scaricati.
6. Tutta la logica è testabile in modalità mock, senza rete e senza chiavi.
7. Nessuna chiave nel codice dell'app, nel ledger o nei log.
8. Prova reale sul telefono dell'utente documentata, con tempi misurati.
