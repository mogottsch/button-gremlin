import { readdir, stat, mkdir } from 'fs/promises';
import { join, extname, basename } from 'path';
import { logger } from '../logger.js';
import { readFile, writeFile } from 'fs/promises';

const SOUNDS_DIR = 'sounds';
const METADATA_DIR = 'metadata';
const ALLOWED_EXTENSIONS = ['.mp3', '.wav', '.ogg', '.m4a', '.flac', '.webm', '.opus'];
const TAGS_FILE = 'tags.json';

export interface SoundMetadata {
  displayName: string;
  filename: string;
  tags: string[];
}

export interface SoundFile {
  name: string;
  displayName: string;
  path: string;
  size: number;
  uploadedAt: Date;
  tags: string[];
}

async function ensureMetadataDir(): Promise<void> {
  try {
    await mkdir(METADATA_DIR, { recursive: true });
  } catch {
    // Directory already exists
  }
}

async function readMetadata(name: string): Promise<SoundMetadata | null> {
  try {
    const metaPath = join(METADATA_DIR, `${name}.meta.json`);
    const content = await readFile(metaPath, 'utf-8');
    return JSON.parse(content) as SoundMetadata;
  } catch {
    return null;
  }
}

export async function writeMetadata(name: string, metadata: SoundMetadata): Promise<void> {
  await ensureMetadataDir();
  const metaPath = join(METADATA_DIR, `${name}.meta.json`);
  await writeFile(metaPath, JSON.stringify(metadata, null, 2), 'utf-8');
}

export async function getAllTags(): Promise<string[]> {
  try {
    const content = await readFile(TAGS_FILE, 'utf-8');
    return JSON.parse(content) as string[];
  } catch {
    return [];
  }
}

export async function updateTags(tags: string[]): Promise<void> {
  const uniqueTags = Array.from(new Set(tags)).sort();
  await writeFile(TAGS_FILE, JSON.stringify(uniqueTags, null, 2), 'utf-8');
}

export async function addTagsToGlobal(newTags: string[]): Promise<void> {
  const existingTags = await getAllTags();
  const allTags = Array.from(new Set([...existingTags, ...newTags])).sort();
  await updateTags(allTags);
}

export async function removeTagFromAll(tagToRemove: string): Promise<void> {
  // Remove from global tags
  const existingTags = await getAllTags();
  const updatedTags = existingTags.filter((tag) => tag !== tagToRemove);
  await updateTags(updatedTags);

  // Remove from all sounds
  const sounds = await listSoundFiles();
  for (const sound of sounds) {
    if (sound.tags?.includes(tagToRemove)) {
      const updatedSoundTags = sound.tags.filter((tag) => tag !== tagToRemove);
      const ext = sound.path.match(/\.[^.]+$/)?.[0] ?? '';
      await writeMetadata(sound.name, {
        displayName: sound.displayName,
        filename: sound.name + ext,
        tags: updatedSoundTags,
      });
    }
  }
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
        const metadata = await readMetadata(nameWithoutExt);

        soundFiles.push({
          name: nameWithoutExt,
          displayName: metadata?.displayName ?? nameWithoutExt,
          path: filePath,
          size: stats.size,
          uploadedAt: stats.birthtime,
          tags: metadata?.tags ?? [],
        });
      }
    }

    return soundFiles.sort((a, b) => a.name.localeCompare(b.name));
  } catch (error) {
    logger.error({ err: error }, 'Error listing sound files');
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
  const { access, writeFile: writeFileFS } = await import('fs/promises');
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

  await writeFileFS(filePath, data);

  return filePath;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
