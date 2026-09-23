<script lang="ts">
  // Pixel "sunset" strip: stacked colour bands, each dithered with the
  // previous band's colour so the transition reads as a checkerboard gradient.
  // Used to cut between sections instead of a plain border.
  interface Props {
    bands?: string[];
    height?: string;
    class?: string;
    /** Larger checker on the last band, like a coarser fade-out */
    coarseTail?: boolean;
  }

  let {
    bands = [
      "var(--color-ink)",
      "var(--color-accent-border)",
      "var(--color-accent)",
      "var(--color-secondary)",
      "var(--color-bg-primary)",
    ],
    height = "72px",
    class: className = "",
    coarseTail = true,
  }: Props = $props();
</script>

<div
  class={`flex w-full flex-col ${className}`}
  style={`height: ${height}`}
  aria-hidden="true"
>
  {#each bands as color, i (i)}
    <div class="relative flex-1" style={`background: ${color}`}>
      {#if i > 0}
        <div
          class="dither absolute inset-0"
          style={`--dither-color: ${bands[i - 1]}; ${
            coarseTail && i === bands.length - 1
              ? "background-size: 16px 16px; background-position: 4px 4px;"
              : ""
          }`}
        ></div>
      {/if}
    </div>
  {/each}
</div>
