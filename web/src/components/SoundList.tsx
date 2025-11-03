import { useEffect, useState, useCallback } from 'react';
import type { Sound } from '@backend/web/schemas/index.js';
import { api } from '../services/api';
import { SoundCard } from './SoundCard';
import { UploadForm } from './UploadForm';
import { Input } from './ui/input';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Label } from './ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { Search, Upload, Loader2, Music, Plus, Pencil, X } from 'lucide-react';
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
  const [allTags, setAllTags] = useState<string[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [showNewTagDialog, setShowNewTagDialog] = useState(false);
  const [newTagName, setNewTagName] = useState('');
  const [deleteMode, setDeleteMode] = useState(false);

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

  const loadTags = async () => {
    try {
      const tags = await api.sounds.getTags();
      setAllTags(tags);
    } catch (error) {
      console.error('Failed to load tags:', error);
    }
  };

  useEffect(() => {
    void loadSounds();
    void loadTags();
  }, []);

  useEffect(() => {
    const query = searchQuery.toLowerCase();
    const filtered = sounds.filter((sound) => {
      const matchesSearch = sound.displayName.toLowerCase().includes(query);
      const matchesTags =
        selectedTags.length === 0 || selectedTags.some((tag) => sound.tags?.includes(tag));
      return matchesSearch && matchesTags;
    });
    setFilteredSounds(filtered);
  }, [searchQuery, sounds, selectedTags]);

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

  const handleCreateTag = async () => {
    const trimmedTag = newTagName.trim().toLowerCase();
    if (!trimmedTag) {
      toast.error('Tag name cannot be empty');
      return;
    }
    if (allTags.includes(trimmedTag)) {
      toast.error('Tag already exists');
      return;
    }
    try {
      await api.sounds.createTag(trimmedTag);
      toast.success(`Tag "${trimmedTag}" created`);
      setShowNewTagDialog(false);
      setNewTagName('');
      void loadTags();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to create tag');
    }
  };

  const handleDeleteTag = async (tag: string) => {
    try {
      await api.sounds.deleteTag(tag);
      toast.success(`Tag "${tag}" deleted and removed from all sounds`);
      void loadTags();
      void loadSounds();
      setSelectedTags((prev) => prev.filter((t) => t !== tag));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to delete tag');
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
            className="pl-10 h-[48px]"
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
          <span className="text-sm font-medium">Drag or Click to Upload</span>
        </div>
      </div>

      {allTags.length > 0 ? (
        <div className="space-y-2">
          <div className="flex gap-2 items-center">
            <div className="flex flex-wrap gap-2 items-center flex-1">
              <span className="text-sm font-medium text-muted-foreground">
                Filter by tags (drag to sound to add):
              </span>
              {allTags.map((tag) => (
                <Badge
                  key={tag}
                  variant={selectedTags.includes(tag) ? 'default' : 'outline'}
                  className={`cursor-pointer transition-colors text-sm px-3 py-1.5 ${
                    deleteMode
                      ? 'hover:bg-destructive hover:text-destructive-foreground'
                      : 'hover:bg-primary/80'
                  }`}
                  draggable={!deleteMode}
                  onDragStart={(e) => {
                    if (!deleteMode) {
                      e.dataTransfer.setData('tag', tag);
                      e.dataTransfer.effectAllowed = 'copy';
                    }
                  }}
                  onClick={() => {
                    if (deleteMode) {
                      void handleDeleteTag(tag);
                    } else {
                      setSelectedTags((prev) =>
                        prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
                      );
                    }
                  }}
                >
                  {tag}
                  {deleteMode && <X className="h-3 w-3 ml-1" />}
                </Badge>
              ))}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowNewTagDialog(true)}
                className="h-8 px-3 border-dashed hover:border-primary hover:bg-primary/5"
              >
                <Plus className="h-4 w-4 mr-1" />
                New Tag
              </Button>
              {selectedTags.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelectedTags([])}
                  className="h-6 text-xs"
                >
                  Clear filters
                </Button>
              )}
            </div>
            <Button
              variant={deleteMode ? 'destructive' : 'outline'}
              size="sm"
              onClick={() => setDeleteMode(!deleteMode)}
              className={`h-8 px-2 ml-auto cursor-pointer ${
                deleteMode
                  ? 'bg-red-600 hover:bg-red-700'
                  : 'hover:bg-primary hover:text-primary-foreground transition-colors'
              }`}
              title={deleteMode ? 'Exit delete mode' : 'Enter delete mode'}
            >
              <Pencil className="h-4 w-4" />
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-muted-foreground">No tags yet.</span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowNewTagDialog(true)}
            className="h-8 px-3 border-dashed hover:border-primary hover:bg-primary/5"
          >
            <Plus className="h-4 w-4 mr-1" />
            Create First Tag
          </Button>
        </div>
      )}

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
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 items-start">
          {filteredSounds.map((sound) => (
            <SoundCard key={sound.name} sound={sound} onPlay={onPlaySound} onDelete={loadSounds} />
          ))}
        </div>
      )}

      <UploadForm open={showUpload} onOpenChange={setShowUpload} onSuccess={handleUploadSuccess} />

      <Dialog open={showNewTagDialog} onOpenChange={setShowNewTagDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New Tag</DialogTitle>
            <DialogDescription>
              Enter a name for the new tag. You can then drag it to sounds or use it as a filter.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="new-tag-input">Tag name</Label>
              <Input
                id="new-tag-input"
                placeholder="Enter tag name..."
                value={newTagName}
                onChange={(e) => setNewTagName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void handleCreateTag();
                  }
                }}
                className="mt-2"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNewTagDialog(false)}>
              Cancel
            </Button>
            <Button onClick={() => void handleCreateTag()}>Create Tag</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
