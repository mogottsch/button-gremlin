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
import { Play, Trash2, ChevronDown, ChevronUp } from 'lucide-react';
import { api } from '../services/api';
import { toast } from 'sonner';
import DiscordIcon from '../assets/discordIcon.svg';

interface SoundCardProps {
  sound: Sound;
  onPlay: (sound: Sound) => void;
  onDelete: () => void;
}

export function SoundCard({ sound, onPlay, onDelete }: SoundCardProps) {
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [isPlayingDiscord, setIsPlayingDiscord] = useState(false);
  const [isDetailsExpanded, setIsDetailsExpanded] = useState(false);

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
      <Card className="group transition-all hover:border-primary/50 hover:shadow-lg hover:shadow-primary/10 h-fit relative max-w-[240px]">
        <CardHeader className="pb-3 px-4 pt-4">
          <CardTitle className="flex items-center gap-2 text-base justify-center h-12">
            <span className="text-center leading-tight line-clamp-2" title={sound.displayName}>
              {sound.displayName}
            </span>
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
            <div className="w-full pt-2">
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
    </>
  );
}
