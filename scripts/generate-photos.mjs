import fs from 'fs-extra';
import path from 'path';
import sharp from 'sharp';
import { glob } from 'glob';
import exifParser from 'exif-parser';

// CONFIGURATION
const PROJECTS_DIR = 'originals'; // Private source folder (NOT deployed)
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
    console.error(`   Please move your photo folders into a root "${PROJECTS_DIR}" folder.`);
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

  const images = await glob(
    `${PROJECTS_DIR}/**/*.{jpg,jpeg,png,webp,JPG,JPEG,PNG,WEBP}`
  );

  const photos = [];

  for (const filePath of images) {
    const relativePath = path.relative(PROJECTS_DIR, filePath);

    // Cross-platform normalized key
    const relKey = relativePath.split(path.sep).join('/');

    // Dedup
    if (seen.has(relKey)) continue;
    seen.add(relKey);

    const pathParts = relKey.split('/');

    // Guard: require category folder
    if (pathParts.length < 2) {
      console.warn(`⚠️  Skipping file in root (needs a category folder): ${relativePath}`);
      stats.failed++;
      continue;
    }

    const category = pathParts[0];
    const album = pathParts.length > 2 ? pathParts.slice(1, -1).join('/') : null;

    // Collision-proof id
    const id = relKey.replace(/\.[^/.]+$/, '').split('/').join('__');

    // Output paths (force .jpg)
    const outRelKey = relKey.replace(/\.(jpe?g|png|webp)$/i, '.jpg');
    const outRelFs = outRelKey.split('/').join(path.sep);

    const destThumbPath = path.join(THUMBS_DIR, outRelFs);
    const destFullPath = path.join(FULL_DIR, outRelFs);

    // Web paths (always forward slashes)
    const webThumbPath = `/images/thumbs/${outRelKey}`;
    const webFullPath = `/images/full/${outRelKey}`;

    await fs.ensureDir(path.dirname(destThumbPath));
    await fs.ensureDir(path.dirname(destFullPath));

    try {
      const srcStat = await fs.stat(filePath);

      // Cache checks
      let genThumb = true;
      let genFull = true;

      if (await fs.pathExists(destThumbPath)) {
        const destStat = await fs.stat(destThumbPath);
        if (destStat.mtimeMs >= srcStat.mtimeMs) genThumb = false;
      }

      if (await fs.pathExists(destFullPath)) {
        const destStat = await fs.stat(destFullPath);
        if (destStat.mtimeMs >= srcStat.mtimeMs) genFull = false;
      }

      // Read source once (needed for EXIF + potential generation)
      const buffer = await fs.readFile(filePath);

      // Dimension truth source: the /full file on disk
      let finalWidth = 0;
      let finalHeight = 0;

      // A) Full export (metadata stripped)
      if (genFull) {
        const info = await sharp(buffer)
          .rotate()
          .resize({ width: FULL_WIDTH, withoutEnlargement: true })
          .jpeg({ quality: FULL_QUALITY, mozjpeg: true })
          .toFile(destFullPath);

        if (!info.width || !info.height) {
          throw new Error(`Generated full missing dimensions: ${destFullPath}`);
        }

        finalWidth = info.width;
        finalHeight = info.height;
        stats.generatedFulls++;
      } else {
        const meta = await sharp(destFullPath).metadata();

        if (!meta.width || !meta.height) {
          throw new Error(`Cached full missing dimensions: ${destFullPath}`);
        }

        finalWidth = meta.width;
        finalHeight = meta.height;
      }

      // B) Thumb export
      if (genThumb) {
        await sharp(buffer)
          .rotate()
          .resize({ width: THUMB_WIDTH, withoutEnlargement: true })
          .jpeg({ quality: THUMB_QUALITY, mozjpeg: true })
          .toFile(destThumbPath);

        stats.generatedThumbs++;
      }

      if (!genThumb && !genFull) stats.skipped++;

      // C) EXIF display string (from ORIGINAL buffer; not published)
      let exifString = '';
      try {
        const parser = exifParser.create(buffer);
        const result = parser.parse();
        if (result.tags) {
          const camera = cleanModel(result.tags.Model);
          const focal = result.tags.FocalLength ? `${result.tags.FocalLength}mm` : '';

          let aperture = '';
          if (result.tags.FNumber) {
            aperture = `f/${Number(result.tags.FNumber).toFixed(1).replace(/\.0$/, '')}`;
          }

          const parts = [camera, focal, aperture].filter(Boolean);
          exifString = parts.join(' · ');
        }
      } catch {
        // ignore EXIF errors
      }

      // === UPDATED LOGIC START ===
      // Removed filename parsing. Just use generic Alt Text.
      const altText = `${category} Photograph`;
      // === UPDATED LOGIC END ===

      photos.push({
        id,
        src: webThumbPath,
        full: webFullPath,
        alt: altText,
        collection: category, // compatibility
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
      continue;
    }
  }

  photos.sort((a, b) => a.id.localeCompare(b.id));
  await fs.outputJson(DATA_FILE, { photos }, { spaces: 2 });

  console.log(`
✅ Build Complete
-----------------------------------
Source:         ${PROJECTS_DIR}
Total Photos:   ${stats.total}
Thumbs Gen:     ${stats.generatedThumbs}
Fulls Gen:      ${stats.generatedFulls}
Cached:         ${stats.skipped}
Failed:         ${stats.failed}
-----------------------------------
`);
}

generate().catch(console.error);