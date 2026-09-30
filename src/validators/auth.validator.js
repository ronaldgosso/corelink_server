import { z } from "zod";

/*
|--------------------------------------------------------------------------
| LinkedIn OAuth Code Schema
|--------------------------------------------------------------------------
*/

export const linkedinAuthSchema = z.object({
  code: z
    .string()
    .min(1, "LinkedIn authorization code is required"),

  state: z
    .string()
    .min(1, "OAuth state is required")
    .optional(),
});