<script lang="ts">
  import { Chart, registerables } from "chart.js";
  import { onMount } from "svelte";

  Chart.register(...registerables);

  const COLORS = [
    "#e8a855", // amber (accent)
    "#2db57d", // teal (secondary)
    "#5b8bd6", // blue (tertiary)
    "#ec4899", // pink
    "#f59e0b", // warm amber
    "#06b6d4", // cyan
    "#f43f5e", // rose
    "#84cc16", // lime
  ];

  let {
    data,
    features,
    days,
  }: {
    data: Array<{ date: string; featureId: string; totalUsage: number }>;
    features: Array<{ id: string; name: string; slug: string }>;
    days: number;
  } = $props();

  let canvasEl = $state<HTMLCanvasElement | null>(null);
  let chart: Chart | null = null;

  function buildChart() {
    if (!canvasEl) return;
    if (chart) chart.destroy();

    const featureMap = new Map(features.map((f) => [f.id, f]));

    // Build full date range for X axis
    const labels: string[] = [];
    const now = new Date();
    // Reset time to start of day for stable iteration
    now.setHours(0, 0, 0, 0);

    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      labels.push(
        d.getFullYear() +
          "-" +
          String(d.getMonth() + 1).padStart(2, "0") +
          "-" +
          String(d.getDate()).padStart(2, "0"),
      );
    }

    // Prepare Y-axis labels (features)
    let yLabels = features.map((f) => f.name);
    if (yLabels.length === 0) yLabels = ["Total Usage"];

    // Find the max usage to normalize bubble sizes
    let maxUsage = 0;
    for (const row of data) {
      if (row.totalUsage > maxUsage) maxUsage = row.totalUsage;
    }
    if (maxUsage === 0) maxUsage = 1;

    // Group data by feature
    const byFeature = new Map<string, Map<string, number>>();
    for (const row of data) {
      if (!byFeature.has(row.featureId)) {
        byFeature.set(row.featureId, new Map());
      }
      byFeature.get(row.featureId)!.set(row.date.slice(0, 10), row.totalUsage);
    }

    const datasets = [...byFeature.entries()].map(([featureId, dateMap], i) => {
      const meta = featureMap.get(featureId);
      const name = meta?.name || "Total Usage";
      const color = COLORS[i % COLORS.length];

      const points = [];
      for (const date of labels) {
        // some APIs return date Strings with time attached, we just match on the YYYY-MM-DD
        let matchVal = 0;
        for (const [key, val] of dateMap.entries()) {
          if (key.startsWith(date)) matchVal += val;
        }

        if (matchVal > 0) {
          // Map to a bubble radius between 3px and 22px
          const r = Math.max(3, Math.min(22, (matchVal / maxUsage) * 22));
          points.push({ x: date, y: name, r, rawUsage: matchVal });
        }
      }

      return {
        label: name,
        data: points,
        backgroundColor: color + "1A", // 10% opacity
        borderColor: color + "B3", // 70% opacity
        borderWidth: 1.5,
        hoverBackgroundColor: color + "33",
        hoverBorderColor: color,
        hoverBorderWidth: 2,
      };
    });

    // If no specific features are given, plot "Total Usage" as one combined row
    if (datasets.length === 0) {
      const totalMap = new Map<string, number>();
      for (const row of data) {
        const d = row.date.slice(0, 10);
        totalMap.set(d, (totalMap.get(d) || 0) + row.totalUsage);
      }

      let localMax = 0;
      for (const v of totalMap.values()) if (v > localMax) localMax = v;
      if (localMax === 0) localMax = 1;

      const points = [];
      for (const date of labels) {
        const val = totalMap.get(date) || 0;
        if (val > 0) {
          const r = Math.max(3, Math.min(22, (val / localMax) * 22));
          points.push({ x: date, y: "Total Usage", r, rawUsage: val });
        }
      }

      datasets.push({
        label: "Total Usage",
        data: points,
        backgroundColor: COLORS[0] + "1A",
        borderColor: COLORS[0] + "B3",
        borderWidth: 1.5,
        hoverBackgroundColor: COLORS[0] + "33",
        hoverBorderColor: COLORS[0],
        hoverBorderWidth: 2,
      });
      yLabels = ["Total Usage"];
    }

    chart = new Chart(canvasEl, {
      type: "bubble",
      data: { labels, datasets: datasets as any },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        layout: {
          padding: { top: 20, right: 30, bottom: 10, left: 10 },
        },
        plugins: {
          legend: {
            display: false, // Cleaner without top legend, rely on Y axis
          },
          tooltip: {
            backgroundColor: "#1a1a1a",
            titleColor: "#f5f5f5",
            bodyColor: "#a3a3a3",
            borderColor: "#333",
            borderWidth: 1,
            padding: 12,
            boxPadding: 6,
            displayColors: true,
            usePointStyle: true,
            callbacks: {
              title: (items: any) => {
                if (!items.length) return "";
                const d = new Date(items[0].raw.x);
                // "Wed, Feb 14"
                return d.toLocaleDateString("en-US", {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                });
              },
              label: (ctx: any) => {
                return `${ctx.raw.y}: ${ctx.raw.rawUsage.toLocaleString()}`;
              },
            },
          },
        },
        scales: {
          x: {
            type: "category",
            labels: labels,
            grid: {
              color: "rgba(128, 128, 128, 0.08)",
              tickLength: 0,
            },
            border: { display: false },
            ticks: {
              color: "#8b8b8b",
              font: { size: 10, family: "'IBM Plex Mono', monospace" },
              maxTicksLimit: days > 14 ? 14 : days,
              padding: 12,
              callback: function (val, idx) {
                const label = labels[idx];
                if (!label) return "";
                const d = new Date(label + "T12:00:00Z"); // middle of day for safe local parsing
                if (days <= 7) {
                  return d
                    .toLocaleDateString("en-US", { weekday: "short" })
                    .toUpperCase();
                }
                return d
                  .toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                  })
                  .toUpperCase();
              },
            },
          },
          y: {
            type: "category",
            labels: yLabels,
            grid: {
              color: "rgba(128, 128, 128, 0.08)",
              tickLength: 0,
            },
            border: { display: false },
            ticks: {
              color: "#8b8b8b",
              font: {
                size: 11,
                weight: "bold",
                family: "system-ui, sans-serif",
              },
              padding: 16,
            },
          },
        },
      },
    });
  }

  onMount(() => {
    buildChart();
    return () => {
      if (chart) chart.destroy();
    };
  });

  $effect(() => {
    // Re-render when data, features, or days change
    data;
    features;
    days;
    buildChart();
  });
</script>

<div class="h-80 w-full relative">
  <canvas bind:this={canvasEl}></canvas>
</div>
