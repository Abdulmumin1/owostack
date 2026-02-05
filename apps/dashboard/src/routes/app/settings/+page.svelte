<script lang="ts">
  import { User, Mail, LogOut } from "lucide-svelte";
  import { useSession, authClient } from "$lib/auth-client";
  import { goto } from "$app/navigation";

  const session = useSession();

  async function handleLogout() {
    await authClient.signOut();
    window.location.href = "/login";
  }
</script>

<svelte:head>
  <title>Settings - Owostack</title>
</svelte:head>

<div class="max-w-2xl">
  <div class="mb-8">
    <h1 class="text-xl font-bold text-white mb-2 uppercase tracking-wide">Account Settings</h1>
    <p class="text-zinc-500 text-xs font-mono">
      Manage your profile
    </p>
  </div>

  <div class="bg-bg-card border border-border p-6 mb-8 shadow-md">
    <h3 class="text-sm font-bold text-white mb-6 uppercase tracking-wider border-b border-border pb-2">
      Profile
    </h3>

    {#if $session.data}
      <div class="space-y-6">
        <div>
          <p class="block text-xs font-bold text-zinc-500 uppercase tracking-widest mb-2">Full Name</p>
          <div class="flex items-center gap-3 text-white bg-bg-secondary p-3 border border-border">
            <User size={16} class="text-zinc-500" />
            <span class="font-mono text-sm">{$session.data.user.name}</span>
          </div>
        </div>

        <div>
          <p class="block text-xs font-bold text-zinc-500 uppercase tracking-widest mb-2">Email Address</p>
          <div class="flex items-center gap-3 text-white bg-bg-secondary p-3 border border-border">
            <Mail size={16} class="text-zinc-500" />
            <span class="font-mono text-sm">{$session.data.user.email}</span>
          </div>
        </div>
      </div>
    {:else}
      <p class="text-zinc-500 animate-pulse">Loading profile...</p>
    {/if}
  </div>

  <div class="bg-bg-card border border-border p-6 shadow-md">
    <h3 class="text-sm font-bold text-white mb-6 uppercase tracking-wider border-b border-border pb-2">
      Session
    </h3>

    <button
      class="btn border border-red-900/30 text-red-500 hover:bg-red-900/20 w-full justify-between group shadow-none"
      onclick={handleLogout}
    >
      <span>Sign Out</span>
      <LogOut size={16} class="group-hover:text-red-400" />
    </button>
  </div>
</div>