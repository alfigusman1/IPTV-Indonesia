# Frontend Performance Checklist

## Bundle & Loading

### Critical Path
- [ ] Inline critical CSS (above-the-fold styles)
- [ ] Preload LCP image: `<link rel="preload" as="image" href="hero.webp">`
- [ ] Preconnect ke third-party origins: `<link rel="preconnect" href="https://fonts.googleapis.com">`
- [ ] Defer non-critical scripts
- [ ] Remove render-blocking resources

### Bundle Size
```bash
# Analisis bundle
npx vite-bundle-visualizer
# atau
npx webpack-bundle-analyzer stats.json

# Check ukuran sebelum deploy
npx bundlesize
```

- [ ] Tree-shaking berjalan (no side effects yang tidak diperlukan)
- [ ] Dynamic imports untuk route-level splitting
- [ ] Lazy load komponen di bawah fold
- [ ] Audit dan hapus dependencies yang tidak dipakai (`depcheck`)
- [ ] Ganti lodash dengan lodash-es atau native JS

### Images
- [ ] Gunakan format modern: WebP, AVIF
- [ ] Lazy loading: `<img loading="lazy">`
- [ ] Explicit width dan height untuk menghindari CLS
- [ ] Responsive images dengan `srcset`
- [ ] CDN dengan image optimization

## React-Specific Performance

### Rendering
```typescript
// Gunakan React DevTools Profiler untuk mengidentifikasi
// komponen yang sering re-render tanpa perlu

// Memoize expensive computations
const processed = useMemo(() => expensiveTransform(data), [data]);

// Stabilkan callbacks yang di-pass ke child
const handler = useCallback(() => doSomething(id), [id]);

// Lazy initialize state yang expensive
const [state] = useState(() => computeInitialState());
```

### Virtualization untuk Long Lists
```typescript
// Jangan render 10.000 items sekaligus
import { useVirtualizer } from '@tanstack/react-virtual';

function VirtualList({ items }: { items: Item[] }) {
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 50,
  });

  return (
    <div ref={parentRef} style={{ height: '400px', overflow: 'auto' }}>
      <div style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }}>
        {virtualizer.getVirtualItems().map((virtualItem) => (
          <div
            key={virtualItem.key}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: `${virtualItem.size}px`,
              transform: `translateY(${virtualItem.start}px)`,
            }}
          >
            {items[virtualItem.index].name}
          </div>
        ))}
      </div>
    </div>
  );
}
```

### Concurrent Features (React 18+)
```typescript
// Tandai update sebagai non-urgent
const [isPending, startTransition] = useTransition();

function handleSearch(query: string) {
  // Update input langsung (urgent)
  setInputValue(query);

  // Filter results bisa ditunda (non-urgent)
  startTransition(() => {
    setSearchResults(filterItems(query));
  });
}

// Defer rendering value yang tidak urgent
const deferredQuery = useDeferredValue(query);
const results = useMemo(() => filter(items, deferredQuery), [items, deferredQuery]);
```

## Network Performance

### Caching Strategy
```typescript
// TanStack Query - configure sesuai kebutuhan
const { data } = useQuery({
  queryKey: ['user', userId],
  queryFn: () => fetchUser(userId),
  staleTime: 5 * 60 * 1000,    // Data dianggap fresh selama 5 menit
  gcTime: 30 * 60 * 1000,      // Cache dibersihkan setelah 30 menit
  refetchOnWindowFocus: false,  // Matikan kalau data tidak perlu selalu fresh
});
```

### Prefetching
```typescript
// Prefetch data sebelum user navigate
function NavLink({ href, children }: NavLinkProps) {
  const queryClient = useQueryClient();

  return (
    <Link
      href={href}
      onMouseEnter={() => {
        queryClient.prefetchQuery({
          queryKey: ['page-data', href],
          queryFn: () => fetchPageData(href),
        });
      }}
    >
      {children}
    </Link>
  );
}
```

## CSS Performance

```css
/* Hindari reflow yang mahal */
/* ❌ SALAH */
.element {
  width: calc(100% - 2px); /* Memaksa layout recalculation */
}

/* ✅ BENAR - gunakan transform untuk animasi */
.element {
  transform: translateX(0);
  transition: transform 300ms ease;
}
.element:hover {
  transform: translateX(8px);
}

/* Promote ke GPU layer untuk animasi yang smooth */
.animated-element {
  will-change: transform; /* Gunakan dengan hemat */
}

/* Content visibility untuk large pages */
.below-fold-section {
  content-visibility: auto;
  contain-intrinsic-size: 0 500px; /* Estimate height */
}
```

## Measuring & Monitoring

### Lab Testing
```bash
# Lighthouse CI
npm install -g @lhci/cli
lhci autorun

# WebPageTest API
curl "https://www.webpagetest.org/runtest.php?url=https://yoursite.com&k=YOUR_KEY&f=json"
```

### Real User Monitoring (RUM)
```typescript
// Web Vitals
import { onCLS, onINP, onLCP } from 'web-vitals';

function sendToAnalytics(metric: Metric) {
  // Kirim ke analytics service
  analytics.track('web_vital', {
    name: metric.name,
    value: metric.value,
    rating: metric.rating, // 'good' | 'needs-improvement' | 'poor'
    id: metric.id,
  });
}

onCLS(sendToAnalytics);
onINP(sendToAnalytics);
onLCP(sendToAnalytics);
```
