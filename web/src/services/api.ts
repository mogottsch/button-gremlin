import { apiFetch } from './request';
import type { Sound, BotStatus, BotPlayRequest } from '@backend/web/schemas/index.js';

const API_BASE_URL = '/api';

export const api = {
  auth: {
    session: async (): Promise<{
      authenticated: boolean;
      identity?: { subject: string; name: string; avatarUrl?: string };
      csrfToken?: string;
    }> => {
      const response = await apiFetch(`${API_BASE_URL}/auth/session`);
      if (!response.ok) throw new Error('Unable to check session');
      return response.json();
    },
    logout: async (activity = false): Promise<void> => {
      const response = await apiFetch(`${API_BASE_URL}/${activity ? 'activity' : 'auth'}/logout`, {
        method: 'POST',
      });
      if (!response.ok) throw new Error('Logout failed; please retry');
    },
  },
  sounds: {
    list: async (): Promise<Sound[]> => {
      const response = await apiFetch(`${API_BASE_URL}/sounds`, {});
      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('Unauthorized');
        }
        throw new Error('Failed to fetch sounds');
      }
      return response.json();
    },
    streamUrl: (name: string) => `${API_BASE_URL}/sounds/${encodeURIComponent(name)}/stream`,
    stream: async (name: string, signal?: AbortSignal): Promise<Blob> => {
      const response = await apiFetch(api.sounds.streamUrl(name), { signal });
      if (!response.ok) throw new Error('Failed to load audio');
      return response.blob();
    },
    upload: async (file: File): Promise<{ success: boolean; sound?: Sound; error?: string }> => {
      const formData = new FormData();
      formData.append('sound', file);
      const response = await apiFetch(`${API_BASE_URL}/sounds/upload`, {
        method: 'POST',

        body: formData,
      });
      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('Unauthorized');
        }
        throw new Error('Failed to upload sound');
      }
      return response.json();
    },
    delete: async (name: string): Promise<void> => {
      const response = await apiFetch(`${API_BASE_URL}/sounds/${encodeURIComponent(name)}`, {
        method: 'DELETE',
      });
      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('Unauthorized');
        }
        throw new Error('Failed to delete sound');
      }
    },
    getTags: async (): Promise<string[]> => {
      const response = await apiFetch(`${API_BASE_URL}/sounds/tags`, {});
      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('Unauthorized');
        }
        throw new Error('Failed to fetch tags');
      }
      return response.json();
    },
    createTag: async (tag: string): Promise<void> => {
      const response = await apiFetch(`${API_BASE_URL}/sounds/tags`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tag }),
      });
      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('Unauthorized');
        }
        if (response.status === 400) {
          const data = await response.json();
          throw new Error(data.error || 'Failed to create tag');
        }
        throw new Error('Failed to create tag');
      }
    },
    deleteTag: async (tag: string): Promise<void> => {
      const response = await apiFetch(`${API_BASE_URL}/sounds/tags/${encodeURIComponent(tag)}`, {
        method: 'DELETE',
      });
      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('Unauthorized');
        }
        if (response.status === 404) {
          throw new Error('Tag not found');
        }
        throw new Error('Failed to delete tag');
      }
    },
    updateMetadata: async (
      name: string,
      metadata: { displayName?: string; tags?: string[] }
    ): Promise<void> => {
      const response = await apiFetch(
        `${API_BASE_URL}/sounds/${encodeURIComponent(name)}/metadata`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(metadata),
        }
      );
      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('Unauthorized');
        }
        throw new Error('Failed to update metadata');
      }
    },
  },
  bot: {
    status: async (): Promise<BotStatus> => {
      const response = await apiFetch(`${API_BASE_URL}/bot/status`, {});
      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('Unauthorized');
        }
        throw new Error('Failed to fetch bot status');
      }
      return response.json();
    },
    play: async (soundName: string): Promise<{ success: boolean; message: string }> => {
      const response = await apiFetch(`${API_BASE_URL}/bot/play`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ soundName } as BotPlayRequest),
      });
      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('Unauthorized');
        }
        const data = await response.json();
        throw new Error(data.message || 'Failed to play sound');
      }
      return response.json();
    },
    disconnect: async (): Promise<void> => {
      const response = await apiFetch(`${API_BASE_URL}/bot/disconnect`, {
        method: 'POST',
      });
      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('Unauthorized');
        }
        throw new Error('Failed to disconnect');
      }
    },
  },
};
