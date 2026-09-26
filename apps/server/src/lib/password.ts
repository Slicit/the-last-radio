import { hash, verify } from "@node-rs/argon2";

// argon2id with the library defaults (19 MiB memory, 2 passes, 1 lane: the
// OWASP baseline). Each hash embeds its own random 16-byte salt, stored in the
// PHC string: $argon2id$v=19$m=19456,t=2,p=1$<salt>$<hash>.
export const hashPassword = (password: string) => hash(password);

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false; // malformed hash: never a match
  }
}
