import { describe, expect, it, vi, afterEach } from "vitest";
import { call, createStation, register } from "./helpers.js";

// specs/features/listening.feature
describe("Listening", () => {
  afterEach(() => vi.useRealTimers());

  it("Listener counts come from the players themselves", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-26T12:00:00Z"));
    const alex = await register("Alex");
    const st = await createStation(alex);
    await call("POST", `/api/radios/${st.slug}/listen`, { body: { listenerId: "browser-one" } });
    await call("POST", `/api/radios/${st.slug}/listen`, { body: { listenerId: "browser-one" } });
    await call("POST", `/api/radios/${st.slug}/listen`, { body: { listenerId: "browser-two" } });
    expect((await call("GET", `/api/radios/${st.slug}`)).json.listeners).toBe(2);
    vi.setSystemTime(new Date("2026-09-26T12:00:46Z"));
    expect((await call("GET", `/api/radios/${st.slug}`)).json.listeners).toBe(0);
  });

  it("One network can't inflate the listener count", async () => {
    const alex = await register("Alex");
    const st = await createStation(alex);
    for (let i = 0; i < 8; i++) {
      await call("POST", `/api/radios/${st.slug}/listen`, { ip: "10.9.9.9", body: { listenerId: `fake-listener-${i}` } });
    }
    expect((await call("GET", `/api/radios/${st.slug}`)).json.listeners).toBe(5);
  });
});
