import { useAuth } from '../hooks/useAuth';
import { Button } from './ui/button';

export function Header() {
  const { logout } = useAuth();

  return (
    <header className="sticky top-0 z-40 border-b backdrop-blur-xl bg-card/80">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-5 md:px-8">
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
    </header>
  );
}
