import fs from 'fs';
import path from 'path';
import { normalizeFileName, validateFileName } from './src/utils/filename.js';

interface Metadata {
  displayName: string;
  filename: string;
  tags: string[];
}

const SOUNDS_DIR = path.join(process.cwd(), 'sounds');
const METADATA_DIR = path.join(process.cwd(), 'metadata');

function loadOrCreateMetadata(metadataPath: string): Metadata {
  if (fs.existsSync(metadataPath)) {
    return JSON.parse(fs.readFileSync(metadataPath, 'utf-8')) as Metadata;
  }

  return {
    displayName: '',
    filename: '',
    tags: [],
  };
}

function createFilename(soundNameWithoutExt: string): string {
  const normalizedName = normalizeFileName(soundNameWithoutExt);
  const validatedFilename = validateFileName(normalizedName);
  return `${validatedFilename}.mp3`;
}

function createDisplayName(soundNameWithoutExt: string): string {
  let normalizedName = normalizeFileName(soundNameWithoutExt);
  normalizedName = normalizedName.replaceAll('_', ' ');
  return normalizedName;
}

function ensureTags(metadata: Metadata): string[] {
  return metadata.tags ?? [];
}

export function migrate(): void {
  const soundFiles = fs.readdirSync(SOUNDS_DIR).filter((file) => file.endsWith('.mp3'));

  for (const soundFile of soundFiles) {
    const soundNameWithoutExt = path.parse(soundFile).name;
    const metadataPath = path.join(METADATA_DIR, `${soundNameWithoutExt}.meta.json`);
    const metadata = loadOrCreateMetadata(metadataPath);

    metadata.filename = createFilename(soundNameWithoutExt);
    metadata.displayName = createDisplayName(soundNameWithoutExt);
    metadata.tags = ensureTags(metadata);

    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2) + '\n', 'utf-8');
    console.log(`Migrated: ${soundFile} -> ${metadataPath}`);
  }

  console.log(`\nMigration complete! Processed ${soundFiles.length} sound files.`);
}
