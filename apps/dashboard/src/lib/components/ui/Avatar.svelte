<script lang="ts">
  export let name: string;
  export let size = 32;
  export let style = "croodles";
  export let url = ""
  
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
