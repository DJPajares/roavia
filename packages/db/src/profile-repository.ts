import {
  profileSchema,
  profileTravelPreferencesSchema,
  profileUpdateInputSchema,
  type Profile,
  type ProfileUpdateInput,
} from "@roavia/contracts";
import { eq } from "drizzle-orm";

import type { Database } from "./client.js";
import { travelProfiles, users } from "./schema.js";

type ProfileRow = {
  accessibilityNeeds: unknown[];
  defaultBudgetStyle: "budget" | "midrange" | "premium" | "luxury";
  defaultPace: "slow" | "balanced" | "fast";
  dietaryNeeds: unknown[];
  email: string | null;
  homeCountry: string | null;
  interests: unknown[];
  locale: string;
  preferredCurrency: string;
  timezone: string;
  travelPreferences: Record<string, unknown>;
  updatedAt: Date;
};

export interface ProfilePrincipal {
  authUserId: string;
  email?: string;
}

export interface ProfileRepository {
  getProfile(principal: ProfilePrincipal): Promise<Profile>;
  updateProfile(principal: ProfilePrincipal, input: ProfileUpdateInput): Promise<Profile>;
}

function displayNameFromEmail(email: string | undefined) {
  const candidate = email
    ?.split("@", 1)[0]
    ?.replace(/[._-]+/g, " ")
    .trim();
  return candidate ? candidate.slice(0, 100) : "Traveler";
}

function serializeProfile(row: ProfileRow): Profile {
  const parsedTravelPreferences = profileTravelPreferencesSchema.safeParse(row.travelPreferences);
  return profileSchema.parse({
    accessibilityNeeds: row.accessibilityNeeds,
    defaultBudgetStyle: row.defaultBudgetStyle,
    defaultPace: row.defaultPace,
    dietaryNeeds: row.dietaryNeeds,
    email: row.email,
    homeCountry: row.homeCountry,
    interests: row.interests,
    locale: row.locale,
    preferredCurrency: row.preferredCurrency,
    timezone: row.timezone,
    travelPreferences: parsedTravelPreferences.success
      ? parsedTravelPreferences.data
      : { mustAvoid: [], mustDo: [] },
    updatedAt: row.updatedAt.toISOString(),
  });
}

async function ensureProfile(db: Database, principal: ProfilePrincipal) {
  return db.transaction(async (transaction) => {
    await transaction
      .insert(users)
      .values({
        authUserId: principal.authUserId,
        displayName: displayNameFromEmail(principal.email),
      })
      .onConflictDoNothing({ target: users.authUserId });

    const [user] = await transaction
      .select()
      .from(users)
      .where(eq(users.authUserId, principal.authUserId))
      .limit(1)
      .for("update");
    if (!user) {
      throw new Error("Profile user provisioning failed.");
    }

    await transaction
      .insert(travelProfiles)
      .values({
        travelPreferences: { mustAvoid: [], mustDo: [] },
        userId: user.id,
      })
      .onConflictDoNothing({ target: travelProfiles.userId });

    const [profile] = await transaction
      .select({
        accessibilityNeeds: travelProfiles.accessibilityNeeds,
        defaultBudgetStyle: travelProfiles.defaultBudgetStyle,
        defaultPace: travelProfiles.defaultPace,
        dietaryNeeds: travelProfiles.dietaryNeeds,
        homeCountry: users.homeCountry,
        interests: travelProfiles.interests,
        locale: users.locale,
        preferredCurrency: users.preferredCurrency,
        timezone: users.timezone,
        travelPreferences: travelProfiles.travelPreferences,
        updatedAt: travelProfiles.updatedAt,
      })
      .from(travelProfiles)
      .innerJoin(users, eq(travelProfiles.userId, users.id))
      .where(eq(users.id, user.id))
      .limit(1);
    if (!profile) {
      throw new Error("Profile provisioning failed.");
    }

    return { profile, user };
  });
}

export function createProfileRepository(db: Database): ProfileRepository {
  return {
    async getProfile(principal) {
      const { profile } = await ensureProfile(db, principal);
      return serializeProfile({ ...profile, email: principal.email ?? null });
    },

    async updateProfile(principal, rawInput) {
      const input = profileUpdateInputSchema.parse(rawInput);
      const { user } = await ensureProfile(db, principal);
      const now = new Date();
      return db.transaction(async (transaction) => {
        await transaction
          .update(users)
          .set({
            homeCountry: input.homeCountry,
            locale: input.locale,
            preferredCurrency: input.preferredCurrency,
            timezone: input.timezone,
            updatedAt: now,
          })
          .where(eq(users.id, user.id));
        const [profile] = await transaction
          .update(travelProfiles)
          .set({
            accessibilityNeeds: input.accessibilityNeeds,
            defaultBudgetStyle: input.defaultBudgetStyle,
            defaultPace: input.defaultPace,
            dietaryNeeds: input.dietaryNeeds,
            interests: input.interests,
            travelPreferences: input.travelPreferences,
            updatedAt: now,
          })
          .where(eq(travelProfiles.userId, user.id))
          .returning({
            accessibilityNeeds: travelProfiles.accessibilityNeeds,
            defaultBudgetStyle: travelProfiles.defaultBudgetStyle,
            defaultPace: travelProfiles.defaultPace,
            dietaryNeeds: travelProfiles.dietaryNeeds,
            interests: travelProfiles.interests,
            travelPreferences: travelProfiles.travelPreferences,
            updatedAt: travelProfiles.updatedAt,
          });
        const [updatedUser] = await transaction
          .select({
            homeCountry: users.homeCountry,
            locale: users.locale,
            preferredCurrency: users.preferredCurrency,
            timezone: users.timezone,
          })
          .from(users)
          .where(eq(users.id, user.id))
          .limit(1);
        if (!profile || !updatedUser) {
          throw new Error("Profile update failed.");
        }
        return serializeProfile({
          ...profile,
          ...updatedUser,
          email: principal.email ?? null,
        });
      });
    },
  };
}
