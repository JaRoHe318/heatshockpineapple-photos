import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// --- CONFIGURATION ---
const DRY_RUN = true; // Set to FALSE to actually delete files
// ---------------------

// Setup paths for ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Paths to check
const PROJECT_ROOT = path.join(__dirname, '..'); 
const DATA_PATH = path.join(PROJECT_ROOT, 'src/data/photos.json');
const PUBLIC_DIR = path.join(PROJECT_ROOT, 'public');

const FOLDERS_TO_SCAN = [
    'images/full',
    'images/thumbs'
];

console.log(`🦇 Batman Maker: Loading data from ${DATA_PATH}`);
const rawData = fs.readFileSync(DATA_PATH, 'utf-8');
const photosData = JSON.parse(rawData);
const allPhotos = photosData.photos || [];

// 2. Build a Set of "Allowed" File Paths
const allowedFiles = new Set();

function addAllowed(relativePath) {
    if (!relativePath) return;
    
    // 1. Allow the original file (e.g., image.jpg)
    const fullPath = path.join(PUBLIC_DIR, relativePath);
    allowedFiles.add(fullPath);

    // 2. AUTO-ALLOW THE WEBP TWIN
    // If it's a JPG/JPEG, explicitly permit the .webp version too
    if (/\.jpe?g$/i.test(fullPath)) {
        const webpPath = fullPath.replace(/\.jpe?g$/i, '.webp');
        allowedFiles.add(webpPath);
    }
}

allPhotos.forEach(photo => {
    addAllowed(photo.full);
    addAllowed(photo.src);
});

console.log(`✅ Found ${allowedFiles.size} valid files (including WebP twins).\n`);

// 3. Helper: Recursive File Scanner
function getFiles(dir) {
    let results = [];
    if (!fs.existsSync(dir)) return results;
    
    const list = fs.readdirSync(dir);
    list.forEach(file => {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);
        if (stat && stat.isDirectory()) {
            results = results.concat(getFiles(filePath));
        } else {
            if (file !== '.DS_Store' && file !== 'Thumbs.db') {
                results.push(filePath);
            }
        }
    });
    return results;
}

// 4. Scan and Compare
let orphansFound = 0;

FOLDERS_TO_SCAN.forEach(folder => {
    const scanPath = path.join(PUBLIC_DIR, folder);
    console.log(`🔍 Scanning directory: ${scanPath}...`);
    
    const filesOnDisk = getFiles(scanPath);
    
    filesOnDisk.forEach(fileOnDisk => {
        if (!allowedFiles.has(fileOnDisk)) {
            orphansFound++;
            console.log(`   ❌ ORPHAN: ${path.relative(PROJECT_ROOT, fileOnDisk)}`);
            
            if (!DRY_RUN) {
                try {
                    fs.unlinkSync(fileOnDisk);
                    console.log(`      💥 BAM! Deleted.`);
                } catch (err) {
                    console.error(`      ⚠️ COULD NOT DELETE: ${err.message}`);
                }
            }
        }
    });
});

// 5. Summary
console.log(`\n------------------------------------------------`);
if (orphansFound === 0) {
    console.log(`✨ Gotham is safe. No orphan files found.`);
} else {
    if (DRY_RUN) {
        console.log(`⚠️  Found ${orphansFound} orphan files.`);
        console.log(`👉 This was a DRY RUN. No files were deleted.`);
        console.log(`👉 To delete them, change 'const DRY_RUN = true' to 'false' in the script.`);
    } else {
        console.log(`🦇  Created ${orphansFound} orphans (deleted files).`);
    }
}
console.log(`------------------------------------------------`);