# Guida al Deploy su Render — CourtCast Broadcast System

Questo documento contiene le istruzioni passo-passo per gestire il codice tramite Git ed abilitare il deploy automatico su Render ad ogni push sul repository di GitHub.

---

## 1. Setup Iniziale del Repository (Prima volta)

Dal terminale del tuo computer, posizionati all'interno della cartella principale di questo progetto ed esegui i seguenti comandi:

1. **Inizializza Git** e crea il primo commit locale (il file `.gitignore` escluderà automaticamente la cartella `node_modules` e il file gigante `opencv.js`):
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   ```

2. **Crea un nuovo repository su GitHub**:
   - Vai su [github.com](https://github.com) ed esegui l'accesso.
   - Crea un nuovo repository (può essere sia pubblico che privato) chiamandolo, ad esempio, `regia-basket`.
   - Copia l'indirizzo HTTPS del repository appena creato (ad esempio: `https://github.com/tuonome/regia-basket.git`).

3. **Collega il repository locale a GitHub** ed esegui il push:
   ```bash
   git remote add origin https://github.com/tuonome/regia-basket.git
   git branch -M main
   git push -u origin main
   ```

---

## 2. Configurazione e Deploy Automatico su Render

1. Vai su [render.com](https://render.com) e crea un account (o accedi).
2. Clicca sul pulsante **"New"** in alto a destra e seleziona **"Web Service"**.
3. Collega il tuo account GitHub a Render (se non lo hai già fatto) e seleziona il repository `regia-basket` dall'elenco.
4. Render rileverà automaticamente la presenza del file `render.yaml` nella root del progetto e precompilerà tutte le configurazioni:
   - **Name**: `regia-basket`
   - **Runtime**: `Node`
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `npm start`
5. Scorri in fondo alla pagina e clicca su **"Create Web Service"**.
6. Render avvierà la build (eseguendo il download di OpenCV.js e delle librerie locali direttamente sul cloud in fase di compilazione) e renderà attiva l'applicazione.
7. Una volta terminato il processo (circa 1-2 minuti), Render ti mostrerà l'URL pubblico sicuro:
   `https://regia-basket.onrender.com` (o un nome simile a seconda della disponibilità).

---

## 3. Workflow Quotidiano: Modifica e Deploy

Il deploy automatico è completamente configurato! Per qualsiasi modifica futura al codice dell'applicazione, non c'è bisogno di accedere a Render. È sufficiente salvare ed eseguire il push da terminale:

```bash
git add .
git commit -m "Descrizione della modifica apportata"
git push
```

Render rileverà istantaneamente il push su GitHub, avvierà una nuova build di produzione in background ed effettuerà il deploy in automatico senza disservizi (Zero-Downtime Deploy).

---

## 4. Note Operative Importanti

> [!NOTE]
> **Sleep del Piano Gratuito (Cold Start):**
> Se utilizzi il piano gratuito di Render, il servizio entra in modalità standby dopo 15 minuti di inattività. Prima di iniziare una partita di basket o una sessione di test sul campo, apri l'URL pubblico della regia sul browser A e attendi 30-60 secondi affinché il server si riattivi.

> [!IMPORTANT]
> **Produzione e Sviluppo Locale:**
> - Per sviluppare e fare test in locale, puoi continuare ad avviare il server con il comando `npm run dev` (eseguito su `localhost:3000`).
> - Il deploy su Render viene utilizzato esclusivamente come server di produzione sicuro e pubblico a cui far connettere i telefoni tramite ngrok (in sviluppo) o direttamente online (in produzione).
