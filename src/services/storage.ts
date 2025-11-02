import { readdir, stat } from 'fs/promises';
import { join, extname, basename } from 'path';

const SOUNDS_DIR = 'sounds';
const ALLOWED_EXTENSIONS = ['.mp3', '.wav', '.ogg', '.m4a', '.flac', '.webm', '.opus'];

export interface SoundFile {
  name: string;
  displayName: string;
  path: string;
  size: number;
}

export async function listSoundFiles(): Promise<SoundFile[]> {
  try {
    const files = await readdir(SOUNDS_DIR);
    const soundFiles: SoundFile[] = [];

    for (const file of files) {
      const ext = extname(file).toLowerCase();
      
      if (!ALLOWED_EXTENSIONS.includes(ext)) {
        continue;
      }

      const filePath = join(SOUNDS_DIR, file);
      const stats = await stat(filePath);

      if (stats.isFile()) {
        const nameWithoutExt = basename(file, ext);
        soundFiles.push({
          name: nameWithoutExt,
          displayName: nameWithoutExt,
          path: filePath,
          size: stats.size,
        });
      }
    }

    return soundFiles.sort((a, b) => a.name.localeCompare(b.name));
  } catch (error) {
    console.error('Error listing sound files:', error);
    return [];
  }
}

export async function getSoundFile(name: string): Promise<SoundFile | null> {
  const files = await listSoundFiles();
  return files.find((file) => file.name.toLowerCase() === name.toLowerCase()) ?? null;
}

export function validateFileName(fileName: string): string {
  return fileName
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/_{2,}/g, '_')
    .toLowerCase();
}

export async function saveSoundFile(fileName: string, data: Buffer): Promise<string> {
  const { writeFile, access } = await import('fs/promises');
  const { constants } = await import('fs');
  
  try {
    await access(SOUNDS_DIR, constants.W_OK);
  } catch {
    throw new Error('Sounds directory is not writable');
  }

  const sanitizedName = validateFileName(fileName);
  
  if (!sanitizedName || sanitizedName.length === 0) {
    throw new Error('Invalid file name after sanitization');
  }

  const filePath = join(SOUNDS_DIR, sanitizedName);
  
  await writeFile(filePath, data);
  
  return filePath;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

