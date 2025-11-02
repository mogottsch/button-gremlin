import { useState } from 'react';
import type { Sound } from '@backend/web/schemas/index.js';
import { useAuth } from './hooks/useAuth';
import { Login } from './components/Login';
import { Header } from './components/Header';
import { SoundList } from './components/SoundList';
import { SoundPlayer } from './components/SoundPlayer';
import { Toaster } from './components/ui/sonner';

function App() {
  const { isAuthenticated } = useAuth();
  const [currentSound, setCurrentSound] = useState<Sound | null>(null);

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
      <Header />
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8 md:px-8">
        <SoundList onPlaySound={setCurrentSound} />
      </main>
      <SoundPlayer currentSound={currentSound} />
      <Toaster />
    </div>
  );
}

export default App;
