# Adding a Page or a Chart

The dashboard is a Bun server (`src/index.ts`) that serves a static
`public/index.html` plus JSON API endpoints, and a Chart.js frontend
(`src/frontend.ts`) compiled into `public/app.js` by `bun run build`.

To see changes, run `bun run dev` (auto-rebuilds + restarts on change) or
`bun run build` manually. `public/app.js` is generated and must not be edited
by hand.

## Overview of the wiring

| Concern       | File                | Role                                          |
| ------------- | ------------------- | --------------------------------------------- |
| HTML layout   | `public/index.html` | Nav links, `.page` sections, chart `<canvas>` |
| Backend API   | `src/index.ts`      | Handlers in the `router` record               |
| Chart loading | `src/frontend.ts`   | `loadXChart()` + `PAGES` record               |

## Adding a new chart

A chart has one `<canvas>` in the HTML, one API handler in the router, and one
loader function in the frontend.

### 1. Backend endpoint (`src/index.ts`)

Add a handler to the `router` record. Reuse the existing helpers
(`daysForRange`, `generateSeries`, `sliceSeries`) if the chart is
date-based:

```ts
'/api/mychart': (params) => {
  const days = daysForRange(params.get('range'));
  const data = sliceSeries(generateSeries(MAX_DAYS, 50, 15, 3), days);
  return {
    range: params.get('range') ?? '7d',
    labels: data.labels,
    datasets: [{ label: 'Something', data: data.data }],
  };
},
```

For real data, `Bun.serve` handlers can read the SQLite DB (see
`loadTokenData` for the pattern) or any other source.

### 2. Frontend loader (`src/frontend.ts`)

Add an async loader that fetches the API JSON and calls `createChart`.
Match the existing style (typed response, `PALETTE` colors, `commonOptions`):

```ts
async function loadMyChart(range: string) {
  const data = await getJSON<{
    range: string;
    labels: string[];
    datasets: { label: string; data: number[] }[];
  }>(`/api/mychart?range=${range}`);

  createChart('myChart', {
    type: 'line',
    data: {
      labels: data.labels,
      datasets: data.datasets.map((d, i) => ({
        ...d,
        borderColor: PALETTE[i],
        backgroundColor: PALETTE[i] + '33',
        tension: 0.4,
        pointRadius: 4,
      })),
    },
    options: commonOptions(),
  });
}
```

If the new chart type needs a controller/scale not already registered, add it
to the `Chart.register` call at the top and the `chart.js` import. Already
registered: line, bar, pie, scatter, category, linear, point, line, bar, arc
elements, `Filler`, `Tooltip`, `Legend`.

### 3. HTML card (`public/index.html`)

Add a `<section class="card">` inside the `.page` section that should hold the
chart. `wide` cards span the full grid width; omit it for half-width:

```html
<section class="card wide">
  <div class="card-header">
    <h2>My Chart</h2>
    <div class="controls">
      <select id="myRange" class="range-select" aria-label="Time range">
        <option value="7d" selected>7 days</option>
        <option value="14d">14 days</option>
        <option value="28d">28 days</option>
        <option value="1y">1 year</option>
        <option value="all">All</option>
      </select>
      <button type="button" class="data-btn" data-api="/api/mychart" data-range="myRange">Data</button>
    </div>
  </div>
  <div class="chart-container"><canvas id="myChart"></canvas></div>
</section>
```

- The `data-btn` `downloadChartData` wiring is automatic once the button has a
  `data-api` attribute (and `data-range` if it reads a select).
- Omit the `<select>` if the chart has no time range.

### 4. Call the loader

Add the loader either to a page function in `PAGES` (see below), or wire the
range select directly:

```ts
const myRange = document.getElementById('myRange') as HTMLSelectElement;
myRange.addEventListener('change', () => loadMyChart(myRange.value));
```

### 5. Build

```sh
bun run build
```

## Adding a new page

### 1. Nav link (`public/index.html`)

Add a link in the sidebar `<nav>`. `data-page` must match the page div:

```html
<a href="#" class="nav-link" data-page="mynewpage">My New Page</a>
```

### 2. Page section (`public/index.html`)

Add a sibling of the other `.page` divs, with the same page name in
`data-page` (no `active` class until you want it to be the default):

```html
<div class="page" data-page="mynewpage">
  <div class="grid">
    <!-- chart cards from the steps above go here -->
  </div>
</div>
```

### 3. Register the page (`src/frontend.ts`)

Extend the `PageName` union and add an entry to `PAGES`. `PAGES` is typed as
`Record<PageName, () => Promise<void>>`, so TypeScript will error if you forget
a key:

```ts
type PageName = 'revenue' | 'audience' | 'performance' | 'mynewpage';

const PAGES: Record<PageName, () => Promise<void>> = {
  // existing entries...
  mynewpage: async () => {
    await Promise.all([loadMyChart(selectedRange('myRange'))]);
  },
};
```

Navigation, active-link/page toggling, and refresh are handled generically by
`loadPage`; no further wiring is needed.