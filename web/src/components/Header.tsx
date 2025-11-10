import { useAuth } from '../hooks/useAuth';
import { Button } from './ui/button';
import { SearchBar } from './SearchBar';
import { TagFilter } from './TagFilter';

interface HeaderProps {
  searchQuery: string;
  onSearchChange: (value: string) => void;
  allTags: string[];
  selectedTags: string[];
  isDefaultState: boolean;
  deleteMode: boolean;
  onTagClick: (tag: string) => void;
  onClearFilters: () => void;
  onDeleteModeToggle: () => void;
  onTagsUpdated: () => void;
}

export function Header({
  searchQuery,
  onSearchChange,
  allTags,
  selectedTags,
  isDefaultState,
  deleteMode,
  onTagClick,
  onClearFilters,
  onDeleteModeToggle,
  onTagsUpdated,
}: HeaderProps) {
  const { logout } = useAuth();

  return (
    <header className="sticky top-0 z-40 border-b backdrop-blur-xl bg-card/80">
      <div className="mx-auto w-full max-w-6xl px-4 py-5 md:px-8 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img
              src="/logo.png"
              alt="Button Gremlin"
              className="h-20 w-20 rounded-full object-cover"
            />
            <div>
              <h1 className="text-2xl font-semibold">Button Gremlin</h1>
              <p className="text-xs text-muted-foreground">Discord Soundboard</p>
            </div>
          </div>
          <Button variant="outline" onClick={logout} className="rounded-lg">
            Logout
          </Button>
        </div>
        <SearchBar value={searchQuery} onChange={onSearchChange} />
        <TagFilter
          allTags={allTags}
          selectedTags={selectedTags}
          isDefaultState={isDefaultState}
          deleteMode={deleteMode}
          onTagClick={onTagClick}
          onClearFilters={onClearFilters}
          onDeleteModeToggle={onDeleteModeToggle}
          onTagsUpdated={onTagsUpdated}
        />
      </div>
    </header>
  );
}
