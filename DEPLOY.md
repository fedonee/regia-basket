# Guida al Deploy su Render — CourtCast Broadcast System

Segui questi passi in ordine per caricare l'applicazione su GitHub e configurare il deploy automatico su Render.

---

### STEP 1 — Installa Git (se non presente)
Se non hai Git installato sul tuo PC Windows:
1. Scarica l'installer da [git-scm.com](https://git-scm.com).
2. Avvia l'installazione e procedi cliccando su **Next** lasciando tutte le opzioni predefinite.

---

### STEP 2 — Crea un account GitHub
1. Vai su [github.com](https://github.com) e registrati (o accedi se hai già un account).
2. Clicca su **New Repository** (o sul tasto "+" in alto a destra) per creare un repository:
   - Nome repository: `regia-basket`
   - Visibilità: a tua scelta (**Public** o **Private**)
   - **IMPORTANTE:** Lascia deselezionate le opzioni per aggiungere un README, un file .gitignore o una licenza (crea un repository vuoto).
3. Una volta creato, copia l'URL HTTPS fornito (sarà simile a: `https://github.com/tuonome/regia-basket.git`).

---

### STEP 3 — Esegui lo script di setup
Apri PowerShell, posizionati nella cartella principale del progetto ed esegui lo script interattivo:

```powershell
.\setup.ps1
```

> [!NOTE]
> Se ricevi un errore di sicurezza relativo all'esecuzione degli script in PowerShell, puoi sbloccare temporaneamente l'esecuzione eseguendo:
> `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass`
> e poi riavviando il comando `.\setup.ps1`.

Segui le istruzioni a schermo:
- Inserisci il tuo **Nome** e la tua **Email** per firmare i commit (se non li hai già configurati a livello globale in Git).
- Incolla l'**URL del repository GitHub** copiato al punto 2.
Lo script si occuperà di creare il commit locale, configurare il ramo principale `main`, collegare il tuo GitHub e fare il primo push.

---

### STEP 4 — Configura Render
1. Vai su [render.com](https://render.com) e crea un account gratuito collegando il tuo profilo GitHub.
2. Clicca sul pulsante **New** in alto a destra e seleziona **Web Service**.
3. Associa il repository `regia-basket` appena creato.
4. Render leggerà automaticamente il file `render.yaml` presente nella radice del progetto e configurerà i comandi:
   - **Build Command**: `npm install && npm run build` (che scaricherà OpenCV.js offline in produzione)
   - **Start Command**: `npm start`
5. Clicca su **Create Web Service** e attendi circa 2 minuti per il completamento del deploy.
6. Render ti fornirà un URL pubblico con protocollo sicuro HTTPS (ad esempio: `https://regia-basket.onrender.com`).

---

### STEP 5 — Workflow quotidiano
Una volta effettuato il primo deploy, ogni successiva modifica viene applicata in automatico. Dal terminale locale ti basterà fare:

```bash
git add .
git commit -m "Descrizione delle modifiche apportate"
git push
```

Render rileverà la modifica su GitHub e avvierà il deploy in background del nuovo codice in tempo reale.
