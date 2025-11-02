import { useState } from 'react';
import type { Sound } from '@backend/web/schemas/index.js';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { Play, Music, Trash2 } from 'lucide-react';
import { api } from '../services/api';
import { toast } from 'sonner';

interface SoundCardProps {
  sound: Sound;
  onPlay: (sound: Sound) => void;
  onDelete: () => void;
}

export function SoundCard({ sound, onPlay, onDelete }: SoundCardProps) {
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [isPlayingDiscord, setIsPlayingDiscord] = useState(false);

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

  return (
    <>
      <Card className="group transition-all hover:border-primary/50 hover:shadow-lg hover:shadow-primary/10">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Music className="h-4 w-4 text-primary" />
            <span className="truncate">{sound.displayName}</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 pb-3">
          <div className="flex gap-2">
            <Badge variant="secondary" className="text-xs">
              {formatSize(sound.size)}
            </Badge>
            <Badge variant="outline" className="text-xs">
              {formatDate(sound.uploadedAt)}
            </Badge>
          </div>
        </CardContent>
        <CardFooter className="flex gap-2 pt-3">
          <Button
            size="sm"
            onClick={() => onPlay(sound)}
            className="flex-1 cursor-pointer bg-green-500 hover:bg-green-600 text-white"
          >
            <Play />
            Browser
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={handlePlayInDiscord}
            disabled={isPlayingDiscord}
            className="flex-1 cursor-pointer bg-blue-500 hover:bg-blue-600 text-white"
          >
            <Music />
            Discord
          </Button>
          <Button
            size="sm"
            variant="destructive"
            onClick={() => setShowDeleteDialog(true)}
            className="cursor-pointer"
          >
            <Trash2 />
          </Button>
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
    </>
  );
}
