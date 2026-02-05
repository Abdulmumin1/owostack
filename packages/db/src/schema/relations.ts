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
