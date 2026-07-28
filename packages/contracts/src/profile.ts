import { z } from "zod";

const COUNTRY_PATTERN = /^[A-Z]{2}$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;

function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

function uniqueValues(values: string[]) {
  return new Set(values.map((value) => value.toLocaleLowerCase("en"))).size === values.length;
}

function hasMutationField(value: Record<string, unknown>) {
  return Object.keys(value).length > 0;
}

export const profileLocaleSchema = z.string().trim().min(2).max(35);
export const profileTimeZoneSchema = z.string().trim().min(1).max(100).refine(isTimeZone, {
  message: "Invalid IANA time zone.",
});
export const profileCountrySchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(COUNTRY_PATTERN)
  .nullable();
export const profileCurrencySchema = z.string().trim().toUpperCase().regex(CURRENCY_PATTERN);
export const profileBudgetStyleSchema = z.enum(["budget", "midrange", "premium", "luxury"]);
export const profilePaceSchema = z.enum(["slow", "balanced", "fast"]);
export const profilePreferenceListSchema = z
  .array(z.string().trim().min(1).max(100))
  .max(20)
  .refine(uniqueValues, { message: "Preference values must not be duplicated." });
export const profileTravelPreferencesSchema = z.object({
  mustAvoid: profilePreferenceListSchema.default([]),
  mustDo: profilePreferenceListSchema.default([]),
});

export const profileSchema = z.object({
  accessibilityNeeds: profilePreferenceListSchema,
  defaultBudgetStyle: profileBudgetStyleSchema,
  defaultPace: profilePaceSchema,
  dietaryNeeds: profilePreferenceListSchema,
  email: z.string().email().nullable(),
  homeCountry: profileCountrySchema,
  interests: profilePreferenceListSchema,
  locale: profileLocaleSchema,
  preferredCurrency: profileCurrencySchema,
  timezone: profileTimeZoneSchema,
  travelPreferences: profileTravelPreferencesSchema,
  updatedAt: z.string().datetime({ offset: true }),
});

export const profileUpdateInputSchema = z
  .object({
    accessibilityNeeds: profilePreferenceListSchema.optional(),
    defaultBudgetStyle: profileBudgetStyleSchema.optional(),
    defaultPace: profilePaceSchema.optional(),
    dietaryNeeds: profilePreferenceListSchema.optional(),
    homeCountry: profileCountrySchema.optional(),
    interests: profilePreferenceListSchema.optional(),
    locale: profileLocaleSchema.optional(),
    preferredCurrency: profileCurrencySchema.optional(),
    timezone: profileTimeZoneSchema.optional(),
    travelPreferences: profileTravelPreferencesSchema.optional(),
  })
  .refine(hasMutationField, { message: "At least one profile field must be updated." });

const profileApiMetaSchema = z.object({ requestId: z.string().uuid() });

export const profileResponseSchema = z.object({
  data: profileSchema,
  meta: profileApiMetaSchema,
});

export type Profile = z.infer<typeof profileSchema>;
export type ProfileUpdateInput = z.infer<typeof profileUpdateInputSchema>;
export type ProfileResponse = z.infer<typeof profileResponseSchema>;
