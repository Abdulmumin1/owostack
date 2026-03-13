<script lang="ts">
  import { CircleNotch, X, PaperPlaneRight, Clock } from "phosphor-svelte";
  import { authClient } from "$lib/auth-client";
  import type { TeamMember } from "./types";

  let { 
    projectId,
    organizationId,
    members: membersProp = [],
    formatDate
  }: {
    projectId: string;
    organizationId: string;
    members?: TeamMember[];
    formatDate: (date: string | number) => string;
  } = $props();

  type PendingInvite = {
    id: string;
    email: string;
    role: string;
    organizationId: string;
    status: string;
    createdAt: string | number | Date;
    expiresAt: string | number | Date;
  };

  let members = $state<TeamMember[]>([]);
  let pendingInvites = $state<any[]>([]);
  let inviteEmail = $state("");
  let inviteRole = $state("member");
  let isInviting = $state(false);
  let isLoadingInvites = $state(false);
  let cancelingInviteId = $state<string | null>(null);
  let resendingInviteId = $state<string | null>(null);

  $effect(() => {
    members = membersProp;
  });

  $effect(() => {
    if (organizationId) {
      loadPendingInvites();
    }
  });

  async function loadTeam() {
    const res = await authClient.organization.listMembers();
    if (res.data) {
      members = Array.isArray(res.data) ? res.data : (res.data as any).members || [];
    }
  }

  async function loadPendingInvites() {
    if (!organizationId) return;
    
    isLoadingInvites = true;
    try {
      const res = await authClient.organization.listInvitations({
        query: { organizationId }
      });
      
      if (res.data) {
        let invites = res.data;
        if (!Array.isArray(res.data) && (res.data as any).invitations) {
          invites = (res.data as any).invitations;
        }
        
        pendingInvites = invites.filter((invite: PendingInvite) => {
          return invite.organizationId === organizationId && invite.status === "pending";
        });
      } else {
        pendingInvites = [];
      }
    } catch (e) {
      pendingInvites = [];
    } finally {
      isLoadingInvites = false;
    }
  }

  async function cancelInvite(invitationId: string) {
    if (!confirm("Are you sure you want to cancel this invitation?")) return;
    
    cancelingInviteId = invitationId;
    try {
      const res = await authClient.organization.cancelInvitation({
        invitationId
      });
      
      if (res.error) {
        throw new Error(res.error.message);
      }
      
      pendingInvites = pendingInvites.filter(invite => invite.id !== invitationId);
    } catch (e: any) {
      alert(e.message || "Failed to cancel invitation");
    } finally {
      cancelingInviteId = null;
    }
  }

  async function resendInvite(invitationId: string) {
    resendingInviteId = invitationId;
    try {
      // Better Auth doesn't have a direct resend method, so we cancel and recreate
      await authClient.organization.cancelInvitation({ invitationId });
      
      // Find the invite details
      const invite = pendingInvites.find(i => i.id === invitationId);
      if (!invite) throw new Error("Invitation not found");
      
      // Create new invitation
      const res = await authClient.organization.inviteMember({
        email: invite.email,
        role: invite.role,
        organizationId: organizationId
      });
      
      if (res.error) {
        throw new Error(res.error.message);
      }
      
      await loadPendingInvites();
    } catch (e: any) {
      alert(e.message || "Failed to resend invitation");
    } finally {
      resendingInviteId = null;
    }
  }

  async function invite() {
    if (!inviteEmail || !organizationId) return;
    
    isInviting = true;
    try {
      const setActiveResult = await authClient.organization.setActive({
        organizationId: organizationId
      });
      
      if (setActiveResult.error) {
        throw new Error(setActiveResult.error.message || "Failed to set active organization");
      }
      
      const inviteResult = await authClient.organization.inviteMember({
        email: inviteEmail,
        role: inviteRole as "member" | "admin" | "owner",
        organizationId: organizationId
      });
      
      if (inviteResult.error) {
        throw new Error(inviteResult.error.message || "Failed to send invitation");
      }
      
      inviteEmail = "";
      await loadTeam();
      await loadPendingInvites();
    } catch (e: any) {
      alert(e.message || "Failed to invite member. Please try again.");
    } finally {
      isInviting = false;
    }
  }
</script>

<div class="flex items-center justify-between mb-6">
<div></div>
  <div class="flex items-center gap-3">
    {#if isLoadingInvites}
      <CircleNotch size={14} class="animate-spin text-text-dim" />
    {/if}
    {#if pendingInvites.length > 0}
      <div class="text-xs text-warning font-medium">
        {pendingInvites.length} pending invitation{pendingInvites.length === 1 ? '' : 's'}
      </div>
    {/if}
    <div class="text-xs text-text-dim">{members.length} member{members.length === 1 ? '' : 's'}</div>
    <button 
      class="text-xs text-accent hover:text-accent-hover"
      onclick={loadPendingInvites}
      disabled={isLoadingInvites}
    >
      Refresh
    </button>
  </div>
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
      disabled={!inviteEmail || !organizationId || isInviting}
      onclick={invite}
      title={!organizationId ? "Loading organization data..." : "Send invitation"}
    >
      {#if isInviting} <CircleNotch size={16} class="animate-spin" /> {:else} Send Invite {/if}
    </button>
  </div>
</div>

{#if pendingInvites.length > 0}

<div class="mb-8">
  <div class="flex items-center justify-between mb-4">
    <h3 class="text-sm font-bold text-text-primary flex items-center gap-2">
      <Clock size={16} class="text-warning" />
      Pending Invitations
      <span class="text-xs font-normal text-text-dim">({pendingInvites.length})</span>
    </h3>
    {#if isLoadingInvites}
      <CircleNotch size={14} class="animate-spin text-text-dim" />
    {/if}
  </div>
  
 

  <div class="border border-border rounded-lg overflow-hidden">
    <table class="w-full text-left">
      <thead class="bg-bg-secondary border-b border-border">
        <tr>
          <th class="px-6 py-3 text-xs font-bold text-text-dim uppercase tracking-wider">Email</th>
          <th class="px-6 py-3 text-xs font-bold text-text-dim uppercase tracking-wider">Role</th>
          <th class="px-6 py-3 text-xs font-bold text-text-dim uppercase tracking-wider">Invited</th>
          <th class="px-6 py-3 text-xs font-bold text-text-dim uppercase tracking-wider">Expires</th>
          <th class="px-6 py-3"></th>
        </tr>
      </thead>
      <tbody class="divide-y divide-border/50">
        {#each pendingInvites as invite (invite.id)}
          <tr class="bg-warning-bg/30">
            <td class="px-6 py-4">
              <div class="flex items-center gap-3">
                <div class="w-8 h-8 rounded-full bg-warning-bg border border-warning flex items-center justify-center text-warning font-bold text-xs">
                  {invite.email[0].toUpperCase()}
                </div>
                <div class="text-sm font-medium text-text-primary">{invite.email}</div>
              </div>
            </td>
            <td class="px-6 py-4">
              <span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-bg-secondary text-text-secondary border border-border capitalize">
                {invite.role}
              </span>
            </td>
            <td class="px-6 py-4 text-xs text-text-dim">
              {formatDate(invite.createdAt)}
            </td>
            <td class="px-6 py-4 text-xs text-text-dim">
              {formatDate(invite.expiresAt)}
            </td>
            <td class="px-6 py-4 text-right">
              <div class="flex items-center justify-end gap-2">
                <button 
                  class="text-text-dim hover:text-accent transition-colors p-1"
                  onclick={() => resendInvite(invite.id)}
                  disabled={resendingInviteId === invite.id}
                  title="Resend invitation"
                >
                  {#if resendingInviteId === invite.id}
                    <CircleNotch size={16} class="animate-spin" />
                  {:else}
                    <PaperPlaneRight size={16} />
                  {/if}
                </button>
                <button 
                  class="text-text-dim hover:text-error transition-colors p-1"
                  onclick={() => cancelInvite(invite.id)}
                  disabled={cancelingInviteId === invite.id}
                  title="Cancel invitation"
                >
                  {#if cancelingInviteId === invite.id}
                    <CircleNotch size={16} class="animate-spin" />
                  {:else}
                    <X size={16} />
                  {/if}
                </button>
              </div>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
</div>
{/if}

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
