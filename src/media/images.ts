export function isImage(path: string) {
  return /\.(?:png|jpe?g|gif|webp|avif|bmp|ico)$/i.test(path);
}
