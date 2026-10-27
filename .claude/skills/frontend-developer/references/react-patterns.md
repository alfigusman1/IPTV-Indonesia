# Advanced React Patterns

## Compound Components

Pattern untuk API yang fleksibel dan composable:

```typescript
// Context untuk komunikasi internal
const AccordionContext = createContext<{
  openItems: Set<string>;
  toggle: (id: string) => void;
} | null>(null);

function useAccordionContext() {
  const ctx = useContext(AccordionContext);
  if (!ctx) throw new Error('Must be used within Accordion');
  return ctx;
}

// Root component
function Accordion({ children, defaultOpen = [] }: AccordionProps) {
  const [openItems, setOpenItems] = useState<Set<string>>(new Set(defaultOpen));
  const toggle = useCallback((id: string) => {
    setOpenItems(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  return (
    <AccordionContext.Provider value={{ openItems, toggle }}>
      <div role="list">{children}</div>
    </AccordionContext.Provider>
  );
}

// Sub-components
Accordion.Item = function AccordionItem({ id, children }: ItemProps) {
  const { openItems, toggle } = useAccordionContext();
  const isOpen = openItems.has(id);
  return (
    <div role="listitem">
      <button
        aria-expanded={isOpen}
        aria-controls={`panel-${id}`}
        onClick={() => toggle(id)}
      >
        {children[0]}
      </button>
      <div
        id={`panel-${id}`}
        role="region"
        hidden={!isOpen}
      >
        {children[1]}
      </div>
    </div>
  );
};

// Usage yang clean
<Accordion defaultOpen={['item-1']}>
  <Accordion.Item id="item-1">
    <span>Title 1</span>
    <p>Content 1</p>
  </Accordion.Item>
</Accordion>
```

## Render Props (masih relevan untuk kasus tertentu)

```typescript
type DataFetcherProps<T> = {
  url: string;
  render: (state: AsyncState<T>) => ReactNode;
};

function DataFetcher<T>({ url, render }: DataFetcherProps<T>) {
  const state = useFetch<T>(url);
  return <>{render(state)}</>;
}

// Usage
<DataFetcher
  url="/api/users"
  render={(state) => {
    if (state.status === 'loading') return <Spinner />;
    if (state.status === 'error') return <ErrorMessage error={state.error} />;
    if (state.status === 'success') return <UserList users={state.data} />;
    return null;
  }}
/>
```

## Custom Hook Pattern yang Mature

```typescript
// Encapsulate semua logic, expose minimal API
function useModal(options?: { onClose?: () => void }) {
  const [isOpen, setIsOpen] = useState(false);

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => {
    setIsOpen(false);
    options?.onClose?.();
  }, [options?.onClose]);

  // Handle Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler); // CLEANUP!
  }, [isOpen, close]);

  return { isOpen, open, close };
}
```

## Error Boundaries yang Proper

```typescript
type ErrorBoundaryState = { error: Error | null };

class ErrorBoundary extends Component<
  { fallback: ReactNode; onError?: (error: Error) => void; children: ReactNode },
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.props.onError?.(error);
    // Log ke error tracking service (Sentry, etc.)
    console.error('Uncaught error:', error, info);
  }

  render() {
    if (this.state.error) return this.props.fallback;
    return this.props.children;
  }
}

// Wrapper yang lebih ergonomis
function withErrorBoundary<P>(
  Component: ComponentType<P>,
  fallback: ReactNode
) {
  return function WithErrorBoundary(props: P) {
    return (
      <ErrorBoundary fallback={fallback}>
        <Component {...props} />
      </ErrorBoundary>
    );
  };
}
```

## Optimistic Updates dengan React Query

```typescript
function useLikePost() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (postId: string) => api.likePost(postId),

    onMutate: async (postId) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: ['posts', postId] });

      // Snapshot current value
      const previousPost = queryClient.getQueryData(['posts', postId]);

      // Optimistically update
      queryClient.setQueryData(['posts', postId], (old: Post) => ({
        ...old,
        likes: old.likes + 1,
        isLiked: true,
      }));

      return { previousPost };
    },

    onError: (err, postId, context) => {
      // Rollback on error
      queryClient.setQueryData(['posts', postId], context?.previousPost);
    },

    onSettled: (data, error, postId) => {
      // Always refetch to sync dengan server
      queryClient.invalidateQueries({ queryKey: ['posts', postId] });
    },
  });
}
```
