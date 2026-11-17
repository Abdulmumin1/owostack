import { schema, createDb } from "@owostack/db";
import { autoAssignPlansToNewCustomer } from "./customer-auto-plans";
import {
  resolveCustomerByEmail,
  resolveCustomerByExternalId,
} from "./customer-resolution";

type DB = ReturnType<typeof createDb>;
type Customer = typeof schema.customers.$inferSelect;

export type ExplicitCustomerMatchBy = "externalId" | "email";

export class CustomerIdentityConflictError extends Error {
  readonly name = "CustomerIdentityConflictError";

  constructor(message: string) {
    super(message);
  }
}

function isUniqueConstraintError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const message = "message" in error ? String(error.message) : "";
  return /unique constraint failed|constraint failed/i.test(message);
}

export async function createOrMatchCustomer(params: {
  db: DB;
  organizationId: string;
  matchBy: ExplicitCustomerMatchBy;
  externalId?: string;
  email: string;
  name?: string;
  metadata?: Record<string, unknown>;
  autoApplyPlansOnCreate?: boolean;
}): Promise<{
  customer: Customer;
  created: boolean;
  matchedBy: ExplicitCustomerMatchBy;
}> {
  const email = params.email.toLowerCase();
  const resolution =
    params.matchBy === "externalId"
      ? await resolveCustomerByExternalId({
          db: params.db,
          organizationId: params.organizationId,
          customerId: params.externalId!,
        })
      : await resolveCustomerByEmail({
          db: params.db,
          organizationId: params.organizationId,
          email,
        });

  if (resolution) {
    return {
      customer: resolution.customer,
      created: false,
      matchedBy: params.matchBy,
    };
  }

  const now = Date.now();
  const newCustomer = {
    id: crypto.randomUUID(),
    organizationId: params.organizationId,
    providerId: null,
    externalId: params.matchBy === "externalId" ? params.externalId! : null,
    email,
    name: params.name || email.split("@")[0],
    metadata: params.metadata || null,
    createdAt: now,
    updatedAt: now,
  };

  try {
    await params.db.insert(schema.customers).values(newCustomer);
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;

    const concurrentMatch =
      params.matchBy === "externalId"
        ? await resolveCustomerByExternalId({
            db: params.db,
            organizationId: params.organizationId,
            customerId: params.externalId!,
          })
        : await resolveCustomerByEmail({
            db: params.db,
            organizationId: params.organizationId,
            email,
          });

    if (concurrentMatch) {
      return {
        customer: concurrentMatch.customer,
        created: false,
        matchedBy: params.matchBy,
      };
    }

    throw new CustomerIdentityConflictError(
      `Email '${email}' already belongs to a different customer. Refusing to match it to external ID '${params.externalId}'. Use matchBy: 'email' only after authenticating ownership of that email.`,
    );
  }

  const customer = newCustomer as Customer;
  if (params.autoApplyPlansOnCreate) {
    await autoAssignPlansToNewCustomer({
      db: params.db,
      organizationId: params.organizationId,
      customerId: customer.id,
    });
  }

  return { customer, created: true, matchedBy: params.matchBy };
}
