// Explicit derivatives of the supplied artwork. Arbitrary uploads keep their original URL.
const COVER_ART: Record<string, string> = {
  '/public/projects/pantheon-pixel.png': '/public/projects/pantheon-pixel.webp',
  '/public/projects/bg-platform-pixel.png': '/public/projects/bg-platform-pixel.webp',
  '/public/projects/interpreter-pixel.png': '/public/projects/interpreter-pixel.webp',
};

export function projectArt(value: string | null) {
  const image = value?.trim();
  if (!image || !/^(?:\/(?!\/)|https?:\/\/|data:image\/(?:png|jpe?g|webp|gif);base64,)/i.test(image)) return null;
  const webp = Object.hasOwn(COVER_ART, image) ? COVER_ART[image] : undefined;
  return { image, webp, width: webp ? 1448 : 4, height: webp ? 1086 : 3 };
}
