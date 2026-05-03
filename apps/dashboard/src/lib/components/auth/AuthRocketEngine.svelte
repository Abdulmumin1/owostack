<script lang="ts">
  import { onMount, tick } from "svelte";

  const fps = 12;

  let host: HTMLDivElement;
  let content: HTMLPreElement;
  let asciiFrames = $state<string[]>([]);
  let frameIndex = $state(0);
  let scale = $state(1);
  let contentHeight = $state<number | null>(null);

  let interval: ReturnType<typeof setInterval> | undefined;
  let resizeObserver: ResizeObserver | undefined;
  let intersectionObserver: IntersectionObserver | undefined;
  let visible = true;
  let reduceMotion = false;

  let currentFrame = $derived(asciiFrames[frameIndex] || asciiFrames[0] || "");

  function measure() {
    if (!host || !content) return;
    const availableWidth = host.clientWidth;
    const naturalWidth = content.scrollWidth;
    const naturalHeight = content.scrollHeight;

    if (availableWidth > 0 && naturalWidth > availableWidth) {
      const nextScale = availableWidth / naturalWidth;
      scale = nextScale;
      contentHeight = naturalHeight * nextScale;
    } else {
      scale = 1;
      contentHeight = null;
    }
  }

  onMount(() => {
    let destroyed = false;

    reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    measure();

    resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(host);

    intersectionObserver = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? true;
    });
    intersectionObserver.observe(host);

    async function loadFrames() {
      const module = await import(
        "./rocket ascii/original-d9d9232992f4d0a29db7e051635602a1-frames.json"
      );

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
      resizeObserver?.disconnect();
      intersectionObserver?.disconnect();
    };
  });
</script>

<div
  bind:this={host}
  class="relative h-full w-full overflow-hidden bg-bg-secondary text-accent"
  style={contentHeight !== null ? `height: ${contentHeight}px` : undefined}
  aria-hidden="true"
>
  <div class="absolute inset-4 border border-border/70 bg-bg-primary/10"></div>
  <pre
    bind:this={content}
    class="relative z-10 m-0 origin-top-left whitespace-pre font-mono text-[12px] leading-[0.65] tracking-[-0.18em] opacity-80"
    style={`transform: scale(${scale});`}
  >{currentFrame}</pre>
</div>
