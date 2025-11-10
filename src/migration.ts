import fs from 'fs';
import path from 'path';
import { normalizeFileName, validateFileName } from './utils/filename.js';

interface Metadata {
  displayName: string;
  filename: string;
  tags: string[];
}

const SOUNDS_DIR = path.join(process.cwd(), 'sounds');
const METADATA_DIR = path.join(SOUNDS_DIR, 'metadata');

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

function createDisplayName(metadata: Metadata): string {
  let normalizedName = normalizeFileName(
    metadata.displayName.length > 0 ? metadata.displayName : metadata.filename
  );
  normalizedName = normalizedName.replaceAll('_', ' ');
  normalizedName = normalizedName.replaceAll('mp3', '');
  return normalizedName;
}

function ensureTags(metadata: Metadata): string[] {
  return metadata.tags ?? [];
}

export function migrate(): void {
  fs.mkdirSync(METADATA_DIR, { recursive: true });
  const soundFiles = fs.readdirSync(SOUNDS_DIR).filter((file) => file.endsWith('.mp3'));

  for (const soundFile of soundFiles) {
    const soundNameWithoutExt = path.parse(soundFile).name;
    const metadataPath = path.join(METADATA_DIR, `${soundNameWithoutExt}_meta.json`);
    const metadata = loadOrCreateMetadata(metadataPath);
    metadata.filename = createFilename(soundNameWithoutExt);
    metadata.displayName = createDisplayName(metadata);
    metadata.tags = ensureTags(metadata);

    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2) + '\n', 'utf-8');
    console.log(`Migrated: ${soundFile} -> ${metadataPath}`);
  }

  console.log(`\nMigration complete! Processed ${soundFiles.length} sound files.`);
}
