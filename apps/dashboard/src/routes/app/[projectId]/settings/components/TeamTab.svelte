<script lang="ts">
  import { CircleNotch } from "phosphor-svelte";
  import { authClient } from "$lib/auth-client";
  import type { TeamMember } from "./types";

  let { 
    projectId,
    members: initialMembers = [],
    formatDate
  }: {
    projectId: string;
    members?: TeamMember[];
    formatDate: (date: string | number) => string;
  } = $props();

  let members = $state(initialMembers);
  let inviteEmail = $state("");
  let inviteRole = $state("member");
  let isInviting = $state(false);

  async function loadTeam() {
    const res = await authClient.organization.listMembers();
    if (res.data) {
      members = Array.isArray(res.data) ? res.data : (res.data as any).members || [];
    }
  }

  async function invite() {
    if (!inviteEmail) return;
    isInviting = true;
    try {
      await authClient.organization.inviteMember({
        email: inviteEmail,
        role: inviteRole as "member" | "admin" | "owner",
        organizationId: projectId
      });
      inviteEmail = "";
      await loadTeam();
    } catch (e) {
      console.error("Failed to invite", e);
    } finally {
      isInviting = false;
    }
  }
</script>

<div class="flex items-center justify-between mb-6">
  <h2 class="text-lg font-bold text-text-primary">Team Members</h2>
  <div class="text-xs text-text-dim">{members.length} members</div>
</div>

<div class="mb-8 bg-bg-secondary/50 border border-border rounded-lg p-4">
  <h3 class="text-sm font-bold text-text-primary mb-4">Invite New Member</h3>
  <div class="flex gap-4">
    <input 
      type="email" 
      placeholder="colleague@example.com"
      bind:value={inviteEmail}
      class="flex-[2] input min-w-0"
    />
    <select bind:value={inviteRole} class="flex-1 input min-w-[140px]">
      <option value="member">Member</option>
      <option value="admin">Admin</option>
      <option value="owner">Owner</option>
    </select>
    <button 
      class="btn btn-secondary whitespace-nowrap px-6"
      disabled={!inviteEmail || isInviting}
      onclick={invite}
    >
      {#if isInviting} <CircleNotch size={16} class="animate-spin" /> {:else} Send Invite {/if}
    </button>
  </div>
</div>

<div class="border border-border rounded-lg overflow-hidden">
  <table class="w-full text-left">
    <thead class="bg-bg-secondary border-b border-border">
      <tr>
        <th class="px-6 py-3 text-xs font-bold text-text-dim uppercase tracking-wider">User</th>
        <th class="px-6 py-3 text-xs font-bold text-text-dim uppercase tracking-wider">Role</th>
        <th class="px-6 py-3 text-xs font-bold text-text-dim uppercase tracking-wider">Joined</th>
        <th class="px-6 py-3"></th>
      </tr>
    </thead>
    <tbody class="divide-y divide-border/50">
      {#each members as member (member.id)}
        <tr>
          <td class="px-6 py-4">
            <div class="flex items-center gap-3">
              <div class="w-8 h-8 rounded-full bg-accent-light border border-accent flex items-center justify-center text-accent font-bold text-xs uppercase">
                {(member.user.name || member.user.email)[0]}
              </div>
              <div>
                <div class="text-sm font-bold text-text-primary">{member.user.name || 'Unknown'}</div>
                <div class="text-xs text-text-dim">{member.user.email}</div>
              </div>
            </div>
          </td>
          <td class="px-6 py-4">
            <span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-bg-secondary text-text-secondary border border-border capitalize">
              {member.role}
            </span>
          </td>
          <td class="px-6 py-4 text-xs text-text-dim">
            {formatDate(member.createdAt)}
          </td>
          <td class="px-6 py-4 text-right">
            <button class="text-text-dim hover:text-error transition-colors opacity-50 cursor-not-allowed" title="Not implemented">
              Remove
            </button>
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>
