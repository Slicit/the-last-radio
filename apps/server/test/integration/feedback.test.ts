import { describe, expect, it } from "vitest";
import { call, ORIGIN, register } from "./helpers.js";

const send = (who: { cookie: string }, body: string, kind = "idea") =>
  call("POST", "/api/feedback", { cookie: who.cookie, origin: ORIGIN, body: { kind, body } });

// specs/features/feedback.feature
describe("Feedback", () => {
  it("Sending feedback", async () => {
    await register("Alex");
    const sam = await register("Sam");
    const r = await send(sam, "Please add a dark mode toggle");
    expect(r.status).toBe(201);
    expect(r.json.allowance).toMatchObject({ limit: 3, remaining: 2 });
    const mine = await call("GET", "/api/feedback/mine", { cookie: sam.cookie });
    expect(mine.json.items[0]).toMatchObject({ kind: "idea", read: false, archived: false });
  });

  it("Three messages a day", async () => {
    const sam = await register("Sam");
    for (let i = 0; i < 3; i++) expect((await send(sam, `Idea number ${i}: more jazz`)).status).toBe(201);
    const fourth = await send(sam, "Idea number 4: even more jazz");
    expect(fourth.status).toBe(429);
    expect(fourth.json.error).toMatch(/^You've sent 3 messages today, thank you! You can send another in ~\d+ h\.$/);
    expect((await call("GET", "/api/feedback/mine", { cookie: sam.cookie })).json.allowance.remaining).toBe(0);
  });

  it("Messages have to say something", async () => {
    const sam = await register("Sam");
    expect((await send(sam, "meh")).status).toBe(400);
    expect((await send(sam, "x".repeat(2001))).status).toBe(400);
  });

  it("Admins triage feedback", async () => {
    const alex = await register("Alex");
    const sam = await register("Sam");
    await send(sam, "The volume slider is too small on phones", "bug");
    const inbox = await call("GET", "/api/admin/feedback", { cookie: alex.cookie });
    expect(inbox.json.unread).toBe(1);
    const id = inbox.json.items[0].id;
    expect((await call("POST", `/api/admin/feedback/${id}/vote`, { cookie: alex.cookie, origin: ORIGIN, body: { value: 1 } })).json).toEqual({ score: 1, myVote: 1 });
    await call("PATCH", `/api/admin/feedback/${id}`, { cookie: alex.cookie, origin: ORIGIN, body: { archived: true } });
    const archived = await call("GET", "/api/admin/feedback?view=archived", { cookie: alex.cookie });
    expect(archived.json.items[0]).toMatchObject({ id, score: 1, read: true, archived: true });
    expect(archived.json.unread).toBe(0);
    const mine = await call("GET", "/api/feedback/mine", { cookie: sam.cookie });
    expect(mine.json.items[0]).toMatchObject({ read: true, archived: true });
  });

  it("Feedback is private", async () => {
    await register("Alex");
    const sam = await register("Sam");
    const kim = await register("Kim");
    await send(sam, "Sam's private thoughts on the radio");
    expect((await call("GET", "/api/feedback/mine", { cookie: kim.cookie })).json.items).toEqual([]);
    expect((await call("GET", "/api/admin/feedback", { cookie: kim.cookie })).status).toBe(403);
  });
});
