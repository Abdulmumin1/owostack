import { DurableObject } from "cloudflare:workers";

export interface UsageLedgerRecord {
  id?: string;
  customerId: string;
  featureId: string;
  entityId?: string | null;
  amount: number;
  periodStart: number;
  periodEnd: number;
  createdAt?: number;
  invoiceId?: string | null;
}

export interface UsageSumQuery {
  customerId: string;
  featureId: string;
  periodStart?: number;
  periodEnd?: number;
  createdAtFrom?: number;
  createdAtTo?: number;
  entityId?: string | null;
  unbilledOnly?: boolean;
}

export interface MarkInvoicedQuery {
  customerId: string;
  featureId: string;
  periodStart: number;
  periodEnd: number;
  usageCutoffAt: number;
  invoiceId: string;
}

export class UsageLedgerDO extends DurableObject<Record<string, unknown>> {
  async alarm(): Promise<void> {
    // PAUSED: Pruning disabled until after prod launch
    // TODO: Re-enable prune after launch with proper retention policy
    // await this.prune();
    // this.ctx.storage.setAlarm(Date.now() + 24 * 60 * 60 * 1000);
    console.log("[UsageLedgerDO] Alarm - pruning paused for pre-launch");
  }

  private initialized = false;

  /*
   * PAUSED: Pruning disabled for pre-launch phase
   * TODO: Re-enable after prod launch with:
   * - Longer retention for unbilled records
   * - Force-billing cron to prevent infinite accumulation
   
  async prune(): Promise<{ deleted: number }> {
    this.ensureSchema();
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const cursor = this.ctx.storage.sql.exec(
      "DELETE FROM usage_records WHERE created_at < ? AND invoice_id IS NOT NULL",
      thirtyDaysAgo,
    );
    // Also delete old unbilled items just in case to prevent infinite growth
    const ninetyDaysAgo = Date.now() - 90 * 24 * 60 * 60 * 1000;
    const cursor2 = this.ctx.storage.sql.exec(
      "DELETE FROM usage_records WHERE created_at < ?",
      ninetyDaysAgo,
    );
    return { deleted: cursor.rowsWritten + cursor2.rowsWritten };
  }
  */

  /**
   * Rehydrate usage records from D1 daily aggregates
   * Called when DO starts empty to backfill recent usage data
   */
  async rehydrateFromAggregates(
    aggregates: Array<{
      customerId: string;
      featureId: string;
      date: string;
      amount: number;
      updatedAt: number;
    }>,
  ): Promise<{ inserted: number }> {
    this.ensureSchema();

    let inserted = 0;
    for (const agg of aggregates) {
      // Convert daily aggregate back to a representative usage record
      // We use the date's timestamp (start of day) as created_at
      const dateTimestamp = new Date(agg.date).getTime();

      // Check if we already have any records for this customer/feature/date
      const existingResult = this.ctx.storage.sql
        .exec<{ count: number }>(
          `SELECT COUNT(*) as count FROM usage_records 
         WHERE customer_id = ? AND feature_id = ? AND date(created_at/1000, 'unixepoch') = ?`,
          agg.customerId,
          agg.featureId,
          agg.date,
        )
        .one();

      if (existingResult.count > 0) {
        // Already have records for this day, skip to avoid duplicates
        continue;
      }

      // Insert synthetic record representing the daily aggregate
      // Using a special ID prefix to indicate this is a rehydrated aggregate
      this.ctx.storage.sql.exec(
        `INSERT INTO usage_records (
          id, customer_id, feature_id, entity_id, amount,
          period_start, period_end, invoice_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        `rehydrated-${agg.customerId}-${agg.featureId}-${agg.date}`,
        agg.customerId,
        agg.featureId,
        null, // entity_id
        agg.amount,
        dateTimestamp, // period_start
        dateTimestamp + 24 * 60 * 60 * 1000 - 1, // period_end (end of day)
        null, // invoice_id - will be marked during billing workflow
        agg.updatedAt,
      );
      inserted++;
    }

    return { inserted };
  }

  private ensureSchema(): void {
    if (this.initialized) return;

    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS usage_records (
        id TEXT PRIMARY KEY,
        customer_id TEXT NOT NULL,
        feature_id TEXT NOT NULL,
        entity_id TEXT,
        amount INTEGER NOT NULL,
        period_start INTEGER NOT NULL,
        period_end INTEGER NOT NULL,
        invoice_id TEXT,
        created_at INTEGER NOT NULL
      )
    `);

    this.ctx.storage.sql.exec(`
      CREATE INDEX IF NOT EXISTS usage_records_customer_feature_period_idx
      ON usage_records (customer_id, feature_id, period_start, period_end)
    `);

    this.ctx.storage.sql.exec(`
      CREATE INDEX IF NOT EXISTS usage_records_customer_created_idx
      ON usage_records (customer_id, created_at DESC)
    `);

    this.ctx.storage.sql.exec(`
      CREATE INDEX IF NOT EXISTS usage_records_feature_created_idx
      ON usage_records (feature_id, created_at DESC)
    `);

    this.ctx.storage.sql.exec(`
      CREATE INDEX IF NOT EXISTS usage_records_invoice_idx
      ON usage_records (invoice_id)
    `);

    this.initialized = true;

    // Schedule initial alarm if none exists
    this.ctx.storage.getAlarm().then((alarm) => {
      if (!alarm) {
        this.ctx.storage.setAlarm(Date.now() + 24 * 60 * 60 * 1000);
      }
    });
  }

  async appendUsage(record: UsageLedgerRecord): Promise<{ success: boolean }> {
    this.ensureSchema();

    this.ctx.storage.sql.exec(
      `INSERT OR IGNORE INTO usage_records
        (id, customer_id, feature_id, entity_id, amount, period_start, period_end, invoice_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      record.id || crypto.randomUUID(),
      record.customerId,
      record.featureId,
      record.entityId ?? null,
      record.amount,
      record.periodStart,
      record.periodEnd,
      record.invoiceId ?? null,
      record.createdAt ?? Date.now(),
    );

    return { success: true };
  }

  async appendUsageBatch(
    records: UsageLedgerRecord[],
  ): Promise<{ inserted: number; total: number }> {
    this.ensureSchema();

    let inserted = 0;
    for (const record of records) {
      const cursor = this.ctx.storage.sql.exec(
        `INSERT OR IGNORE INTO usage_records
          (id, customer_id, feature_id, entity_id, amount, period_start, period_end, invoice_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        record.id || crypto.randomUUID(),
        record.customerId,
        record.featureId,
        record.entityId ?? null,
        record.amount,
        record.periodStart,
        record.periodEnd,
        record.invoiceId ?? null,
        record.createdAt ?? Date.now(),
      );
      inserted += cursor.rowsWritten;
    }

    return {
      inserted,
      total: records.length,
    };
  }

  async sumUsage(query: UsageSumQuery): Promise<number> {
    this.ensureSchema();

    let sqlText = `
      SELECT COALESCE(SUM(amount), 0) AS total
      FROM usage_records
      WHERE customer_id = ?
        AND feature_id = ?
    `;
    const bindings: Array<string | number | null> = [
      query.customerId,
      query.featureId,
    ];

    if (typeof query.periodStart === "number") {
      sqlText += " AND period_start >= ?";
      bindings.push(query.periodStart);
    }
    if (typeof query.periodEnd === "number") {
      sqlText += " AND period_end <= ?";
      bindings.push(query.periodEnd);
    }
    if (typeof query.createdAtFrom === "number") {
      sqlText += " AND created_at >= ?";
      bindings.push(query.createdAtFrom);
    }
    if (typeof query.createdAtTo === "number") {
      sqlText += " AND created_at <= ?";
      bindings.push(query.createdAtTo);
    }
    if (query.entityId !== undefined) {
      if (query.entityId === null) {
        sqlText += " AND entity_id IS NULL";
      } else {
        sqlText += " AND entity_id = ?";
        bindings.push(query.entityId);
      }
    }
    if (query.unbilledOnly) {
      sqlText += " AND invoice_id IS NULL";
    }

    const row = this.ctx.storage.sql
      .exec<{ total: number }>(sqlText, ...bindings)
      .one();

    return Number(row?.total || 0);
  }

  async markInvoiced(query: MarkInvoicedQuery): Promise<{ updated: number }> {
    this.ensureSchema();

    const cursor = this.ctx.storage.sql.exec(
      `UPDATE usage_records
       SET invoice_id = ?
       WHERE customer_id = ?
         AND feature_id = ?
         AND period_start >= ?
         AND period_end <= ?
         AND invoice_id IS NULL
         AND created_at <= ?`,
      query.invoiceId,
      query.customerId,
      query.featureId,
      query.periodStart,
      query.periodEnd,
      query.usageCutoffAt,
    );

    return { updated: cursor.rowsWritten };
  }

  async sumUnbilledByFeature(customerId: string): Promise<
    Array<{
      featureId: string;
      totalUsage: number;
    }>
  > {
    this.ensureSchema();

    const rows = this.ctx.storage.sql
      .exec<{ feature_id: string; total_usage: number }>(
        `SELECT feature_id, COALESCE(SUM(amount), 0) AS total_usage
         FROM usage_records
         WHERE customer_id = ?
           AND invoice_id IS NULL
         GROUP BY feature_id`,
        customerId,
      )
      .toArray();

    return rows.map((row) => ({
      featureId: row.feature_id,
      totalUsage: Number(row.total_usage || 0),
    }));
  }

  async listRecentUsageForCustomer(
    customerId: string,
    limit: number = 20,
  ): Promise<
    Array<{
      id: string;
      featureId: string;
      amount: number;
      createdAt: number;
    }>
  > {
    this.ensureSchema();

    const rows = this.ctx.storage.sql
      .exec<{
        id: string;
        feature_id: string;
        amount: number;
        created_at: number;
      }>(
        `SELECT id, feature_id, amount, created_at
         FROM usage_records
         WHERE customer_id = ?
         ORDER BY created_at DESC
         LIMIT ?`,
        customerId,
        Math.max(1, Math.min(limit, 100)),
      )
      .toArray();

    return rows.map((row) => ({
      id: row.id,
      featureId: row.feature_id,
      amount: Number(row.amount || 0),
      createdAt: Number(row.created_at || 0),
    }));
  }

  async featureUsageSummaryForCustomer(
    customerId: string,
    createdAtFrom: number,
  ): Promise<
    Array<{
      featureId: string;
      totalUsage: number;
      recordCount: number;
    }>
  > {
    this.ensureSchema();

    const rows = this.ctx.storage.sql
      .exec<{
        feature_id: string;
        total_usage: number;
        record_count: number;
      }>(
        `SELECT feature_id,
                COALESCE(SUM(amount), 0) AS total_usage,
                COUNT(*) AS record_count
         FROM usage_records
         WHERE customer_id = ?
           AND created_at >= ?
         GROUP BY feature_id
         ORDER BY total_usage DESC`,
        customerId,
        createdAtFrom,
      )
      .toArray();

    return rows.map((row) => ({
      featureId: row.feature_id,
      totalUsage: Number(row.total_usage || 0),
      recordCount: Number(row.record_count || 0),
    }));
  }

  async featureConsumptionForOrg(
    createdAtFrom: number,
    limit: number = 10,
  ): Promise<
    Array<{
      featureId: string;
      uniqueConsumers: number;
      totalUsage: number;
    }>
  > {
    this.ensureSchema();

    const rows = this.ctx.storage.sql
      .exec<{
        feature_id: string;
        unique_consumers: number;
        total_usage: number;
      }>(
        `SELECT feature_id,
                COUNT(DISTINCT customer_id) AS unique_consumers,
                COALESCE(SUM(amount), 0) AS total_usage
         FROM usage_records
         WHERE created_at >= ?
         GROUP BY feature_id
         ORDER BY total_usage DESC
         LIMIT ?`,
        createdAtFrom,
        Math.max(1, Math.min(limit, 100)),
      )
      .toArray();

    return rows.map((row) => ({
      featureId: row.feature_id,
      uniqueConsumers: Number(row.unique_consumers || 0),
      totalUsage: Number(row.total_usage || 0),
    }));
  }

  async recentUsageForOrg(
    limit: number = 20,
    offset: number = 0,
  ): Promise<
    Array<{
      featureId: string;
      customerId: string;
      amount: number;
      createdAt: number;
    }>
  > {
    this.ensureSchema();

    const rows = this.ctx.storage.sql
      .exec<{
        feature_id: string;
        customer_id: string;
        amount: number;
        created_at: number;
      }>(
        `SELECT feature_id, customer_id, amount, created_at
         FROM usage_records
         ORDER BY created_at DESC
         LIMIT ? OFFSET ?`,
        Math.max(1, Math.min(limit, 100)),
        Math.max(0, offset),
      )
      .toArray();

    return rows.map((row) => ({
      featureId: row.feature_id,
      customerId: row.customer_id,
      amount: Number(row.amount || 0),
      createdAt: Number(row.created_at || 0),
    }));
  }

  async usageCountForOrg(): Promise<number> {
    this.ensureSchema();

    const row = this.ctx.storage.sql
      .exec<{ count: number }>("SELECT COUNT(*) AS count FROM usage_records")
      .one();
    return Number(row?.count || 0);
  }

  async usageTimeseriesForOrg(
    createdAtFrom: number,
    createdAtTo: number,
    featureId?: string | null,
    customerId?: string | null,
  ): Promise<
    Array<{
      date: string;
      featureId: string;
      totalUsage: number;
    }>
  > {
    this.ensureSchema();

    let sqlText = `
      SELECT date(created_at / 1000, 'unixepoch') AS day,
             feature_id,
             COALESCE(SUM(amount), 0) AS total_usage
      FROM usage_records
      WHERE created_at >= ? AND created_at <= ?
    `;
    const bindings: Array<string | number | null> = [createdAtFrom, createdAtTo];

    if (featureId) {
      sqlText += " AND feature_id = ?";
      bindings.push(featureId);
    }
    if (customerId) {
      sqlText += " AND customer_id = ?";
      bindings.push(customerId);
    }

    sqlText += " GROUP BY day, feature_id ORDER BY day ASC";

    const rows = this.ctx.storage.sql
      .exec<{ day: string; feature_id: string; total_usage: number }>(
        sqlText,
        ...bindings,
      )
      .toArray();

    return rows.map((row) => ({
      date: row.day,
      featureId: row.feature_id,
      totalUsage: Number(row.total_usage || 0),
    }));
  }
}
