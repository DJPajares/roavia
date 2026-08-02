import { z } from "zod";

export const httpsUrlSchema = z.url().superRefine((value, context) => {
  const url = new URL(value);
  if (url.protocol !== "https:") {
    context.addIssue({ code: "custom", message: "External URLs must use HTTPS." });
  }
  if (url.username || url.password) {
    context.addIssue({ code: "custom", message: "External URLs must not contain credentials." });
  }
});
