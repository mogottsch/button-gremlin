import { useState } from 'react';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Label } from './ui/label';
import { Input } from './ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { Plus, Pencil, X } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../services/api';

interface TagFilterProps {
  allTags: string[];
  selectedTags: string[];
  isDefaultState: boolean;
  deleteMode: boolean;
  onTagClick: (tag: string) => void;
  onClearFilters: () => void;
  onDeleteModeToggle: () => void;
  onTagsUpdated: () => void;
}

export function TagFilter({
  allTags,
  selectedTags,
  isDefaultState,
  deleteMode,
  onTagClick,
  onClearFilters,
  onDeleteModeToggle,
  onTagsUpdated,
}: TagFilterProps) {
  const [showNewTagDialog, setShowNewTagDialog] = useState(false);
  const [newTagName, setNewTagName] = useState('');

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
      onTagsUpdated();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to create tag');
    }
  };

  const handleDeleteTag = async (tag: string) => {
    try {
      await api.sounds.deleteTag(tag);
      toast.success(`Tag "${tag}" deleted and removed from all sounds`);
      onTagsUpdated();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to delete tag');
    }
  };

  if (allTags.length === 0) {
    return (
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

  return (
    <>
      <div className="space-y-2">
        <div className="flex gap-2 items-center">
          <div className="flex flex-wrap gap-2 items-center flex-1">
            <span className="text-sm font-medium text-muted-foreground">
              Filter by tags (drag to sound to add):
            </span>
            {allTags.map((tag) => {
              const isSelected = isDefaultState || selectedTags.includes(tag);
              return (
                <Badge
                  key={tag}
                  variant="outline"
                  className={`cursor-pointer transition-colors text-sm px-3 py-1.5 ${
                    isSelected ? 'border-white border-2' : 'border-transparent'
                  } ${
                    deleteMode
                      ? 'hover:bg-destructive hover:text-destructive-foreground'
                      : 'hover:bg-primary/10'
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
                      onTagClick(tag);
                    }
                  }}
                >
                  {tag}
                  {deleteMode && <X className="h-3 w-3 ml-1" />}
                </Badge>
              );
            })}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowNewTagDialog(true)}
              className="h-8 px-3 border-dashed hover:border-primary hover:bg-primary/5"
            >
              <Plus className="h-4 w-4 mr-1" />
              New Tag
            </Button>
            {!isDefaultState && (
              <Button variant="ghost" size="sm" onClick={onClearFilters} className="h-6 text-xs">
                Clear filters
              </Button>
            )}
          </div>
          <Button
            variant={deleteMode ? 'destructive' : 'outline'}
            size="sm"
            onClick={onDeleteModeToggle}
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
    </>
  );
}
