import { relations } from "drizzle-orm";
import { users, sessions, accounts } from "./auth";
import { organizations, members, invitations, projects } from "./organizations";
import { apiKeys } from "./api-keys";
import {
  customers,
  plans,
  features,
  planFeatures,
  subscriptions,
  providerAccounts,
  providerRules,
  entitlements,
  usageRecords,
  credits,
  events,
  rewards,
  referralPrograms,
  referralCodes,
  referralRedemptions,
  creditSystems,
  creditSystemFeatures,
  creditPacks,
  creditPurchases,
  creditSystemBalances,
  invoices,
  invoiceItems,
  paymentAttempts,
  overageSettings,
  customerOverageLimits,
  paymentMethods,
} from "./billing";

/**
 * Drizzle ORM Relations
 */

// Auth relations
export const usersRelations = relations(users, ({ many }) => ({
  sessions: many(sessions),
  accounts: many(accounts),
  memberships: many(members),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, {
    fields: [sessions.userId],
    references: [users.id],
  }),
}));

export const accountsRelations = relations(accounts, ({ one }) => ({
  user: one(users, {
    fields: [accounts.userId],
    references: [users.id],
  }),
}));

// Organization relations
export const organizationsRelations = relations(organizations, ({ many }) => ({
  members: many(members),
  invitations: many(invitations),
  projects: many(projects),
  // Billing entities
  customers: many(customers),
  plans: many(plans),
  features: many(features),
  events: many(events),
  apiKeys: many(apiKeys),
  providerAccounts: many(providerAccounts),
  providerRules: many(providerRules),
  // Rewards & Referrals
  rewards: many(rewards),
  referralPrograms: many(referralPrograms),
  creditSystems: many(creditSystems),
}));

export const creditSystemsRelations = relations(
  creditSystems,
  ({ one, many }) => ({
    organization: one(organizations, {
      fields: [creditSystems.organizationId],
      references: [organizations.id],
    }),
    features: many(creditSystemFeatures),
  }),
);

export const creditSystemFeaturesRelations = relations(
  creditSystemFeatures,
  ({ one }) => ({
    creditSystem: one(creditSystems, {
      fields: [creditSystemFeatures.creditSystemId],
      references: [creditSystems.id],
    }),
    feature: one(features, {
      fields: [creditSystemFeatures.featureId],
      references: [features.id],
    }),
  }),
);

export const membersRelations = relations(members, ({ one }) => ({
  organization: one(organizations, {
    fields: [members.organizationId],
    references: [organizations.id],
  }),
  user: one(users, {
    fields: [members.userId],
    references: [users.id],
  }),
}));

export const invitationsRelations = relations(invitations, ({ one }) => ({
  organization: one(organizations, {
    fields: [invitations.organizationId],
    references: [organizations.id],
  }),
  invitedByUser: one(users, {
    fields: [invitations.invitedBy],
    references: [users.id],
  }),
}));

export const projectsRelations = relations(projects, ({ one }) => ({
  organization: one(organizations, {
    fields: [projects.organizationId],
    references: [organizations.id],
  }),
}));

// API Key relations
export const apiKeysRelations = relations(apiKeys, ({ one }) => ({
  organization: one(organizations, {
    fields: [apiKeys.organizationId],
    references: [organizations.id],
  }),
}));

// Billing relations
export const customersRelations = relations(customers, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [customers.organizationId],
    references: [organizations.id],
  }),
  subscriptions: many(subscriptions),
  entitlements: many(entitlements),
  usageRecords: many(usageRecords),
  credits: many(credits),
  invoices: many(invoices),
}));

export const plansRelations = relations(plans, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [plans.organizationId],
    references: [organizations.id],
  }),
  planFeatures: many(planFeatures),
  subscriptions: many(subscriptions),
}));

export const featuresRelations = relations(features, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [features.organizationId],
    references: [organizations.id],
  }),
  planFeatures: many(planFeatures),
  entitlements: many(entitlements),
  usageRecords: many(usageRecords),
}));

export const planFeaturesRelations = relations(planFeatures, ({ one }) => ({
  plan: one(plans, {
    fields: [planFeatures.planId],
    references: [plans.id],
  }),
  feature: one(features, {
    fields: [planFeatures.featureId],
    references: [features.id],
  }),
}));

export const subscriptionsRelations = relations(subscriptions, ({ one }) => ({
  customer: one(customers, {
    fields: [subscriptions.customerId],
    references: [customers.id],
  }),
  plan: one(plans, {
    fields: [subscriptions.planId],
    references: [plans.id],
  }),
}));

export const paymentMethodsRelations = relations(
  paymentMethods,
  ({ one }) => ({
    customer: one(customers, {
      fields: [paymentMethods.customerId],
      references: [customers.id],
    }),
    organization: one(organizations, {
      fields: [paymentMethods.organizationId],
      references: [organizations.id],
    }),
  }),
);

export const providerAccountsRelations = relations(
  providerAccounts,
  ({ one }) => ({
    organization: one(organizations, {
      fields: [providerAccounts.organizationId],
      references: [organizations.id],
    }),
  }),
);

export const providerRulesRelations = relations(providerRules, ({ one }) => ({
  organization: one(organizations, {
    fields: [providerRules.organizationId],
    references: [organizations.id],
  }),
}));

export const entitlementsRelations = relations(entitlements, ({ one }) => ({
  customer: one(customers, {
    fields: [entitlements.customerId],
    references: [customers.id],
  }),
  feature: one(features, {
    fields: [entitlements.featureId],
    references: [features.id],
  }),
}));

export const usageRecordsRelations = relations(usageRecords, ({ one }) => ({
  customer: one(customers, {
    fields: [usageRecords.customerId],
    references: [customers.id],
  }),
  feature: one(features, {
    fields: [usageRecords.featureId],
    references: [features.id],
  }),
}));

export const creditsRelations = relations(credits, ({ one }) => ({
  customer: one(customers, {
    fields: [credits.customerId],
    references: [customers.id],
  }),
}));

export const creditPacksRelations = relations(creditPacks, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [creditPacks.organizationId],
    references: [organizations.id],
  }),
  creditSystem: one(creditSystems, {
    fields: [creditPacks.creditSystemId],
    references: [creditSystems.id],
  }),
  purchases: many(creditPurchases),
}));

export const creditPurchasesRelations = relations(creditPurchases, ({ one }) => ({
  customer: one(customers, {
    fields: [creditPurchases.customerId],
    references: [customers.id],
  }),
  creditPack: one(creditPacks, {
    fields: [creditPurchases.creditPackId],
    references: [creditPacks.id],
  }),
  creditSystem: one(creditSystems, {
    fields: [creditPurchases.creditSystemId],
    references: [creditSystems.id],
  }),
}));

export const creditSystemBalancesRelations = relations(creditSystemBalances, ({ one }) => ({
  customer: one(customers, {
    fields: [creditSystemBalances.customerId],
    references: [customers.id],
  }),
  creditSystem: one(creditSystems, {
    fields: [creditSystemBalances.creditSystemId],
    references: [creditSystems.id],
  }),
}));

export const eventsRelations = relations(events, ({ one }) => ({
  organization: one(organizations, {
    fields: [events.organizationId],
    references: [organizations.id],
  }),
  customer: one(customers, {
    fields: [events.customerId],
    references: [customers.id],
  }),
}));

// Rewards & Referrals relations
export const rewardsRelations = relations(rewards, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [rewards.organizationId],
    references: [organizations.id],
  }),
  referralPrograms: many(referralPrograms),
}));

export const referralProgramsRelations = relations(
  referralPrograms,
  ({ one, many }) => ({
    organization: one(organizations, {
      fields: [referralPrograms.organizationId],
      references: [organizations.id],
    }),
    reward: one(rewards, {
      fields: [referralPrograms.rewardId],
      references: [rewards.id],
    }),
    referralCodes: many(referralCodes),
  }),
);

export const referralCodesRelations = relations(
  referralCodes,
  ({ one, many }) => ({
    program: one(referralPrograms, {
      fields: [referralCodes.programId],
      references: [referralPrograms.id],
    }),
    customer: one(customers, {
      fields: [referralCodes.customerId],
      references: [customers.id],
    }),
    redemptions: many(referralRedemptions),
  }),
);

export const referralRedemptionsRelations = relations(
  referralRedemptions,
  ({ one }) => ({
    code: one(referralCodes, {
      fields: [referralRedemptions.codeId],
      references: [referralCodes.id],
    }),
    redeemer: one(customers, {
      fields: [referralRedemptions.redeemerId],
      references: [customers.id],
    }),
  }),
);

// Invoice relations
export const invoicesRelations = relations(invoices, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [invoices.organizationId],
    references: [organizations.id],
  }),
  customer: one(customers, {
    fields: [invoices.customerId],
    references: [customers.id],
  }),
  subscription: one(subscriptions, {
    fields: [invoices.subscriptionId],
    references: [subscriptions.id],
  }),
  items: many(invoiceItems),
  paymentAttempts: many(paymentAttempts),
}));

export const invoiceItemsRelations = relations(invoiceItems, ({ one }) => ({
  invoice: one(invoices, {
    fields: [invoiceItems.invoiceId],
    references: [invoices.id],
  }),
  feature: one(features, {
    fields: [invoiceItems.featureId],
    references: [features.id],
  }),
}));

export const paymentAttemptsRelations = relations(paymentAttempts, ({ one }) => ({
  invoice: one(invoices, {
    fields: [paymentAttempts.invoiceId],
    references: [invoices.id],
  }),
}));

export const overageSettingsRelations = relations(overageSettings, ({ one }) => ({
  organization: one(organizations, {
    fields: [overageSettings.organizationId],
    references: [organizations.id],
  }),
}));

export const customerOverageLimitsRelations = relations(customerOverageLimits, ({ one }) => ({
  customer: one(customers, {
    fields: [customerOverageLimits.customerId],
    references: [customers.id],
  }),
  organization: one(organizations, {
    fields: [customerOverageLimits.organizationId],
    references: [organizations.id],
  }),
}));
