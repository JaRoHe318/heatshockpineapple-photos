interface Photo { full: string; src: string; alt: string; width: number; height: number; exif?: string; caption?: string; }
/** Populate the same card template used for the server-rendered stream. */
export function fillPhotoCard(root: DocumentFragment, photo: Photo) {
  const link = root.querySelector('a')!;
  link.href = photo.full;
  link.dataset.pswpWidth = String(photo.width);
  link.dataset.pswpHeight = String(photo.height);
  link.setAttribute('aria-label', `View full size: ${photo.alt}`);
  root.querySelector('source')!.srcset = photo.src.replace(/\.jpe?g$/i, '.webp');
  const img = root.querySelector('img')!;
  img.src = photo.src; img.alt = photo.alt;
  img.width = photo.width; img.height = photo.height;
  img.style.aspectRatio = `${photo.width} / ${photo.height}`;
  const overlay = root.querySelector('.card-overlay')!;
  const caption = root.querySelector('.hidden-caption')!;
  overlay.replaceChildren(caption);
  if (photo.exif) {
    const span = document.createElement('span');
    span.className = 'overlay-exif'; span.textContent = photo.exif; overlay.append(span);
  }
  caption.replaceChildren();
  for (const [tag, className, text] of [['p', 'lightbox-caption-body', photo.caption], ['small', 'lightbox-caption-text', photo.exif]]) {
    if (!text) continue;
    const node = document.createElement(tag!); node.className = className!; node.textContent = text; caption.append(node);
  }
}
