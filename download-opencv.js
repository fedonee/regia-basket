const fs = require('fs');
const path = require('path');
const https = require('https');

const LIBS_DIR = path.join(__dirname, 'public', 'libs');

const LIBRARIES = [
  {
    name: 'opencv.js',
    url: 'https://docs.opencv.org/4.5.4/opencv.js'
  },
  {
    name: 'qrcode.min.js',
    url: 'https://cdn.jsdelivr.net/npm/qrcode/build/qrcode.min.js'
  },
  {
    name: 'jsqr.js',
    url: 'https://cdn.jsdelivr.net/npm/jsqr/dist/jsQR.js'
  }
];

function ensureDirectoryExists(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`Directory creata: ${dir}`);
  }
}

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    console.log(`Inizio download: ${url} -> ${destPath}`);
    const file = fs.createWriteStream(destPath);
    
    https.get(url, (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download, status code: ${response.statusCode}`));
        return;
      }
      
      response.pipe(file);
      
      file.on('finish', () => {
        file.close();
        console.log(`Completato: ${path.basename(destPath)}`);
        resolve();
      });
    }).on('error', (err) => {
      fs.unlink(destPath, () => {});
      reject(err);
    });
  });
}

async function main() {
  try {
    ensureDirectoryExists(LIBS_DIR);
    
    for (const lib of LIBRARIES) {
      const dest = path.join(LIBS_DIR, lib.name);
      await downloadFile(lib.url, dest);
    }
    console.log('Tutte le librerie sono state scaricate correttamente!');
  } catch (error) {
    console.error('Errore durante il download delle librerie:', error);
    process.exit(1);
  }
}

main();
