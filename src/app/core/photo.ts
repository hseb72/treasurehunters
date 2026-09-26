/**
 * Photo prise par le téléphone → « data URL » JPEG réduite (1600 px au plus), pour
 * un envoi rapide sur le terrain et une image lisible par l'arbitre IA.
 */
const MAX_SIDE = 1600;
const QUALITY = 0.82;

export async function compressPhoto(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('Choisissez une photo.');
  // imageOrientation : applique l'orientation EXIF (photos prises en portrait).
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => {
    throw new Error('Cette photo ne peut pas être lue. Essayez en JPEG.');
  });
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL('image/jpeg', QUALITY);
}
