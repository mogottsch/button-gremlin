import { useEffect, useRef, useState } from 'react';
import type { Sound } from '@backend/web/schemas/index.js';
import { Card, CardContent } from './ui/card';
import { Button } from './ui/button';
import { Progress } from './ui/progress';
import { Slider } from './ui/slider';
import { Play, Pause, Volume2, VolumeX, Square } from 'lucide-react';
import { api } from '../services/api';

interface SoundPlayerProps {
  currentSound: Sound | null;
}

export function SoundPlayer({ currentSound }: SoundPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const objectUrlRef = useRef<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);

  useEffect(() => {
    if (currentSound && audioRef.current) {
      const loadAudio = async () => {
        if (objectUrlRef.current) {
          URL.revokeObjectURL(objectUrlRef.current);
          objectUrlRef.current = null;
        }

        try {
          const apiKey = localStorage.getItem('apiKey');
          if (!apiKey) return;

          const response = await fetch(api.sounds.streamUrl(currentSound.name), {
            headers: {
              Authorization: `Bearer ${apiKey}`,
            },
          });

          if (!response.ok) {
            console.error('Failed to load audio:', response.statusText);
            return;
          }

          const blob = await response.blob();
          const url = URL.createObjectURL(blob);
          objectUrlRef.current = url;
          audioRef.current!.src = url;
          audioRef.current!.load();
          audioRef.current!.play().catch(() => {});
        } catch (error) {
          console.error('Error loading audio:', error);
        }
      };

      void loadAudio();

      return () => {
        if (objectUrlRef.current) {
          URL.revokeObjectURL(objectUrlRef.current);
          objectUrlRef.current = null;
        }
      };
    }
  }, [currentSound]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const updateProgress = () => {
      const progress = (audio.currentTime / audio.duration) * 100;
      setProgress(isNaN(progress) ? 0 : progress);
    };

    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);
    const handleEnded = () => {
      setIsPlaying(false);
      setProgress(0);
    };

    audio.addEventListener('timeupdate', updateProgress);
    audio.addEventListener('play', handlePlay);
    audio.addEventListener('pause', handlePause);
    audio.addEventListener('ended', handleEnded);

    return () => {
      audio.removeEventListener('timeupdate', updateProgress);
      audio.removeEventListener('play', handlePlay);
      audio.removeEventListener('pause', handlePause);
      audio.removeEventListener('ended', handleEnded);
    };
  }, []);

  const togglePlayPause = () => {
    if (!audioRef.current) return;

    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play().catch(() => {});
    }
  };

  const stopAudio = () => {
    if (!audioRef.current) return;
    audioRef.current.pause();
    audioRef.current.currentTime = 0;
    setIsPlaying(false);
    setProgress(0);
  };

  const toggleMute = () => {
    if (!audioRef.current) return;
    setIsMuted(!isMuted);
    audioRef.current.muted = !isMuted;
  };

  const handleVolumeChange = (value: number[]) => {
    const newVolume = value[0];
    setVolume(newVolume);
    setIsMuted(newVolume === 0);
    if (audioRef.current) {
      audioRef.current.volume = newVolume;
      audioRef.current.muted = newVolume === 0;
    }
  };

  if (!currentSound) {
    return null;
  }

  return (
    <Card className="fixed bottom-0 left-0 right-0 border-t rounded-none backdrop-blur-xl bg-card/95">
      <CardContent className="py-4">
        <audio ref={audioRef} />
        <div className="mx-auto w-full max-w-6xl space-y-3">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={togglePlayPause}
                disabled={!currentSound}
                className="h-10 w-10 rounded-full p-0"
              >
                {isPlaying ? <Pause /> : <Play />}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={stopAudio}
                disabled={!currentSound}
                className="h-10 w-10 rounded-full p-0"
              >
                <Square />
              </Button>
            </div>
            <div className="flex-1 space-y-1.5">
              <p className="text-sm font-medium">{currentSound.displayName}</p>
              <Progress value={progress} className="h-1.5" />
            </div>
            <div className="flex items-center gap-3">
              <Button
                size="sm"
                variant="ghost"
                onClick={toggleMute}
                className="h-9 w-9 rounded-full p-0"
              >
                {isMuted || volume === 0 ? <VolumeX /> : <Volume2 />}
              </Button>
              <Slider
                value={[volume]}
                onValueChange={handleVolumeChange}
                max={1}
                step={0.01}
                className="w-24"
              />
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
