# Performance Documentation

## Initial Load Time

### Expected Load Times

- **Development Mode**: 4-8 seconds for initial load
- **Production Mode**: 1-3 seconds for initial load

### Why Initial Load Takes Time

The application's initial load time is influenced by several factors:

#### 1. Development Mode Overhead

In development mode (`npm run dev`), Vite performs several operations that add latency:

- **Module Transformation**: TypeScript/JSX files are transformed on-the-fly
- **Hot Module Replacement (HMR) Setup**: Development server initializes HMR infrastructure
- **Source Maps Generation**: Debug information is generated for each module
- **Dependency Pre-bundling**: First-time dependency optimization can take 2-4 seconds
- **No Code Minification**: Full source code is served (larger bundle sizes)

**Impact**: Development mode is intentionally slower to enable fast iteration and debugging.

#### 2. Code Splitting and Lazy Loading

The application uses code splitting to reduce initial bundle size:

- **Route-based Splitting**: Each page (Dashboard, DeviceDetails, Monitor) loads separately
- **Component Lazy Loading**: Heavy components like `LiveRecordingPanel` (which includes Soniox SDK) load on-demand
- **Vendor Chunk Separation**: React, React Query, and UI libraries are in separate chunks

**Impact**: While this reduces initial bundle size, it means additional network requests are needed when navigating to different routes. The first route load includes:
- Main bundle (~90KB gzipped)
- React vendor chunk (~45KB gzipped)
- Query vendor chunk (~11KB gzipped)
- UI vendor chunk (~3KB gzipped)
- Route-specific chunk (5-76KB gzipped depending on route)

#### 3. Database Query Performance

The dashboard overview query aggregates data across multiple tables:

- **Complex Aggregations**: Counts sessions and flags per device
- **JOIN Operations**: Combines users, transcripts, and flagged_content tables
- **Index Usage**: Database indexes help, but initial queries may still take 200-500ms

**Impact**: First dashboard load requires database queries that can take 300-800ms depending on data volume.

#### 4. Network Latency

Multiple factors contribute to network latency:

- **Sequential Chunk Loading**: Code-split chunks load sequentially (not parallel)
- **Font Loading**: Google Fonts (Inter) loads asynchronously but still requires network round-trip
- **API Requests**: Authentication and dashboard data require server round-trips
- **Development Server**: Vite dev server adds latency for module resolution

**Impact**: Each network request adds 50-200ms depending on connection quality.

#### 5. React Hydration and Initialization

React needs to:

- **Parse JavaScript**: Execute and parse all loaded modules
- **Initialize React Query**: Set up caching and query infrastructure
- **Render Components**: Initial render of navigation and page content
- **Run Effects**: Authentication checks, data fetching hooks

**Impact**: JavaScript execution and React initialization typically takes 200-500ms.

### Performance Optimizations Implemented

We've implemented several optimizations to improve load time:

#### ✅ Code Splitting
- Lazy loading for all routes except Home page
- Lazy loading for heavy components (LiveRecordingPanel with Soniox SDK)
- Vendor chunk separation for better caching

#### ✅ Database Optimizations
- Optimized dashboard query using CTEs instead of multiple JOINs
- Added indexes on frequently queried columns:
  - `transcripts.user_id`
  - `transcripts.created_at`
  - `flagged_content.transcript_id`
  - `flagged_content.flag_type`
- Removed expensive `COUNT(DISTINCT)` operations
- Activity tracking uses `GREATEST(MAX(created_at), MAX(updated_at))` for accurate last activity

#### ✅ Cache Management
- Server-side caching with automatic invalidation
- Dashboard cache invalidated when transcripts are created/updated
- Client-side React Query caching with 10-second stale time
- Auto-refresh every 30 seconds for live dashboard updates
- Cache invalidation on segment append and flag creation

#### ✅ Resource Hints
- DNS prefetch for Google Fonts
- Preconnect for external resources
- Module preload for main entry point
- Asynchronous font loading (non-blocking)

#### ✅ Loading States
- Initial HTML loading spinner (prevents white screen)
- Suspense boundaries with loading fallbacks
- Skeleton loaders for navigation auth state

#### ✅ Build Optimizations
- Manual chunk splitting for vendor libraries
- Vite dependency pre-bundling
- Production code minification and tree-shaking

### Development vs Production

| Factor | Development | Production |
|--------|-------------|------------|
| **Code Transformation** | On-the-fly (slow) | Pre-built (fast) |
| **Bundle Size** | Unminified (large) | Minified (small) |
| **Source Maps** | Full (large) | None or minimal |
| **HMR Overhead** | Yes (~1-2s) | No |
| **Dependency Pre-bundling** | First-time only | Pre-bundled |
| **Expected Load Time** | 4-8 seconds | 1-3 seconds |

### Monitoring Load Performance

To understand what's taking time in your environment:

1. **Open Browser DevTools** → Network tab
   - Check which resources are slowest
   - Look for blocking requests
   - Verify chunk sizes

2. **Performance Tab** → Record page load
   - Identify JavaScript execution time
   - Check for long tasks
   - Review paint timing

3. **Server Logs**
   - Check database query times
   - Monitor API endpoint response times
   - Look for slow operations

### Expected Performance Metrics

#### First Contentful Paint (FCP)
- **Development**: 2-4 seconds
- **Production**: 0.8-1.5 seconds

#### Time to Interactive (TTI)
- **Development**: 4-8 seconds
- **Production**: 1.5-3 seconds

#### Largest Contentful Paint (LCP)
- **Development**: 4-8 seconds
- **Production**: 1.5-3 seconds

### When Load Time is Acceptable

The current load times are **acceptable** for this type of application because:

1. **One-Time Cost**: Initial load happens once per session
2. **Subsequent Navigation**: Route changes are fast (cached chunks)
3. **Rich Functionality**: The app provides complex real-time features
4. **Development Trade-off**: Slower dev mode enables faster iteration

### When to Investigate Further

Investigate if you experience:

- **Load times > 10 seconds** in development
- **Load times > 5 seconds** in production
- **Consistent slow database queries** (>1 second)
- **Large bundle sizes** (>500KB gzipped for main bundle)
- **Network timeouts** or failed chunk loads

### Summary

The 4-8 second load time in development is **expected behavior** due to:

- Development server overhead (2-4 seconds)
- Code splitting and lazy loading (1-2 seconds)
- Database queries (300-800ms)
- Network latency (500ms-1s)
- React initialization (200-500ms)

**Production builds are significantly faster** (1-3 seconds) due to pre-built bundles, minification, and no development overhead.

If you need faster development iteration, consider:
- Using production build locally (`npm run build && npm start`)
- Reducing data volume in development database
- Using faster network connection
- Running database locally instead of remote

