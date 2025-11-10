import { useState, useEffect } from 'react';
import type { Sound } from '@backend/web/schemas/index.js';
import { useAuth } from './hooks/useAuth';
import { Login } from './components/Login';
import { Header } from './components/Header';
import { SoundList } from './components/SoundList';
import { SoundPlayer } from './components/SoundPlayer';
import { Toaster } from './components/ui/sonner';
import { api } from './services/api';

function App() {
  const { isAuthenticated } = useAuth();
  const [currentSound, setCurrentSound] = useState<Sound | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [allTags, setAllTags] = useState<string[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [deleteMode, setDeleteMode] = useState(false);
  const [isDefaultState, setIsDefaultState] = useState(true);

  const loadTags = async () => {
    try {
      const tags = await api.sounds.getTags();
      setAllTags(tags);
    } catch (error) {
      console.error('Failed to load tags:', error);
    }
  };

  useEffect(() => {
    if (isAuthenticated) {
      void loadTags();
    }
  }, [isAuthenticated]);

  const handleTagClick = (tag: string) => {
    if (isDefaultState) {
      // First click: deselect all others, select only this tag
      setSelectedTags([tag]);
      setIsDefaultState(false);
    } else {
      setSelectedTags((prev) => {
        const isSelected = prev.includes(tag);
        let newTags: string[];

        if (isSelected) {
          // Deselect this tag
          newTags = prev.filter((t) => t !== tag);
        } else {
          // Select this tag
          newTags = [...prev, tag];
        }

        // If all tags are selected or none are selected, return to default state
        if (newTags.length === 0 || newTags.length === allTags.length) {
          setIsDefaultState(true);
          return [];
        }

        return newTags;
      });
    }
  };

  const handleClearFilters = () => {
    setSelectedTags([]);
    setIsDefaultState(true);
  };

  const handleTagsUpdated = () => {
    void loadTags();
    // When tags are updated, we may need to adjust selected tags
    setSelectedTags((prev) => {
      const validTags = prev.filter((tag) => allTags.includes(tag));
      if (validTags.length === 0 || validTags.length === allTags.length) {
        setIsDefaultState(true);
        return [];
      }
      return validTags;
    });
  };

  if (!isAuthenticated) {
    return (
      <>
        <Login />
        <Toaster />
      </>
    );
  }

  return (
    <div className="min-h-screen pb-28">
      <Header
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        allTags={allTags}
        selectedTags={selectedTags}
        isDefaultState={isDefaultState}
        deleteMode={deleteMode}
        onTagClick={handleTagClick}
        onClearFilters={handleClearFilters}
        onDeleteModeToggle={() => setDeleteMode(!deleteMode)}
        onTagsUpdated={handleTagsUpdated}
      />
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8 md:px-8">
        <SoundList
          onPlaySound={setCurrentSound}
          searchQuery={searchQuery}
          selectedTags={selectedTags}
          isDefaultState={isDefaultState}
          onSoundsLoaded={loadTags}
        />
      </main>
      <SoundPlayer currentSound={currentSound} />
      <Toaster />
    </div>
  );
}

export default App;
