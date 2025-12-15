/* scripts/generate-photos.mjs */
import fs from 'fs-extra';
import path from 'path';
import sharp from 'sharp';
import { glob } from 'glob';
import exifParser from 'exif-parser';

// CONFIGURATION
const PROJECTS_DIR = 'originals'; // Private source folder
const THUMBS_DIR = 'public/images/thumbs';
const FULL_DIR = 'public/images/full';
const DATA_FILE = 'src/data/photos.json';

// SETTINGS
const THUMB_WIDTH = 800;
const THUMB_QUALITY = 80;
const FULL_WIDTH = 2400;
const FULL_QUALITY = 90;

function cleanModel(model) {
  if (!model) return 'Unknown Camera';
  return model.replace('Canon EOS ', '').replace(' Mark II', ' II');
}

async function generate() {
  // Guard: Ensure source exists
  if (!(await fs.pathExists(PROJECTS_DIR))) {
    console.error(`❌ Source directory "${PROJECTS_DIR}" not found.`);
    process.exit(1);
  }

  console.log(`📷 Scanning photo library in ${PROJECTS_DIR}...`);

  await fs.ensureDir(THUMBS_DIR);
  await fs.ensureDir(FULL_DIR);

  const stats = {
    total: 0,
    generatedThumbs: 0,
    generatedFulls: 0,
    skipped: 0,
    failed: 0,
  };

  const seen = new Set();
  const images = await glob(`${PROJECTS_DIR}/**/*.{jpg,jpeg,png,webp,JPG,JPEG,PNG,WEBP}`);
  const photos = [];

for (const filePath of images) {
    const relativePath = path.relative(PROJECTS_DIR, filePath);
    const relKey = relativePath.split(path.sep).join('/');

    if (seen.has(relKey)) continue;
    seen.add(relKey);

    const pathParts = relKey.split('/');
    
    // === NEW LOGIC START ===
    let category = 'uncategorized'; // Label root photos as this
    let album = null;

    if (pathParts.length >= 2) {
      category = pathParts[0];
      album = pathParts.length > 2 ? pathParts.slice(1, -1).join('/') : null;
    }
    // === NEW LOGIC END ===

    const id = relKey.replace(/\.[^/.]+$/, '').split('/').join('__');

    // WEB PATHS
    const outBase = relKey.replace(/\.(jpe?g|png|webp)$/i, '');
    // This will put root photos directly in /images/thumbs/photo.jpg
    const webThumbPath = `/images/thumbs/${outBase}.jpg`;
    const webFullPath = `/images/full/${outBase}.jpg`;

    // FILE SYSTEM PATHS
    const outRelFs = outBase.split('/').join(path.sep);
    const destThumbBase = path.join(THUMBS_DIR, outRelFs);
    const destFullBase = path.join(FULL_DIR, outRelFs);

    await fs.ensureDir(path.dirname(destThumbBase));
    await fs.ensureDir(path.dirname(destFullBase));

    try {
      const buffer = await fs.readFile(filePath);
      let finalWidth = 0;
      let finalHeight = 0;

      // === GENERATE FORMATS ===
      const formats = ['jpg', 'webp'];

      for (const format of formats) {
        const ext = `.${format}`;
        const thumbPath = `${destThumbBase}${ext}`;
        const fullPath = `${destFullBase}${ext}`;
        const isWebP = format === 'webp';
        
        // 1. Generate FULL
        let processFull = true;
        if (await fs.pathExists(fullPath)) processFull = false;

        if (processFull) {
          const pipeline = sharp(buffer).rotate().resize({ width: FULL_WIDTH, withoutEnlargement: true });
          if (isWebP) {
             await pipeline.webp({ quality: FULL_QUALITY }).toFile(fullPath);
          } else {
             const info = await pipeline.jpeg({ quality: FULL_QUALITY, mozjpeg: true }).toFile(fullPath);
             finalWidth = info.width;
             finalHeight = info.height;
             stats.generatedFulls++;
          }
        } else if (!isWebP) {
           const meta = await sharp(fullPath).metadata();
           finalWidth = meta.width;
           finalHeight = meta.height;
        }

        // 2. Generate THUMB
        if (!(await fs.pathExists(thumbPath))) {
          const pipeline = sharp(buffer).rotate().resize({ width: THUMB_WIDTH, withoutEnlargement: true });
          if (isWebP) {
            await pipeline.webp({ quality: THUMB_QUALITY }).toFile(thumbPath);
          } else {
            await pipeline.jpeg({ quality: THUMB_QUALITY, mozjpeg: true }).toFile(thumbPath);
          }
          stats.generatedThumbs++;
        }
      }

      // === EXIF ===
      let exifString = '';
      try {
        const parser = exifParser.create(buffer);
        const result = parser.parse();
        if (result.tags) {
          const camera = cleanModel(result.tags.Model);
          const focal = result.tags.FocalLength ? `${result.tags.FocalLength}mm` : '';
          let aperture = '';
          if (result.tags.FNumber) aperture = `f/${Number(result.tags.FNumber).toFixed(1).replace(/\.0$/, '')}`;
          exifString = [camera, focal, aperture].filter(Boolean).join(' · ');
        }
      } catch {}

      // === SMART ALT TEXT ===
      const filenameBase = path.basename(filePath, path.extname(filePath));
      const isGeneric = /^(IMG|DSC|_DSC|P\d+|[\d\-_]+$)/i.test(filenameBase);
      const altParts = [];
      
      if (!isGeneric) altParts.push(filenameBase.replace(/[-_]/g, ' '));
      if (album) altParts.push(album === 'SF' ? 'San Francisco' : album);
      if (category) altParts.push(category); // "Stream" will appear in alt text for root photos
      altParts.push('photograph');
      const altText = altParts.join(' ');

      photos.push({
        id,
        src: webThumbPath,
        full: webFullPath,
        alt: altText,
        collection: category, // This will categorize them as "stream"
        category,
        album,
        exif: exifString,
        width: finalWidth,
        height: finalHeight,
      });

      stats.total++;
    } catch (err) {
      console.error(`⚠️  Skipping: ${relativePath}`, err?.message ?? err);
      stats.failed++;
    }
  }

  photos.sort((a, b) => a.id.localeCompare(b.id));
  await fs.outputJson(DATA_FILE, { photos }, { spaces: 2 });

  console.log(`
✅ Build Complete
-----------------------------------
Source:         ${PROJECTS_DIR}
Total Photos:   ${stats.total}
Thumbs Gen:     ${stats.generatedThumbs} (JPG+WebP)
Fulls Gen:      ${stats.generatedFulls} (JPG+WebP)
Failed:         ${stats.failed}
-----------------------------------
`);
}

generate().catch(console.error);