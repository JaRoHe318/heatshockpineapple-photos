import fs from 'fs';
import path from 'path';
import exifParser from 'exif-parser';
import sharp from 'sharp'; // <--- NEW IMPORT

// CONFIGURATION
const PROJECTS_DIR = './public/images/projects';
const THUMBS_DIR = './public/images/thumbs'; // <--- NEW STORAGE FOLDER
const OUTPUT_FILE = './src/data/photos.json';

function cleanModel(model) {
  if (!model) return 'Unknown Camera';
  return model.replace('Canon EOS ', '').replace(' Mark II', ' II');
}

function getFilesRecursively(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach(file => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat && stat.isDirectory()) {
      results = results.concat(getFilesRecursively(filePath));
    } else {
      const ext = path.extname(file).toLowerCase();
      if (ext === '.jpg' || ext === '.jpeg') {
        results.push(filePath);
      }
    }
  });
  return results;
}

console.log(`📷 Scanning ${PROJECTS_DIR}...`);

if (!fs.existsSync(PROJECTS_DIR)) {
  console.error(`Error: Directory ${PROJECTS_DIR} does not exist.`);
  process.exit(1);
}

// Ensure Thumbs Directory Exists
if (!fs.existsSync(THUMBS_DIR)) {
  fs.mkdirSync(THUMBS_DIR, { recursive: true });
}

const allFiles = getFilesRecursively(PROJECTS_DIR);
const photos = [];

// We use a for...of loop to handle async/await cleanly
for (const filePath of allFiles) {
  const buffer = fs.readFileSync(filePath);
  
  // --- 1. PATHING & HIERARCHY ---
  const relativePath = path.relative(PROJECTS_DIR, filePath);
  const pathParts = relativePath.split(path.sep);
  
  let category = pathParts[0]; 
  let album = null;
  
  if (pathParts.length > 1) {
    if (pathParts.length > 2) {
      album = pathParts[1];
    }
  }

  // --- 2. GENERATE THUMBNAIL (The Optimization) ---
  // Mirror the folder structure in /thumbs
  const thumbPath = path.join(THUMBS_DIR, relativePath);
  const thumbDir = path.dirname(thumbPath);
  
  if (!fs.existsSync(thumbDir)) {
    fs.mkdirSync(thumbDir, { recursive: true });
  }

  // Only create thumb if it doesn't exist (Speed up re-runs)
  if (!fs.existsSync(thumbPath)) {
    console.log(`⚡ Generating thumb: ${relativePath}`);
    await sharp(buffer)
      .resize({ width: 800, withoutEnlargement: true }) // Perfect size for grid columns
      .jpeg({ quality: 80 }) // Good compression
      .toFile(thumbPath);
  }

  // --- 3. EXIF & DATA ---
  let exifString = '';
  let width = 0;
  let height = 0;

  try {
    const parser = exifParser.create(buffer);
    const result = parser.parse();
    // We want the ORIGINAL dimensions for layout ratios
    if (result.imageSize) {
      width = result.imageSize.width;
      height = result.imageSize.height;
    }
    const { tags } = result;
    if (tags) {
      const camera = cleanModel(tags.Model);
      const focal = tags.FocalLength ? `${tags.FocalLength}mm` : '';
      const aperture = tags.FNumber ? `f/${tags.FNumber}` : '';
      const parts = [camera, focal, aperture].filter(p => p !== '');
      exifString = parts.join(' · ');
    }
  } catch (err) {}

  // --- 4. WEB PATHS ---
  // webPath = Thumbnail (Fast)
  const webPath = `/images/thumbs/${relativePath.split(path.sep).join('/')}`;
  // fullPath = Original (High Res)
  const fullPath = `/images/projects/${relativePath.split(path.sep).join('/')}`;

  photos.push({
    src: webPath,      // Used for Grid
    full: fullPath,    // Used for Lightbox (NEW)
    alt: category + ' photography',
    collection: category,
    album: album,
    exif: exifString,
    width: width,
    height: height
  });
}

const output = { photos };
fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
console.log(`✅ Processed ${photos.length} photos with thumbnails.`);