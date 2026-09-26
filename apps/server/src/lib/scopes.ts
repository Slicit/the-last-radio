/** What an API key or OAuth token may do, with the wording shown on the consent page. */
export const SCOPES = {
  "radio:read": "See stations, what's playing, queues, song stats and search",
  "radio:write": "Add songs, downvote and skip your own songs",
} as const;
export type Scope = keyof typeof SCOPES;
export const isScope = (s: string): s is Scope => s in SCOPES;
