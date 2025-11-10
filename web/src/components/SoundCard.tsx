import { useState } from 'react';
import type { Sound } from '@backend/web/schemas/index.js';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Input } from './ui/input';
import { Label } from './ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { Play, Trash2, ChevronDown, ChevronUp, Plus, X } from 'lucide-react';
import { api } from '../services/api';
import { toast } from 'sonner';
import DiscordIcon from '/discordIcon.svg';

interface SoundCardProps {
  sound: Sound;
  onPlay: (sound: Sound) => void;
  onDelete: () => void;
}

export function SoundCard({ sound, onPlay, onDelete }: SoundCardProps) {
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showTagsDialog, setShowTagsDialog] = useState(false);
  const [isPlayingDiscord, setIsPlayingDiscord] = useState(false);
  const [isDetailsExpanded, setIsDetailsExpanded] = useState(false);
  const [editedTags, setEditedTags] = useState<string[]>([]);
  const [newTagInput, setNewTagInput] = useState('');
  const [isDragOver, setIsDragOver] = useState(false);
  const [isEditingName, setIsEditingName] = useState(false);
  const [editedDisplayName, setEditedDisplayName] = useState(sound.displayName);

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString();
  };

  const handlePlayInDiscord = async () => {
    setIsPlayingDiscord(true);
    try {
      const result = await api.bot.play(sound.name);
      toast.success(result.message);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to play sound');
    } finally {
      setIsPlayingDiscord(false);
    }
  };

  const handleDelete = async () => {
    try {
      await api.sounds.delete(sound.name);
      toast.success('Sound deleted');
      onDelete();
      setShowDeleteDialog(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to delete sound');
    }
  };

  const handleOpenTagsDialog = () => {
    setEditedTags([...(sound.tags || [])]);
    setNewTagInput('');
    setShowTagsDialog(true);
  };

  const handleAddTag = () => {
    const trimmedTag = newTagInput.trim().toLowerCase();
    if (trimmedTag && !editedTags.includes(trimmedTag)) {
      setEditedTags([...editedTags, trimmedTag]);
      setNewTagInput('');
    }
  };

  const handleRemoveTag = (tagToRemove: string) => {
    setEditedTags(editedTags.filter((tag) => tag !== tagToRemove));
  };

  const handleRemoveTagDirect = async (tagToRemove: string) => {
    try {
      const newTags = sound.tags?.filter((tag) => tag !== tagToRemove) || [];
      await api.sounds.updateMetadata(sound.name, { tags: newTags });
      toast.success(`Tag "${tagToRemove}" removed`);
      onDelete(); // Refresh the list
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to remove tag');
    }
  };

  const handleSaveTags = async () => {
    try {
      await api.sounds.updateMetadata(sound.name, { tags: editedTags });
      toast.success('Tags updated');
      setShowTagsDialog(false);
      onDelete(); // Refresh the list
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to update tags');
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);

    const tag = e.dataTransfer.getData('tag');
    if (tag && !sound.tags?.includes(tag)) {
      try {
        const newTags = [...(sound.tags || []), tag];
        await api.sounds.updateMetadata(sound.name, { tags: newTags });
        toast.success(`Tag "${tag}" added`);
        onDelete(); // Refresh the list
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Failed to add tag');
      }
    }
  };

  const handleDoubleClickName = () => {
    setIsEditingName(true);
    setEditedDisplayName(sound.displayName);
  };

  const handleSaveDisplayName = async () => {
    const trimmedName = editedDisplayName.trim();
    if (!trimmedName) {
      toast.error('Display name cannot be empty');
      return;
    }

    if (trimmedName === sound.displayName) {
      setIsEditingName(false);
      return;
    }

    try {
      await api.sounds.updateMetadata(sound.name, { displayName: trimmedName });
      toast.success('Display name updated');
      setIsEditingName(false);
      onDelete(); // Refresh the list
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to update display name');
    }
  };

  const handleCancelEditName = () => {
    setIsEditingName(false);
    setEditedDisplayName(sound.displayName);
  };

  const handleKeyDownName = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleSaveDisplayName();
    } else if (e.key === 'Escape') {
      handleCancelEditName();
    }
  };

  return (
    <>
      <Card
        className={`group transition-all hover:border-primary/50 hover:shadow-lg hover:shadow-primary/10 h-fit relative max-w-[240px] ${
          isDragOver ? 'border-primary border-2 bg-primary/5' : ''
        }`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <CardHeader className="pb-3 px-4 pt-4">
          <CardTitle className="flex items-center gap-2 text-base justify-center h-12">
            {isEditingName ? (
              <Input
                value={editedDisplayName}
                onChange={(e) => setEditedDisplayName(e.target.value)}
                onBlur={handleSaveDisplayName}
                onKeyDown={handleKeyDownName}
                className="text-center h-8 text-base"
                autoFocus
              />
            ) : (
              <span
                className="text-center leading-tight line-clamp-2 cursor-pointer hover:text-primary/80 transition-colors"
                title={`${sound.displayName} (double-click to edit)`}
                onDoubleClick={handleDoubleClickName}
              >
                {sound.displayName}
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 pb-0 px-4">
          <div className="flex gap-2 justify-center">
            <Button
              size="icon"
              onClick={() => onPlay(sound)}
              className="cursor-pointer bg-green-500 hover:bg-green-600 text-white aspect-square"
            >
              <Play />
            </Button>
            <Button
              size="icon"
              variant="secondary"
              onClick={handlePlayInDiscord}
              disabled={isPlayingDiscord}
              className="cursor-pointer bg-gray-300 hover:bg-gray-400 text-white aspect-square"
            >
              <img src={DiscordIcon} alt="Discord" className="h-6 w-6" />
            </Button>
          </div>
        </CardContent>
        <CardFooter className="flex flex-col gap-0 pt-3 pb-3 px-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsDetailsExpanded(!isDetailsExpanded)}
            className="w-full flex items-center justify-center gap-1 h-6 text-xs text-muted-foreground hover:text-foreground"
          >
            {isDetailsExpanded ? (
              <ChevronUp className="h-3 w-3" />
            ) : (
              <ChevronDown className="h-3 w-3" />
            )}
          </Button>
          {isDetailsExpanded && (
            <div className="w-full pt-2 space-y-2">
              <div className="flex flex-wrap gap-1 justify-center items-center">
                {sound.tags && sound.tags.length > 0 ? (
                  sound.tags.map((tag) => (
                    <Badge
                      key={tag}
                      variant="default"
                      className="text-xs cursor-pointer hover:bg-destructive/80 transition-colors"
                      onClick={() => handleRemoveTagDirect(tag)}
                      title="Click to remove"
                    >
                      {tag}
                      <X className="h-3 w-3 ml-1" />
                    </Badge>
                  ))
                ) : (
                  <span className="text-xs text-muted-foreground">no tags</span>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={handleOpenTagsDialog}
                  className="h-5 w-5 p-0 hover:bg-primary/10"
                  title="Add custom tag"
                >
                  <Plus className="h-3 w-3" />
                </Button>
              </div>
              <div className="flex gap-2 justify-center items-center">
                <Badge variant="secondary" className="text-xs whitespace-nowrap">
                  {formatSize(sound.size)}
                </Badge>
                <Badge variant="outline" className="text-xs whitespace-nowrap">
                  {formatDate(sound.uploadedAt)}
                </Badge>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => setShowDeleteDialog(true)}
                  className="cursor-pointer hover:bg-red-900/20 h-5 w-5 p-0 text-red-500 hover:text-red-600"
                >
                  <Trash2 className="h-2.5 w-2.5" />
                </Button>
              </div>
            </div>
          )}
        </CardFooter>
      </Card>

      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Sound</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete "{sound.displayName}"? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteDialog(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showTagsDialog} onOpenChange={setShowTagsDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Tags</DialogTitle>
            <DialogDescription>Add or remove tags for "{sound.displayName}"</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="tag-input">Add new tag</Label>
              <div className="flex gap-2 mt-2">
                <Input
                  id="tag-input"
                  placeholder="Enter tag name..."
                  value={newTagInput}
                  onChange={(e) => setNewTagInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddTag();
                    }
                  }}
                />
                <Button onClick={handleAddTag}>Add</Button>
              </div>
            </div>
            <div>
              <Label>Current tags</Label>
              <div className="flex flex-wrap gap-2 mt-2 min-h-[40px] p-2 border rounded-md">
                {editedTags.length > 0 ? (
                  editedTags.map((tag) => (
                    <Badge key={tag} variant="default" className="text-xs">
                      {tag}
                      <button
                        onClick={() => handleRemoveTag(tag)}
                        className="ml-1 hover:text-destructive"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))
                ) : (
                  <span className="text-xs text-muted-foreground">No tags yet</span>
                )}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowTagsDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveTags}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
