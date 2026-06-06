# Script di Setup Git e Push automatico su GitHub
# Eseguire in PowerShell nella cartella del progetto

Write-Host "=== CourtCast: Configurazione Git e Repository ===" -ForegroundColor Cyan

# 1. Configurazione Identità Git
$currentName = git config --global user.name
$currentEmail = git config --global user.email

if (-not $currentName) {
    $nameInput = Read-Host "Inserisci il tuo Nome per i commit Git"
    if ($nameInput) {
        git config --global user.name "$nameInput"
        Write-Host "Nome configurato: $nameInput" -ForegroundColor Green
    }
} else {
    Write-Host "Nome Git già configurato: $currentName" -ForegroundColor DarkGray
}

if (-not $currentEmail) {
    $emailInput = Read-Host "Inserisci la tua Email per i commit Git"
    if ($emailInput) {
        git config --global user.email "$emailInput"
        Write-Host "Email configurata: $emailInput" -ForegroundColor Green
    }
} else {
    Write-Host "Email Git già configurata: $currentEmail" -ForegroundColor DarkGray
}

# 2. Commit locale
Write-Host "`nStaging e commit dei file in corso..." -ForegroundColor Cyan
git add .
$changes = git status --porcelain
if ($changes) {
    git commit -m "Initial commit"
    Write-Host "Commit iniziale effettuato con successo!" -ForegroundColor Green
} else {
    Write-Host "Nessun file modificato da committare, repository pulito." -ForegroundColor Yellow
}

# 3. Configurazione Remote e Push
Write-Host "`n=== Collegamento del Repository remoto ===" -ForegroundColor Cyan
$repoUrl = Read-Host "Inserisci l'URL del repository GitHub (es. https://github.com/tuonome/regia-basket.git)"

if ($repoUrl) {
    # Rimuove il remote origin se esistente
    $existingRemote = git remote
    if ($existingRemote -contains "origin") {
        git remote remove origin
    }
    
    git remote add origin $repoUrl
    git branch -M main
    
    Write-Host "`nEsecuzione del Push su GitHub..." -ForegroundColor Cyan
    git push -u origin main
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "`n[SUCCESSO] Il codice è stato caricato su GitHub!" -ForegroundColor Green
    } else {
        Write-Host "`n[ATTENZIONE] Il push non è andato a buon fine. Controlla le tue credenziali GitHub o l'URL inserito." -ForegroundColor Red
    }
} else {
    Write-Host "Nessun URL fornito. Collegamento remoto saltato." -ForegroundColor Yellow
}

Write-Host "`n=== Passi successivi ===" -ForegroundColor Cyan
Write-Host "1. Se non lo hai già fatto, crea il tuo Web Service su Render."
Write-Host "2. Collega il tuo account GitHub e seleziona il repo 'regia-basket'."
Write-Host "3. Render leggerà la configurazione automatica da render.yaml ed eseguirà il deploy."
Write-Host "========================================" -ForegroundColor Cyan
