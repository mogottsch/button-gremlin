import { useEffect, useState, useCallback } from 'react';
import type { Sound } from '@backend/web/schemas/index.js';
import { api } from '../services/api';
import { SoundCard } from './SoundCard';
import { UploadForm } from './UploadForm';
import { Input } from './ui/input';
import { Button } from './ui/button';
import { Search, Upload, Loader2, Music } from 'lucide-react';
import { toast } from 'sonner';

interface SoundListProps {
  onPlaySound: (sound: Sound) => void;
}

const ALLOWED_TYPES = [
  'audio/mpeg',
  'audio/wav',
  'audio/ogg',
  'audio/mp4',
  'audio/flac',
  'audio/webm',
  'audio/opus',
];
const ALLOWED_EXTENSIONS = ['.mp3', '.wav', '.ogg', '.m4a', '.flac', '.webm', '.opus'];
const MAX_SIZE = 10 * 1024 * 1024;

export function SoundList({ onPlaySound }: SoundListProps) {
  const [sounds, setSounds] = useState<Sound[]>([]);
  const [filteredSounds, setFilteredSounds] = useState<Sound[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [showUpload, setShowUpload] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const validateFile = useCallback((file: File): string | null => {
    const ext = file.name.toLowerCase().match(/\.[^.]+$/)?.[0];

    if (!ALLOWED_TYPES.includes(file.type) && !(ext && ALLOWED_EXTENSIONS.includes(ext))) {
      return 'Invalid file type. Allowed: mp3, wav, ogg, m4a, flac, webm, opus';
    }

    if (file.size > MAX_SIZE) {
      return 'File too large. Maximum size is 10MB';
    }

    return null;
  }, []);

  const loadSounds = async () => {
    try {
      setLoading(true);
      const data = await api.sounds.list();
      setSounds(data);
      setFilteredSounds(data);
    } catch (error) {
      console.error('Failed to load sounds:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadSounds();
  }, []);

  useEffect(() => {
    const query = searchQuery.toLowerCase();
    const filtered = sounds.filter((sound) => sound.displayName.toLowerCase().includes(query));
    setFilteredSounds(filtered);
  }, [searchQuery, sounds]);

  const handleUploadSuccess = () => {
    setShowUpload(false);
    void loadSounds();
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile) {
      const error = validateFile(droppedFile);
      if (error) {
        toast.error(error);
        return;
      }
      try {
        await api.sounds.upload(droppedFile);
        toast.success('Sound uploaded successfully');
        void loadSounds();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Upload failed');
      }
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search sounds..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
        <div
          className={`flex items-center gap-2 rounded-md border-2 border-dashed px-4 py-3 transition-all cursor-pointer ${
            isDragging
              ? 'border-primary bg-primary/5'
              : 'border-border hover:border-primary/50 hover:bg-accent/5'
          }`}
          onClick={() => setShowUpload(true)}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <Upload className="h-4 w-4" />
          <span className="text-sm font-medium">Upload</span>
        </div>
      </div>

      {filteredSounds.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center">
          <Music className="mb-4 h-12 w-12 text-muted-foreground/50" />
          <p className="text-lg font-medium">{searchQuery ? 'No sounds found' : 'No sounds yet'}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {searchQuery ? 'Try a different search' : 'Upload your first sound to get started'}
          </p>
          {!searchQuery && (
            <Button onClick={() => setShowUpload(true)} className="mt-4">
              <Upload />
              Upload Sound
            </Button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredSounds.map((sound) => (
            <SoundCard key={sound.name} sound={sound} onPlay={onPlaySound} onDelete={loadSounds} />
          ))}
        </div>
      )}

      <UploadForm open={showUpload} onOpenChange={setShowUpload} onSuccess={handleUploadSuccess} />
    </div>
  );
}
