import type { Sound, BotStatus, BotPlayRequest, AuthVerify } from '@backend/web/schemas/index.js';

const API_BASE_URL = '/api';

function getAuthHeaders(): HeadersInit {
  const apiKey = localStorage.getItem('apiKey');
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
}

export const api = {
  auth: {
    verify: async (key: string): Promise<{ valid: boolean; error?: string }> => {
      const response = await fetch(`${API_BASE_URL}/auth/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key } as AuthVerify),
      });
      return response.json();
    },
  },
  sounds: {
    list: async (): Promise<Sound[]> => {
      const response = await fetch(`${API_BASE_URL}/sounds`, {
        headers: getAuthHeaders(),
      });
      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('Unauthorized');
        }
        throw new Error('Failed to fetch sounds');
      }
      return response.json();
    },
    streamUrl: (name: string) => `${API_BASE_URL}/sounds/${name}/stream`,
    upload: async (file: File): Promise<{ success: boolean; sound?: Sound; error?: string }> => {
      const formData = new FormData();
      formData.append('sound', file);
      const response = await fetch(`${API_BASE_URL}/sounds/upload`, {
        method: 'POST',
        headers: getAuthHeaders(),
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
      const response = await fetch(`${API_BASE_URL}/sounds/${name}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      });
      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('Unauthorized');
        }
        throw new Error('Failed to delete sound');
      }
    },
    getTags: async (): Promise<string[]> => {
      const response = await fetch(`${API_BASE_URL}/sounds/tags`, {
        headers: getAuthHeaders(),
      });
      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('Unauthorized');
        }
        throw new Error('Failed to fetch tags');
      }
      return response.json();
    },
    createTag: async (tag: string): Promise<void> => {
      const response = await fetch(`${API_BASE_URL}/sounds/tags`, {
        method: 'POST',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
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
      const response = await fetch(`${API_BASE_URL}/sounds/tags/${encodeURIComponent(tag)}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
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
      const response = await fetch(`${API_BASE_URL}/sounds/${name}/metadata`, {
        method: 'PATCH',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(metadata),
      });
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
      const response = await fetch(`${API_BASE_URL}/bot/status`, {
        headers: getAuthHeaders(),
      });
      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('Unauthorized');
        }
        throw new Error('Failed to fetch bot status');
      }
      return response.json();
    },
    play: async (soundName: string): Promise<{ success: boolean; message: string }> => {
      const response = await fetch(`${API_BASE_URL}/bot/play`, {
        method: 'POST',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
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
      const response = await fetch(`${API_BASE_URL}/bot/disconnect`, {
        method: 'POST',
        headers: getAuthHeaders(),
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
