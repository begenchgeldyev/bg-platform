// Responsive derivatives of the supplied artwork. Arbitrary uploads keep their original URL.
const COVER_WIDTHS = [400, 800, 1200, 1448] as const;

const COVER_BASES: Record<string, string> = {
  '/public/projects/pantheon-pixel.png': '/public/projects/pantheon-pixel',
  '/public/projects/bg-platform-pixel.png': '/public/projects/bg-platform-pixel',
  '/public/projects/interpreter-pixel.png': '/public/projects/interpreter-pixel',
};

export type ProjectArt = {
  image: string;
  width: number;
  height: number;
  avif?: string;
  webp?: string;
};

function srcset(base: string, format: 'avif' | 'webp') {
  return COVER_WIDTHS.map((width) => `${base}-${width}.${format} ${width}w`).join(', ');
}

export function projectArt(value: string | null): ProjectArt | null {
  const image = value?.trim();
  if (!image || !/^(?:\/(?!\/)|https?:\/\/|data:image\/(?:png|jpe?g|webp|gif);base64,)/i.test(image)) return null;
  const base = Object.hasOwn(COVER_BASES, image) ? COVER_BASES[image] : undefined;
  if (!base) return { image, width: 4, height: 3 };
  return {
    image,
    width: 1448,
    height: 1086,
    avif: srcset(base, 'avif'),
    webp: srcset(base, 'webp'),
  };
}
