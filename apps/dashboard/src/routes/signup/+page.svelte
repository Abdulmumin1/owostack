<script lang="ts">
  import {
    ArrowRight,
    CircleNotch,
    Envelope,
    Sparkle,
    CheckCircle,
  } from "phosphor-svelte";
  import Logo from "$lib/components/ui/Logo.svelte";
  import { onMount } from "svelte";
  import { fade, fly } from "svelte/transition";

  let email = $state("");
  let isLoading = $state(false);
  let error = $state<string | null>(null);
  let status = $state<"form" | "success">("form");
  let mounted = $state(false);

  onMount(() => {
    mounted = true;
  });

  async function handleSubmit(e: Event) {
    e.preventDefault();
    isLoading = true;
    error = null;

    try {
      const response = await fetch("/api/waitlist", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Failed to submit request");
      }

      status = "success";
    } catch (err: any) {
      error = err.message || "Something went wrong";
    } finally {
      isLoading = false;
    }
  }
</script>

<svelte:head>
  <title>Request Invite - Owostack</title>
</svelte:head>

<div class="min-h-screen flex bg-bg-primary">
  <!-- Left Side: Landing Image (Matches Login/Join) -->
  <div
    class="hidden lg:flex lg:w-1/2 bg-bg-secondary border-r border-border relative overflow-hidden"
  >
    <div class="absolute inset-0">
      <img
        src="https://mac-file.yaqeen.me/87C9A6BB-3D4410F0-72E6-46B0-9B54-142A675819EE_1_201_a.jpeg"
        alt=""
        class="w-full h-full object-cover"
      />
    </div>
  </div>

  <!-- Right Side: Request Form -->
  <div
    class="flex-1 flex items-center justify-center p-6 lg:p-12 bg-bg-primary"
  >
    <div class="w-full max-w-sm">
      <div class="lg:hidden text-center mb-8">
        <a
          href="/"
          class="inline-flex items-center gap-2 text-xl font-bold text-text-primary mb-4"
        >
          <Logo size={28} class="text-accent" weight="duotone" />
          <span>Owostack</span>
        </a>
      </div>

      {#if status === "form"}
        <div in:fade>
          <div class="mb-8">
            <div class="flex items-center gap-2 mb-3">
              <img src="https://mac-file.yaqeen.me/407C7F04-annotely_image%20%284%29.png" alt="" class="h-20 w-20 object-contain">
            </div>
            <h1
              class="text-2xl font-bold mb-2 uppercase tracking-tight text-text-primary"
            >
              Request Access
            </h1>
            <p class="text-text-secondary text-sm">
              Owostack is currently in private beta. We will respond promptly!
            </p>
          </div>

          {#if error}
            <div
              class="mb-4 p-3 bg-error-bg border border-error text-error text-[10px] font-bold uppercase tracking-wider"
            >
              {error}
            </div>
          {/if}

          <form class="flex flex-col gap-4" onsubmit={handleSubmit}>
            <div>
              <label
                for="email"
                class="block text-[10px] font-bold text-text-dim uppercase tracking-widest mb-2"
                >Email</label
              >
              <div class="input-icon-wrapper">
                <Envelope size={18} class="input-icon-left" weight="duotone" />
                <input
                  type="email"
                  id="email"
                  bind:value={email}
                  placeholder="you@company.com"
                  required
                  class="input input-has-icon-left"
                />
              </div>
            </div>

            <button
              type="submit"
              class="btn btn-primary w-full mt-2 py-4"
              disabled={isLoading}
            >
              {#if isLoading}
                Sending...
              {:else}
                Request Invite
                <ArrowRight size={16} weight="fill" />
              {/if}
            </button>
          </form>

          <p
            class="text-center mt-8 text-text-dim text-[10px] font-bold uppercase tracking-tight"
          >
            Already have an account? <a
              href="/login"
              class="text-accent hover:text-accent-hover underline underline-offset-4"
              >Sign in</a
            >
          </p>
        </div>
      {:else}
        <div
          class="flex flex-col items-center text-center py-8"
          in:fly={{ y: 20 }}
        >
          <div
            class="w-20 h-20 rounded-full bg-success-bg flex items-center justify-center mb-6 border border-success/20"
          >
            <img src="https://mac-file.yaqeen.me/407C7F04-annotely_image%20%284%29.png" alt="" class="h-full w-full object-contain">

          </div>
          <h2
            class="text-2xl font-bold text-text-primary uppercase tracking-tight mb-2"
          >
            Request Received
          </h2>
          <p class="text-text-secondary text-sm mb-8 leading-relaxed">
            We've added <strong>{email}</strong> to our waitlist. We'll reach out
            as soon as we're ready for you.
          </p>
          <a href="/" class="btn btn-secondary w-full py-4"> Return Home </a>
        </div>
      {/if}
    </div>
  </div>
</div>
