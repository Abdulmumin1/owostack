<script lang="ts">
  import { onMount, tick } from "svelte";

  const fps = 12;
  const sourceCols = 175;
  const sourceRows = 118;
  const minCols = 96;
  const minRows = 64;
  const probeText = "0".repeat(256);

  let host: HTMLDivElement;
  let measureProbe: HTMLSpanElement;
  let asciiFrames = $state<string[]>([]);
  let frameIndex = $state(0);
  let gridSize = $state({ cols: sourceCols, rows: sourceRows });

  let interval: ReturnType<typeof setInterval> | undefined;
  let resizeObserver: ResizeObserver | undefined;
  let intersectionObserver: IntersectionObserver | undefined;
  let visible = true;
  let reduceMotion = false;

  let currentFrame = $derived(
    resampleFrame(
      asciiFrames[frameIndex] || asciiFrames[0] || "",
      gridSize.cols,
      gridSize.rows,
    ),
  );

  function measure() {
    if (!host || !measureProbe) return;

    const availableWidth = host.clientWidth;
    const availableHeight = host.clientHeight;
    const probeWidth = measureProbe.getBoundingClientRect().width;
    const probeStyles = window.getComputedStyle(measureProbe);
    const lineHeight = Number.parseFloat(probeStyles.lineHeight);

    if (
      availableWidth <= 0 ||
      availableHeight <= 0 ||
      probeWidth <= 0 ||
      !lineHeight
    ) {
      return;
    }

    const cellWidth = probeWidth / probeText.length;
    gridSize = {
      cols: Math.max(minCols, Math.floor(availableWidth / cellWidth)),
      rows: Math.max(minRows, Math.floor(availableHeight / lineHeight)),
    };
  }

  function resampleFrame(
    frame: string,
    targetCols: number,
    targetRows: number,
  ) {
    if (!frame) return "";

    const lines = frame.split("\n");
    const output: string[] = [];

    for (let row = 0; row < targetRows; row += 1) {
      const sourceRow =
        lines[Math.floor((row / targetRows) * sourceRows)] || "";
      let nextLine = "";

      for (let col = 0; col < targetCols; col += 1) {
        nextLine +=
          sourceRow[Math.floor((col / targetCols) * sourceCols)] || " ";
      }

      output.push(nextLine);
    }

    return output.join("\n");
  }

  onMount(() => {
    let destroyed = false;

    reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    measure();
    window.addEventListener("resize", measure);
    window.visualViewport?.addEventListener("resize", measure);

    resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(host);

    intersectionObserver = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? true;
    });
    intersectionObserver.observe(host);

    async function loadFrames() {
      const module =
        await import("./rocket ascii/original-d9d9232992f4d0a29db7e051635602a1-frames.json");

      if (destroyed) return;

      asciiFrames = module.default as string[];
      frameIndex = 0;
      await tick();
      measure();

      if (!reduceMotion && asciiFrames.length > 1) {
        interval = setInterval(() => {
          if (!visible) return;
          frameIndex = (frameIndex + 1) % asciiFrames.length;
        }, 1000 / fps);
      }
    }

    void loadFrames();

    return () => {
      destroyed = true;
      if (interval) clearInterval(interval);
      window.removeEventListener("resize", measure);
      window.visualViewport?.removeEventListener("resize", measure);
      resizeObserver?.disconnect();
      intersectionObserver?.disconnect();
    };
  });
</script>

<div
  bind:this={host}
  class="relative h-full w-full overflow-hidden bg-bg-secondary text-accent pointer-events-none"
  aria-hidden="true"
>
  <div class="absolute inset-4 border border-border/70 bg-bg-primary/10"></div>
  <span
    bind:this={measureProbe}
    class="pointer-events-none absolute opacity-0 whitespace-pre font-mono text-[12px] leading-[0.65] tracking-[-0.18em]"
    >{probeText}</span
  >
  <pre
    class="relative z-10 pointer-events-none m-0 whitespace-pre font-mono text-[12px] leading-[0.65] tracking-[-0.18em] opacity-80">{currentFrame}</pre>
</div>
