import { beforeEach } from "vitest";
import { sql } from "../../src/db/index.js";

beforeEach(async () => {
  await sql.unsafe(`truncate users, sessions, radios, tracks, queue_items, skip_votes, avatars, radio_members, radio_domains, email_tokens,
    api_tokens, oauth_clients, oauth_codes, feedback, feedback_votes restart identity cascade`);
});
