<script lang="ts">
  export let name: string;
  export let size = 32;

  // Use DiceBear API with the "croodles" style for a hand-drawn look
  const style = "croodles";

  // Use a reactive statement to recompute the URL when the name changes
  $: url = `https://api.dicebear.com/8.x/${style}/svg?seed=${encodeURIComponent(
    name || '?',
  )}&radius=50&size=${size * 2}`;

</script>

<img
  src={url}
  alt="Avatar for {name}"
  class="w-full h-full object-cover"
  width={size}
  height={size}
/>
