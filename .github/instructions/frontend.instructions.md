---
applyTo: "frontend/**/*.ts,frontend/**/*.tsx"
---

# Frontend Skill — Next.js 14 + Zustand + Tailwind

## Component Pattern

```tsx
// PascalCase filename: MyComponent.tsx
// Named export, never default

interface MyComponentProps {
  projectId: string;
  onComplete?: () => void;
}

export function MyComponent({ projectId, onComplete }: MyComponentProps) {
  // ... component body
}
```

**Rules:**
- PascalCase file names for components
- Named exports only (no `export default`)
- Props defined as interface, not inline type
- Use Tailwind CSS for styling, never CSS modules

## Zustand Store Pattern

```tsx
import { create } from 'zustand';
import { produce } from 'immer';

interface MyState {
  items: Item[];
  loading: boolean;
  // Actions
  addItem: (item: Item) => void;
  fetchItems: () => Promise<void>;
}

export const useMyStore = create<MyState>((set, get) => ({
  items: [],
  loading: false,

  // 🔴 MUST use immer produce() for nested updates
  addItem: (item) => set(produce((state) => {
    state.items.push(item);
  })),

  fetchItems: async () => {
    set({ loading: true });
    try {
      const response = await myApi.getItems();
      if (response.success) {
        set({ items: response.data, loading: false });
      }
    } catch (error) {
      console.error('Failed to fetch:', error);
      set({ loading: false });
    }
  },
}));
```

**🔴 Critical rules:**
1. ALWAYS use `produce()` from immer for nested state updates
2. NEVER mutate state directly
3. After async operations, re-read state via `useMyStore.getState()` — captured variables may be stale

```tsx
// ❌ WRONG: stale closure
const handleSave = async () => {
  await saveProject();
  console.log(items); // captured at render time, may be stale!
};

// ✅ RIGHT: re-read from store
const handleSave = async () => {
  await saveProject();
  const { items } = useMyStore.getState(); // always fresh
};
```

## API Client Pattern

Never use raw `fetch()`. Always use the typed API client:

```tsx
import { projectApi, templateApi, assetApi } from '@/lib/api';

// Every API call returns ApiResponse<T>
const response = await projectApi.getProjects();
if (response.success) {
  // Use response.data safely
  const projects = response.data;
} else {
  // Handle error
  console.error(response.error);
}
```

Creating a new API module:

```tsx
// lib/api/my-resource.ts
import { ApiClient, ApiResponse } from './client';

class MyResourceApi extends ApiClient {
  async getAll(): Promise<ApiResponse<MyResource[]>> {
    return this.get('/api/my-resources');
  }

  async create(data: CreateRequest): Promise<ApiResponse<MyResource>> {
    return this.post('/api/my-resources', data);
  }
}

export const myResourceApi = new MyResourceApi();
```

Then register in `lib/api/index.ts`.

## 🔴 Time Unit Conversion

```tsx
// Receiving from API (seconds → milliseconds)
const startMs = apiClip.start_time * 1000;
const durationMs = apiClip.duration * 1000;

// Sending to API (milliseconds → seconds)
const payload = {
  start_time: clip.startMs / 1000,
  duration: clip.durationMs / 1000,
};
```

## Async Operations

Every async operation must follow this pattern:

```tsx
const [loading, setLoading] = useState(false);
const [error, setError] = useState<string | null>(null);

const handleAction = async () => {
  setLoading(true);
  setError(null);
  try {
    const response = await api.doSomething();
    if (!response.success) {
      throw new Error(response.error || 'Unknown error');
    }
    // Handle success
  } catch (err) {
    setError(err instanceof Error ? err.message : 'Operation failed');
    console.error('Action failed:', err);
  } finally {
    setLoading(false);
  }
};
```

## Type Definitions

All types go in `frontend/src/types/`:

```tsx
// types/my-feature.ts
export interface MyResource {
  id: string;
  name: string;
  created_at: string;
}

// Re-export from types/index.ts
export * from './my-feature';
```

## Project ID Format

When generating IDs on the frontend:
- Projects: `proj-${crypto.randomUUID()}`
- Clips: `clip-${crypto.randomUUID()}`
- Tasks: `task-${crypto.randomUUID()}`
