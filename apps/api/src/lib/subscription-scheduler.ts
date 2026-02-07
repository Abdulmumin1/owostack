import { DurableObject } from "cloudflare:workers";
import type { PaystackEnvironment } from "./environment";

/**
 * Convert hex string to Uint8Array
 */
function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

interface ScheduledTask {
  subscriptionId: string;
  customerId: string;
  planId: string;
  organizationId: string;
  environment: PaystackEnvironment; // Which Paystack environment to use
  action: "trial_end" | "renewal" | "downgrade";
  scheduledAt: number;
  metadata?: Record<string, unknown>;
}

interface Env {
  DB: D1Database;
  DB_AUTH: D1Database;
  ENCRYPTION_KEY: string;
}

/**
 * SubscriptionSchedulerDO - Handles scheduled subscription tasks
 * 
 * Tasks:
 * - Trial expiration: Convert trialing -> active and charge card
 * - Subscription renewal reminders
 * - Grace period handling
 */
export class SubscriptionSchedulerDO extends DurableObject<Env> {
  private tasks: Map<string, ScheduledTask> = new Map();
  private initialized = false;

  private async init(): Promise<void> {
    if (this.initialized) return;

    const stored = await this.ctx.storage.get<Record<string, ScheduledTask>>("tasks");
    if (stored) {
      this.tasks = new Map(Object.entries(stored));
    }

    this.initialized = true;
  }

  /**
   * Schedule a trial end task
   */
  async scheduleTrialEnd(
    subscriptionId: string,
    customerId: string,
    planId: string,
    organizationId: string,
    environment: PaystackEnvironment,
    trialEndTime: number,
    metadata?: Record<string, unknown>
  ): Promise<{ success: boolean }> {
    await this.init();

    const task: ScheduledTask = {
      subscriptionId,
      customerId,
      planId,
      organizationId,
      environment,
      action: "trial_end",
      scheduledAt: trialEndTime,
      metadata,
    };

    this.tasks.set(subscriptionId, task);
    await this.persist();

    // Schedule alarm for the trial end time
    await this.scheduleNextAlarm();

    return { success: true };
  }

  /**
   * Schedule a downgrade to execute at period end
   */
  async scheduleDowngrade(
    subscriptionId: string,
    customerId: string,
    newPlanId: string,
    organizationId: string,
    environment: PaystackEnvironment,
    executeAt: number,
    metadata?: Record<string, unknown>
  ): Promise<{ success: boolean }> {
    await this.init();

    const task: ScheduledTask = {
      subscriptionId,
      customerId,
      planId: newPlanId, // The plan to downgrade TO
      organizationId,
      environment,
      action: "downgrade",
      scheduledAt: executeAt,
      metadata,
    };

    this.tasks.set(`downgrade-${subscriptionId}`, task);
    await this.persist();
    await this.scheduleNextAlarm();

    return { success: true };
  }

  /**
   * Cancel a scheduled task
   */
  async cancelTask(subscriptionId: string): Promise<{ success: boolean }> {
    await this.init();

    // Delete both direct key and downgrade-prefixed key
    this.tasks.delete(subscriptionId);
    this.tasks.delete(`downgrade-${subscriptionId}`);
    await this.persist();

    return { success: true };
  }

  /**
   * Get all pending tasks
   */
  async getPendingTasks(): Promise<ScheduledTask[]> {
    await this.init();
    return Array.from(this.tasks.values());
  }

  /**
   * Alarm handler - processes due tasks
   */
  async alarm(): Promise<void> {
    await this.init();

    const now = Date.now();
    const dueTasks: Array<{ key: string; task: ScheduledTask }> = [];

    // Collect due tasks with their original keys, then delete
    for (const [key, task] of this.tasks) {
      if (task.scheduledAt <= now) {
        dueTasks.push({ key, task });
      }
    }
    console.log(`[SCHEDULER] Alarm fired: ${dueTasks.length} due task(s) out of ${this.tasks.size} total`);
    for (const { key } of dueTasks) {
      this.tasks.delete(key);
    }

    // Process each due task
    for (const { key, task } of dueTasks) {
      try {
        await this.processTask(task);
      } catch (error) {
        console.error(`Failed to process task for subscription ${task.subscriptionId}:`, error);
        // Re-schedule failed task for retry (1 hour later) — preserve original key
        task.scheduledAt = now + 60 * 60 * 1000;
        this.tasks.set(key, task);
      }
    }

    await this.persist();

    // Schedule next alarm if there are remaining tasks
    if (this.tasks.size > 0) {
      await this.scheduleNextAlarm();
    }
  }

  /**
   * Process a single task
   */
  private async processTask(task: ScheduledTask): Promise<void> {
    switch (task.action) {
      case "trial_end":
        await this.handleTrialEnd(task);
        break;
      case "downgrade":
        await this.handleDowngrade(task);
        break;
      case "renewal":
        // Future: handle renewal reminders
        break;
    }
  }

  /**
   * Handle trial end - charge the customer's saved card
   * Fetches the org's Paystack secret key from project config
   */
  private async handleTrialEnd(task: ScheduledTask): Promise<void> {
    console.log(`[SCHEDULER] handleTrialEnd fired: subscription=${task.subscriptionId}, plan=${task.planId}, customer=${task.customerId}, scheduledAt=${new Date(task.scheduledAt).toISOString()}`);
    const authorizationCode = task.metadata?.authorization_code as string | undefined;
    const email = task.metadata?.email as string | undefined;
    const amount = task.metadata?.amount as number | undefined;

    if (!authorizationCode || !email || !amount) {
      console.log(`[SCHEDULER] No card on file for trial end — expiring subscription=${task.subscriptionId}, hasAuth=${!!authorizationCode}, hasEmail=${!!email}, hasAmount=${!!amount}`);
      // No card to charge — mark subscription as expired
      try {
        await this.env.DB.prepare(
          `UPDATE subscriptions SET status = 'expired', updated_at = ? WHERE id = ?`
        ).bind(Date.now(), task.subscriptionId).run();
        console.log(`[SCHEDULER] Subscription expired: ${task.subscriptionId}`);
      } catch (dbErr) {
        console.error(`[SCHEDULER] Failed to expire subscription=${task.subscriptionId}:`, dbErr);
      }
      return;
    }

    // Fetch the org's Paystack secret key from project config using task's environment
    const paystackSecretKey = await this.getOrgPaystackKey(task.organizationId, task.environment);
    
    if (!paystackSecretKey) {
      console.error(`No Paystack secret key found for org ${task.organizationId}`);
      return;
    }

    try {
      // Charge the authorization
      const response = await fetch("https://api.paystack.co/transaction/charge_authorization", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${paystackSecretKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          authorization_code: authorizationCode,
          email,
          amount: amount.toString(),
          metadata: {
            subscription_id: task.subscriptionId,
            plan_id: task.planId,
            customer_id: task.customerId,
            organization_id: task.organizationId,
            trial_conversion: true,
          },
        }),
      });

      const data = await response.json() as { status: boolean; message: string };

      if (!response.ok || !data.status) {
        console.error(`[SCHEDULER] Charge FAILED for trial end: subscription=${task.subscriptionId}, message=${data.message}`);
        // The webhook will handle updating subscription status based on charge result
      } else {
        console.log(`[SCHEDULER] Charge SUCCESS for trial end: subscription=${task.subscriptionId}, message=${data.message}`);
      }

      // Success - webhook will handle subscription activation
      console.log(`[SCHEDULER] Trial conversion charge initiated for subscription=${task.subscriptionId}, email=${email}, amount=${amount}`);
    } catch (error) {
      console.error(`Error charging authorization:`, error);
      throw error; // Will trigger retry
    }
  }

  /**
   * Handle scheduled downgrade — cancel old sub, create new one on the target plan
   */
  private async handleDowngrade(task: ScheduledTask): Promise<void> {
    const now = Date.now();
    const oldPlanId = task.metadata?.old_plan_id as string | undefined;

    try {
      // 1. Cancel the old subscription in DB
      await this.env.DB.prepare(
        `UPDATE subscriptions SET status = 'canceled', canceled_at = ?, updated_at = ? WHERE id = ?`
      ).bind(now, now, task.subscriptionId).run();

      // 2. Cancel on Paystack if applicable
      const paystackSubCode = task.metadata?.paystack_subscription_code as string | undefined;
      if (paystackSubCode && paystackSubCode !== "one-time" && !paystackSubCode.startsWith("trial-")) {
        const paystackKey = await this.getOrgPaystackKey(task.organizationId, task.environment);
        if (paystackKey) {
          try {
            // Fetch email_token needed to disable
            const fetchRes = await fetch(`https://api.paystack.co/subscription/${encodeURIComponent(paystackSubCode)}`, {
              headers: { Authorization: `Bearer ${paystackKey}` },
            });
            const fetchData = await fetchRes.json() as { status: boolean; data?: { email_token: string } };
            if (fetchData.status && fetchData.data?.email_token) {
              await fetch("https://api.paystack.co/subscription/disable", {
                method: "POST",
                headers: { Authorization: `Bearer ${paystackKey}`, "Content-Type": "application/json" },
                body: JSON.stringify({ code: paystackSubCode, token: fetchData.data.email_token }),
              });
            }
          } catch (e) {
            console.warn("Failed to cancel Paystack sub during downgrade:", e);
          }
        }
      }

      // 3. Fetch the new plan details for period calculation
      const newPlan = await this.env.DB.prepare(
        `SELECT id, interval FROM plans WHERE id = ? LIMIT 1`
      ).bind(task.planId).first<{ id: string; interval: string }>();

      const periodMs = this.intervalToMs(newPlan?.interval || "monthly");

      // 4. Create new Paystack subscription for the downgraded plan (if applicable)
      let newPaystackSubCode: string | null = null;
      const customerEmail = task.metadata?.customer_email as string | undefined;
      const customerAuthCode = task.metadata?.customer_authorization_code as string | undefined;
      const newPlanPaystackId = task.metadata?.new_plan_paystack_id as string | undefined;

      if (newPlanPaystackId && customerEmail && customerAuthCode) {
        const paystackKey = await this.getOrgPaystackKey(task.organizationId, task.environment);
        if (paystackKey) {
          try {
            const createRes = await fetch("https://api.paystack.co/subscription", {
              method: "POST",
              headers: { Authorization: `Bearer ${paystackKey}`, "Content-Type": "application/json" },
              body: JSON.stringify({
                customer: customerEmail,
                plan: newPlanPaystackId,
                authorization: customerAuthCode,
              }),
            });
            const createData = await createRes.json() as { status: boolean; data?: { subscription_code: string } };
            if (createData.status && createData.data?.subscription_code) {
              newPaystackSubCode = createData.data.subscription_code;
            }
          } catch (e) {
            console.warn("Failed to create Paystack sub for downgrade:", e);
          }
        }
      }

      // 5. Create new DB subscription on the downgrade plan (idempotent — check first)
      const existingNewSub = await this.env.DB.prepare(
        `SELECT id FROM subscriptions WHERE customer_id = ? AND plan_id = ? AND status = 'active' LIMIT 1`
      ).bind(task.customerId, task.planId).first<{ id: string }>();

      if (!existingNewSub) {
        const newSubId = crypto.randomUUID();
        await this.env.DB.prepare(
          `INSERT INTO subscriptions (id, customer_id, plan_id, paystack_subscription_code, status, current_period_start, current_period_end, metadata, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)`
        ).bind(
          newSubId,
          task.customerId,
          task.planId,
          newPaystackSubCode,
          now,
          now + periodMs,
          JSON.stringify({ switched_from: oldPlanId || task.subscriptionId, switch_type: "downgrade" }),
          now,
          now,
        ).run();
      }

      // 5. Provision entitlements: remove old, add new
      if (oldPlanId) {
        const oldFeatures = await this.env.DB.prepare(
          `SELECT feature_id FROM plan_features WHERE plan_id = ?`
        ).bind(oldPlanId).all<{ feature_id: string }>();
        for (const row of oldFeatures.results) {
          await this.env.DB.prepare(
            `DELETE FROM entitlements WHERE customer_id = ? AND feature_id = ?`
          ).bind(task.customerId, row.feature_id).run();
        }
      }

      const newFeatures = await this.env.DB.prepare(
        `SELECT feature_id, limit_value, reset_interval, reset_on_enable FROM plan_features WHERE plan_id = ?`
      ).bind(task.planId).all<{ feature_id: string; limit_value: number | null; reset_interval: string; reset_on_enable: number }>();

      for (const pf of newFeatures.results) {
        await this.env.DB.prepare(
          `INSERT INTO entitlements (id, customer_id, feature_id, limit_value, reset_interval, last_reset_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          crypto.randomUUID(),
          task.customerId,
          pf.feature_id,
          pf.limit_value,
          pf.reset_interval,
          pf.reset_on_enable ? now : null,
          now,
          now,
        ).run();
      }

      console.log(`Downgrade executed: sub ${task.subscriptionId} → plan ${task.planId}`);
    } catch (error) {
      console.error(`Failed to execute downgrade for sub ${task.subscriptionId}:`, error);
      throw error; // Triggers retry
    }
  }

  private intervalToMs(interval: string): number {
    switch (interval) {
      case "hourly": return 60 * 60 * 1000;
      case "daily": return 24 * 60 * 60 * 1000;
      case "weekly": return 7 * 24 * 60 * 60 * 1000;
      case "monthly": return 30 * 24 * 60 * 60 * 1000;
      case "quarterly": return 90 * 24 * 60 * 60 * 1000;
      case "biannually": case "semi_annual": return 180 * 24 * 60 * 60 * 1000;
      case "annually": case "yearly": return 365 * 24 * 60 * 60 * 1000;
      default: return 30 * 24 * 60 * 60 * 1000;
    }
  }

  /**
   * Fetch and decrypt the organization's Paystack secret key from project config
   */
  private async getOrgPaystackKey(organizationId: string, environment: PaystackEnvironment): Promise<string | null> {
    try {
      // Query the project config for this org (projects live in shared auth DB)
      const result = await this.env.DB_AUTH.prepare(
        `SELECT test_secret_key, live_secret_key 
         FROM projects 
         WHERE organization_id = ? 
         LIMIT 1`
      ).bind(organizationId).first<{
        test_secret_key: string | null;
        live_secret_key: string | null;
      }>();

      if (!result) {
        console.error(`No project found for org ${organizationId}`);
        return null;
      }

      // Use the environment from the task (set at time of trial creation)
      const encryptedKey = environment === "live" 
        ? result.live_secret_key 
        : result.test_secret_key;

      if (!encryptedKey) {
        console.error(`No ${environment} Paystack key configured for org ${organizationId}`);
        return null;
      }

      // Decrypt the key
      return await this.decrypt(encryptedKey);
    } catch (error) {
      console.error(`Error fetching Paystack key for org ${organizationId}:`, error);
      return null;
    }
  }

  /**
   * Decrypt an encrypted string using the encryption key
   */
  private async decrypt(encryptedData: string): Promise<string> {
    const [ivHex, encryptedHex] = encryptedData.split(":");
    const iv = hexToBytes(ivHex);
    const encrypted = hexToBytes(encryptedHex);

    const keyData = new TextEncoder().encode(this.env.ENCRYPTION_KEY.padEnd(32, "0").slice(0, 32));
    const key = await crypto.subtle.importKey(
      "raw",
      keyData,
      { name: "AES-GCM" },
      false,
      ["decrypt"]
    );

    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      encrypted
    );

    return new TextDecoder().decode(decrypted);
  }

  /**
   * Schedule the next alarm for the soonest task
   */
  private async scheduleNextAlarm(): Promise<void> {
    if (this.tasks.size === 0) return;

    let soonest = Infinity;
    for (const task of this.tasks.values()) {
      if (task.scheduledAt < soonest) {
        soonest = task.scheduledAt;
      }
    }

    if (soonest !== Infinity) {
      const currentAlarm = await this.ctx.storage.getAlarm();
      if (!currentAlarm || soonest < currentAlarm) {
        await this.ctx.storage.setAlarm(soonest);
      }
    }
  }

  /**
   * Persist tasks to storage
   */
  private async persist(): Promise<void> {
    await this.ctx.storage.put("tasks", Object.fromEntries(this.tasks));
  }
}
