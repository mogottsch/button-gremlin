import { createReadStream } from 'fs';
import { unlink } from 'fs/promises';
import { listSoundFiles, getSoundFile } from '../../services/storage.js';
import type { SoundFile } from '../../services/storage.js';

export async function getAllSounds(): Promise<
  Array<{ name: string; displayName: string; size: number; uploadedAt: string }>
> {
  const sounds = await listSoundFiles();
  return sounds.map((sound) => ({
    name: sound.name,
    displayName: sound.displayName,
    size: sound.size,
    uploadedAt: sound.uploadedAt.toISOString(),
  }));
}

export async function getSound(name: string): Promise<SoundFile | null> {
  return await getSoundFile(name);
}

export function createSoundStream(sound: SoundFile): ReturnType<typeof createReadStream> {
  return createReadStream(sound.path);
}

export async function saveUploadedSound(filename: string): Promise<SoundFile | null> {
  return await getSoundFile(filename);
}

export async function deleteSound(name: string): Promise<void> {
  const sound = await getSoundFile(name);
  if (!sound) {
    throw new Error('Sound not found');
  }
  await unlink(sound.path);
}
