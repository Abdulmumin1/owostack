<script lang="ts">
  import { CircleNotch, X, PaperPlaneRight, Clock, Users, UserPlus } from "phosphor-svelte";
  import { authClient } from "$lib/auth-client";
  import { toast } from "svelte-sonner";
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
      toast.success("Invitation cancelled");
    } catch (e: any) {
      toast.error("Failed to cancel invitation", {
        description: e.message || "Unknown error"
      });
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
      toast.success("Invitation resent", {
        description: `New invitation sent to ${invite.email}`
      });
    } catch (e: any) {
      toast.error("Failed to resend invitation", {
        description: e.message || "Unknown error"
      });
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
      toast.success("Invitation sent", {
        description: `Invitation sent to ${inviteEmail}`
      });
    } catch (e: any) {
      toast.error("Failed to invite member", {
        description: e.message || "Please try again"
      });
    } finally {
      isInviting = false;
    }
  }
</script>

<div class="space-y-10">
  <!-- Invite Form Section -->
  <div class="bg-bg-card border border-border rounded-xl p-6">
    <div class="flex items-center gap-2 mb-6">
      <div class="w-8 h-8 rounded-lg bg-accent/10 border border-accent/20 flex items-center justify-center text-accent">
        <UserPlus size={18} weight="duotone" />
      </div>
      <div>
        <h3 class="text-sm font-bold text-text-primary">Invite New Member</h3>
        <p class="text-[11px] text-text-dim uppercase tracking-wider font-medium">Add colleagues to your organization</p>
      </div>
    </div>

    <div class="flex flex-col sm:flex-row gap-3">
      <div class="flex-[2] relative">
        <input 
          type="email" 
          placeholder="colleague@example.com"
          bind:value={inviteEmail}
          class="input !h-10 pr-10"
        />
        {#if inviteEmail}
          <button 
            class="absolute right-3 top-1/2 -translate-y-1/2 text-text-dim hover:text-text-primary transition-colors"
            onclick={() => inviteEmail = ""}
          >
            <X size={14} weight="bold" />
          </button>
        {/if}
      </div>
      <div class="flex-1 min-w-[120px]">
        <select bind:value={inviteRole} class="input !h-10">
          <option value="member">Member</option>
          <option value="admin">Admin</option>
          <option value="owner">Owner</option>
        </select>
      </div>
      <button 
        class="btn btn-primary px-6 h-10"
        disabled={!inviteEmail || !organizationId || isInviting}
        onclick={invite}
      >
        {#if isInviting} 
          <CircleNotch size={16} class="animate-spin" /> 
        {:else} 
          Send Invite 
        {/if}
      </button>
    </div>
  </div>

  <!-- Pending Invites Section -->
  {#if pendingInvites.length > 0}
    <div>
      <div class="flex items-center justify-between mb-4 px-1">
        <h3 class="text-[10px] font-bold text-text-primary uppercase tracking-widest flex items-center gap-2">
          <Clock size={12} class="text-warning" weight="bold" />
          Pending Invitations
          <span class="text-text-dim ml-1">({pendingInvites.length})</span>
        </h3>
        {#if isLoadingInvites}
          <CircleNotch size={12} class="animate-spin text-text-dim" />
        {/if}
      </div>

      <div class="grid gap-2">
        {#each pendingInvites as invite (invite.id)}
          <div class="group relative overflow-hidden rounded-lg border border-border bg-bg-card hover:border-border-strong transition-all px-4 py-3 flex items-center justify-between">
            <div class="absolute inset-y-0 left-0 w-1 bg-warning/40"></div>
            
            <div class="flex items-center gap-3 min-w-0">
              <div class="w-9 h-9 rounded-full bg-warning-bg border border-warning/20 flex items-center justify-center text-warning font-bold text-xs shrink-0">
                {invite.email[0].toUpperCase()}
              </div>
              <div class="flex flex-col min-w-0">
                <div class="flex items-center gap-2">
                  <span class="text-sm font-semibold text-text-primary truncate">{invite.email}</span>
                  <span class="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-widest bg-bg-secondary text-text-secondary border border-border">
                    {invite.role}
                  </span>
                </div>
                <div class="flex items-center gap-3 mt-0.5">
                  <span class="text-[10px] text-text-dim">
                    Invited {formatDate(invite.createdAt)}
                  </span>
                  <span class="w-1 h-1 rounded-full bg-border"></span>
                  <span class="text-[10px] text-text-dim">
                    Expires {formatDate(invite.expiresAt)}
                  </span>
                </div>
              </div>
            </div>

            <div class="flex items-center gap-2 shrink-0 ml-4">
              <button 
                class="btn btn-muted btn-sm h-8 gap-1.5 px-3"
                onclick={() => resendInvite(invite.id)}
                disabled={resendingInviteId === invite.id}
              >
                {#if resendingInviteId === invite.id}
                  <CircleNotch size={12} class="animate-spin" />
                  Resending
                {:else}
                  <PaperPlaneRight size={12} weight="bold" />
                  Resend
                {/if}
              </button>
              <button 
                class="btn btn-ghost btn-sm h-8 gap-1.5 px-3 text-error hover:bg-error/5"
                onclick={() => cancelInvite(invite.id)}
                disabled={cancelingInviteId === invite.id}
              >
                {#if cancelingInviteId === invite.id}
                  <CircleNotch size={12} class="animate-spin" />
                  Canceling
                {:else}
                  <X size={12} weight="bold" />
                  Cancel
                {/if}
              </button>
            </div>
          </div>
        {/each}
      </div>
    </div>
  {/if}

  <!-- Active Members Section -->
  <div>
    <div class="flex items-center justify-between mb-4 px-1">
      <h3 class="text-[10px] font-bold text-text-primary uppercase tracking-widest flex items-center gap-2">
        <Users size={12} class="text-accent" weight="bold" />
        Active Members
        <span class="text-text-dim ml-1">({members.length})</span>
      </h3>
      <button 
        class="text-[10px] font-bold text-accent uppercase tracking-widest hover:text-accent-hover transition-colors"
        onclick={loadTeam}
      >
        Refresh List
      </button>
    </div>

    <div class="table-container !overflow-visible">
      <table class="w-full text-left">
        <thead>
          <tr>
            <th class="px-6 py-3">Member</th>
            <th class="px-6 py-3">Role</th>
            <th class="px-6 py-3">Joined</th>
            <th class="px-6 py-3"></th>
          </tr>
        </thead>
        <tbody class="divide-y divide-border/30">
          {#each members as member (member.id)}
            <tr class="group">
              <td class="px-6 py-4">
                <div class="flex items-center gap-3">
                  <div class="w-9 h-9 rounded-full bg-accent-light border border-accent/20 flex items-center justify-center text-accent font-bold text-xs uppercase shrink-0">
                    {(member.user.name || member.user.email)[0]}
                  </div>
                  <div class="min-w-0">
                    <div class="text-sm font-bold text-text-primary truncate">{member.user.name || 'Unknown'}</div>
                    <div class="text-xs text-text-dim truncate">{member.user.email}</div>
                  </div>
                </div>
              </td>
              <td class="px-6 py-4">
                <span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-widest bg-bg-secondary text-text-secondary border border-border">
                  {member.role}
                </span>
              </td>
              <td class="px-6 py-4 text-xs text-text-dim">
                {formatDate(member.createdAt)}
              </td>
              <td class="px-6 py-4 text-right">
                <button class="text-[10px] font-bold text-text-dim hover:text-error uppercase tracking-widest transition-colors opacity-0 group-hover:opacity-100 disabled:opacity-20 disabled:cursor-not-allowed" title="Not implemented" disabled>
                  Remove
                </button>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </div>
</div>
