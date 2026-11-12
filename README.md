

## Shared site framework

The header, footer, brand asset, local navigation, and theme behavior come from `@heatshockpineapple/astro-ui`. The package source lives in `pineapple-design-tokens/packages/astro-ui`; site wrappers contain only configuration and optional local decoration. Content styles and interactive features remain in this repository.

Use Node.js 22.23.5 (`.nvmrc`), then `npm ci` and `npm run build`. The package is installed from the versioned artifact checked into `vendor/`, so no sibling checkout or registry publication is needed to build this site. When updating the UI, copy the new release artifact into `vendor/`, install that file, and commit it together with `package.json` and `package-lock.json`. Test all three consumers before release.

The header contains only this site's local navigation. The root-domain logo returns to the hub, whose cards link to Portfolio, Photography, and Writing on Substack. The Writing URL is configured once in the shared package and currently points to the verified Substack profile. The Astro blog remains preserved separately and is no longer linked from these sites.

## Local Photography Manager

Double-click **Photo Manager.command** in this repository, or run `npm run manager` with Node.js 22. The launcher uses an installed Node runtime or the portable runtime already used on this Mac. Keep its Terminal window open while using the manager; press Control+C there to stop it. If macOS asks which app should open `.command` files, select Terminal. If the manager is already running for this folder, launching it again reopens that same manager in your browser without starting another server. The second launcher then exits normally; Terminal may show “Process completed.” Only the original server window needs to stay open.

The manager opens at http://127.0.0.1:8787 and immediately displays the existing website library. Search or filter photos, select one to preview it, and edit its image description, caption, collection, album, or homepage placement. Use **Save photo** (or **Save import**) in the editor to save only the current photo and its homepage placement. The top **Save all changes** button saves every pending edit and import. **Add photos** accepts exported JPEG/PNG/WebP files, by selection or drag-and-drop, up to 20 files / 100 MB per save. Originals remain private in `originals/<collection>/<album>/` (omit the album level when unused). Optimized JPEG and WebP copies mirror those folders under `public/images/thumbs/` and `public/images/full/`. Original filenames stay recognizable; duplicate filenames receive a suffix such as `-2`. Homepage placement can be chosen before the first import save.

**Preview website** builds the saved website and provides a separate local preview link. Publishing stays in GitHub Desktop: review and commit the generated images, `src/data/photos.json`, `src/data/photo-settings.json`, and `src/data/photo-path-aliases.json`, then push when ready. The manager does not commit, push, deploy, or expose an admin page on the public website.

Authored descriptions, captions, and collection assignments are stored in `src/data/photo-settings.json`, alongside the ordered Selected Works and featured-photo rotation. Source fingerprints and save-recovery backups stay in the ignored `.photo-manager/` folder. Treat that folder and `originals/` as local source data to back up separately; Git does not back them up. Saving collection or album changes moves the original and all four optimized images into matching folders. The photo details panel shows the current file locations. Existing image addresses and IDs are preserved. New imported images use stable IDs independent of their original filenames.

The folder-based workflow still works with `npm run photos`. It detects changed source contents, preserves authored fields, retains entries when a source is missing, and stops without replacing the catalog on image errors. The first folder sync fingerprints and regenerates existing sources once; later runs process changed or missing derivatives. Neither workflow deletes existing photographs. A failed or interrupted multi-file save is journaled and recovered on the next manager/import start. Recovery backups are retained locally.

Run `npm test`, `npm run astro -- check`, and `npm run build` to validate changes. Manager HTTP tests bind only to loopback.

Folder organization is synchronized by the manager and `npm run photos`. Loose photos live in `uncategorized/`. Old image URL mappings are recorded in `src/data/photo-path-aliases.json`; the build creates compatibility copies only in `dist/`, so previously shared image links keep working without duplicate files in the source folders. Keep these mappings in Git. Reorganizing again is safe and preserves IDs, captions, homepage selections, and image bytes. Avoid moving source files manually; use the manager to keep the originals and generated files aligned.
