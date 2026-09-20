import {
  Chart,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  LineController,
  BarController,
  PieController,
  ScatterController,
  Filler,
  Tooltip,
  Legend,
  type ChartConfiguration,
} from 'chart.js';

Chart.register(
  LineController,
  BarController,
  PieController,
  ScatterController,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Filler,
  Tooltip,
  Legend
);

const BASE = 0x2a2f3a;
const PALETTE = [
  '#0a84ff',
  '#ff2d55',
  '#ff9f0a',
  '#34c759',
  '#bf5af2',
  '#ffd60a',
];

function axisColor() {
  return document.getElementById('theme')?.getAttribute('href')?.includes('dark')
    ? '#8b93a7'
    : '#555';
}

function gridColor() {
  return document.getElementById('theme')?.getAttribute('href')?.includes('dark')
    ? 'rgba(255,255,255,0.06)'
    : 'rgba(0,0,0,0.08)';
}

function commonOptions() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { labels: { color: axisColor() } },
    },
    scales: {
      x: {
        ticks: { color: axisColor() },
        grid: { color: gridColor() },
      },
      y: {
        beginAtZero: true,
        ticks: { color: axisColor() },
        grid: { color: gridColor() },
      },
    },
  } as const;
}

async function getJSON<T>(url: string): Promise<T> {
  const res = await fetch(url);
  return res.json();
}

function createChart(id: string, config: ChartConfiguration) {
  const canvas = document.getElementById(id) as HTMLCanvasElement;
  Chart.getChart(canvas)?.destroy();
  return new Chart(canvas, config);
}

async function loadLineChart(range: string) {
  const data = await getJSON<{
    range: string;
    labels: string[];
    datasets: { label: string; data: number[] }[];
  }>(`/api/line?range=${range}`);

  createChart('lineChart', {
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

async function loadBarChart() {
  const data = await getJSON<{
    labels: string[];
    datasets: { label: string; data: number[] }[];
  }>('/api/bar');

  createChart('barChart', {
    type: 'bar',
    data: {
      labels: data.labels,
      datasets: data.datasets.map((d, i) => ({
        ...d,
        backgroundColor: [PALETTE[0] + 'cc', PALETTE[2] + 'cc'],
        borderColor: [PALETTE[0], PALETTE[2]],
        borderWidth: 1,
      })),
    },
    options: commonOptions(),
  });
}

async function loadPieChart() {
  const data = await getJSON<{
    labels: string[];
    data: number[];
  }>('/api/pie');

  createChart('pieChart', {
    type: 'pie',
    data: {
      labels: data.labels,
      datasets: [
        {
          data: data.data,
          backgroundColor: PALETTE.slice(0, data.labels.length),
          borderColor: '#1e222c',
          borderWidth: 2,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: axisColor() } },
      },
    } as const,
  });
}

async function loadAreaChart(range: string) {
  const data = await getJSON<{
    range: string;
    labels: string[];
    datasets: { label: string; data: number[] }[];
  }>(`/api/area?range=${range}`);

  createChart('areaChart', {
    type: 'line',
    data: {
      labels: data.labels,
      datasets: data.datasets.map((d, i) => ({
        ...d,
        borderColor: PALETTE[i + 3],
        backgroundColor: PALETTE[i + 3] + '4d',
        fill: true,
        tension: 0.35,
        pointRadius: 3,
      })),
    },
    options: commonOptions(),
  });
}

async function loadScatterChart() {
  const data = await getJSON<{
    label: string;
    data: { x: number; y: number }[];
  }>('/api/scatter');

  createChart('scatterChart', {
    type: 'scatter',
    data: {
      datasets: [
        {
          label: data.label,
          data: data.data,
          backgroundColor: PALETTE[0] + 'aa',
          pointRadius: 6,
        },
      ],
    },
    options: commonOptions(),
  });
}

async function loadTokenChart(range: string) {
  const data = await getJSON<{
    range: string;
    labels: string[];
    datasets: { label: string; data: (number | null)[] }[];
  }>(`/api/tokens?range=${range}`);

  const opts = commonOptions();
  const barColors = [PALETTE[0] + 'cc', PALETTE[2] + 'cc'];
  const barBorders = [PALETTE[0], PALETTE[2]];

  createChart('tokenChart', {
    type: 'bar',
    data: {
      labels: data.labels,
      datasets: [
        {
          label: data.datasets[0].label,
          data: data.datasets[0].data,
          backgroundColor: barColors[0],
          borderColor: barBorders[0],
          borderWidth: 1,
        },
        {
          label: data.datasets[1].label,
          data: data.datasets[1].data,
          backgroundColor: barColors[1],
          borderColor: barBorders[1],
          borderWidth: 1,
        },
        {
          label: data.datasets[2].label,
          type: 'line',
          data: data.datasets[2].data,
          yAxisID: 'y1',
          borderColor: PALETTE[1],
          backgroundColor: PALETTE[1],
          pointRadius: 3,
          tension: 0.3,
          order: -1,
        },
      ],
    },
    options: {
      ...opts,
      scales: {
        ...opts.scales,
        y1: {
          position: 'right',
          beginAtZero: true,
          ticks: { color: axisColor() },
          grid: { drawOnChartArea: false, color: gridColor() },
          title: { display: true, text: 'Ratio', color: axisColor() },
        },
      },
    },
  });
}

type PageName = 'revenue' | 'audience' | 'performance';

const PAGES: Record<PageName, () => Promise<void>> = {
  revenue: async () => {
    await Promise.all([
      loadLineChart(selectedRange('lineRange')),
      loadBarChart(),
    ]);
  },
  audience: async () => {
    await Promise.all([
      loadAreaChart(selectedRange('areaRange')),
      loadPieChart(),
    ]);
  },
  performance: async () => {
    await Promise.all([
      loadScatterChart(),
      loadTokenChart(selectedRange('tokenRange')),
    ]);
  },
};

let currentPage: PageName = 'revenue';
let loading = false;

function selectedRange(id: string): string {
  return (document.getElementById(id) as HTMLSelectElement).value;
}

async function downloadChartData(api: string, rangeId: string | null) {
  const url = rangeId
    ? `${api}?range=${encodeURIComponent(selectedRange(rangeId))}`
    : api;
  const res = await fetch(url);
  const blob = await res.blob();
  const url2 = URL.createObjectURL(blob);
  const name = api.split('/').pop() as string;
  const when = new Date().toISOString().slice(0, 10);
  const a = document.createElement('a');
  a.href = url2;
  a.download = `${name}-chart-data-${when}.json`;
  a.click();
  URL.revokeObjectURL(url2);
}

export async function loadAllCharts() {
  if (loading) return;
  loading = true;
  try {
    await PAGES[currentPage]();
  } finally {
    loading = false;
  }
}

async function loadPage(name: PageName) {
  document.querySelectorAll<HTMLAnchorElement>('.nav-link').forEach((link) => {
    link.classList.toggle('active', link.dataset.page === name);
  });
  document.querySelectorAll<HTMLElement>('.page').forEach((page) => {
    page.classList.toggle('active', page.dataset.page === name);
  });
  currentPage = name;
  await loadAllCharts();
}

declare global {
  interface Window {
    loadAllCharts: typeof loadAllCharts;
    updateChartsForTheme: () => void;
  }
}

window.loadAllCharts = loadAllCharts;
window.updateChartsForTheme = () => {
  loadAllCharts();
};

const themeLink = document.getElementById('theme') as HTMLLinkElement;
const themeToggle = document.getElementById('themeToggle') as HTMLInputElement;
const themeLabel = document.getElementById('themeLabel') as HTMLSpanElement;

const savedTheme = localStorage.getItem('theme');
if (savedTheme === 'light') {
  themeToggle.checked = false;
  themeLink.setAttribute('href', '/theme-light.css');
  themeLabel.textContent = 'Light';
}

themeToggle.addEventListener('change', () => {
  const dark = themeToggle.checked;
  themeLink.setAttribute('href', dark ? '/theme-dark.css' : '/theme-light.css');
  themeLabel.textContent = dark ? 'Dark' : 'Light';
  localStorage.setItem('theme', dark ? 'dark' : 'light');
  window.updateChartsForTheme();
});

document.getElementById('refresh')?.addEventListener('click', () => {
  loadAllCharts();
});

document.querySelectorAll<HTMLAnchorElement>('.nav-link').forEach((link) => {
  link.addEventListener('click', (event) => {
    event.preventDefault();
    const name = link.dataset.page as PageName;
    if (name && name !== currentPage) {
      loadPage(name);
    }
  });
});

const lineRange = document.getElementById('lineRange') as HTMLSelectElement;
lineRange.addEventListener('change', () => loadLineChart(lineRange.value));

const areaRange = document.getElementById('areaRange') as HTMLSelectElement;
areaRange.addEventListener('change', () => loadAreaChart(areaRange.value));

const tokenRange = document.getElementById('tokenRange') as HTMLSelectElement;
tokenRange.addEventListener('change', () => loadTokenChart(tokenRange.value));

document.querySelectorAll<HTMLButtonElement>('[data-api]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const api = btn.dataset.api as string;
    downloadChartData(api, btn.dataset.range ?? null);
  });
});

loadPage(currentPage);