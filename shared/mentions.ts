import { z } from "zod";
import { IssueCardSchema } from "./lific";

/** Timeline row listing the Lific issues an agent mentioned during a turn. */
export const MENTIONS_KIND = "mentions";
export const MENTIONS_VERSION = 1;

export const MentionsSchema = z.object({ issues: z.array(IssueCardSchema) });
