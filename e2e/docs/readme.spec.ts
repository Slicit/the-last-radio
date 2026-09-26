import { expect, test, type Page, type Route } from "@playwright/test";
import postgres from "postgres";
import { FEEDBACK, PEOPLE, SONGS, cover } from "./demo-data";

// Builds the README screenshots in docs/screenshots from invented demo data.
// Run with scripts/screenshots.sh (a throwaway "lastradio-demo" stack).

const OUT = "../docs/screenshots";
const PASSWORD = "demo-password-123";
test.use({ viewport: { width: 1280, height: 860 } });
test.setTimeout(240_000);

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}

/** The demo has no broadcaster: make stations look live, and fake a search. */
async function stage(page: Page) {
  // Live everywhere except Night Shift, which is closed at this hour.
  await page.route("**/api/radios/*/stream", (r: Route) => {
    const live = !r.request().url().includes("/night-shift/");
    return r.fulfill({ json: { live, readySince: live ? new Date().toISOString() : null, bytesReceived: 1, tracks: [], listeners: live ? 7 : 0, hlsUrl: "" } });
  });
  await page.route("**/api/search?**", (r: Route) =>
    r.fulfill({
      json: {
        results: SONGS.slice(4, 11).map((s, i) => ({
          videoId: `demo${i}`, sourceKey: `Youtube:demo-search-${i}`, sourceUrl: `https://www.youtube.com/watch?v=demo${i}`,
          title: `${s.artist} - ${s.title}`, artist: s.artist, durationSec: s.sec, thumbnailUrl: cover(s.title, i + 4),
          views: [1_240_000, 88_400, 3_900_000, 512_000, 27_300, 640_000, 9_100][i], source: "youtube",
        })),
      },
    }),
  );
}

test("README screenshots", async ({ browser, baseURL }) => {
  // ---------------------------------------------------------------- seed
  const api = await (await browser.newContext()).request;
  for (const p of PEOPLE) await api.post(`${baseURL}/api/auth/register`, { data: { ...p, password: PASSWORD, acceptPrivacy: true } });
  const admin = await browser.newContext();
  const ap = await admin.newPage();
  await signIn(ap, PEOPLE[0].email);
  const R = ap.request;
  await R.post("/api/radios", { data: { slug: "main", name: "Main Stage", description: "Everything, all day long", rateLimitCount: 3, rateLimitWindowSec: 600 } });
  await R.post("/api/radios", { data: { slug: "night-shift", name: "Night Shift", description: "Slow songs after dark", hoursEnabled: true, hoursDays: [0, 1, 2, 3, 4, 5, 6], hoursStart: "20:00", hoursEnd: "02:00", timezone: "Europe/Paris" } });
  await R.post("/api/radios", { data: { slug: "team-room", name: "Team Room", description: "Our office radio", isPrivate: true } });
  await R.post("/api/radios", { data: { slug: "focus", name: "Focus", description: "Instrumentals for deep work" } });
  await R.post("/api/radios/team-room/domains", { data: { domain: "demo.radio" } });

  const sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
  const users = Object.fromEntries((await sql`select id, display_name from users`).map((u) => [u.display_name, u.id]));
  // Everyone confirmed their email but Noor, so the station editor shows both.
  await sql`update users set email_verified_at = now() where email <> ${PEOPLE[4].email}`;
  const radios = Object.fromEntries((await sql`select id, slug from radios`).map((r) => [r.slug, r.id]));
  const tracks: string[] = [];
  for (const [i, s] of SONGS.entries()) {
    const [t] = await sql`insert into tracks (source_key, source_url, title, artist, duration_sec, thumbnail_url)
      values (${`Youtube:demo${i}`}, ${`https://www.youtube.com/watch?v=demo${i}`}, ${`${s.artist} - ${s.title}`}, ${s.artist}, ${s.sec}, ${cover(s.title, i)})
      on conflict (source_key) do update set title = excluded.title returning id`;
    tracks.push(t.id);
  }
  const names = PEOPLE.map((p) => p.displayName);
  const who = (i: number) => users[names[i % names.length]];
  // History: two days of plays, a couple voted off.
  for (let h = 0; h < 40; h++) {
    const t = tracks[(h * 7) % tracks.length];
    const at = new Date(Date.now() - (h + 1) * 4.2 * 60_000);
    const votedOff = h === 5 || h === 17;
    const [item] = await sql`insert into queue_items (radio_id, track_id, user_id, is_fill, status, skip_reason, created_at, started_at, ended_at)
      values (${radios.main}, ${t}, ${h % 6 === 3 ? null : who(h)}, ${h % 6 === 3}, ${votedOff ? "skipped" : "played"}, ${votedOff ? "votes" : null}, ${at}, ${at}, ${at}) returning id`;
    if (votedOff) for (const v of [1, 2, 3]) await sql`insert into skip_votes (queue_item_id, user_id) values (${item.id}, ${who(v)}) on conflict do nothing`;
  }
  // On air and lined up.
  await sql`insert into queue_items (radio_id, track_id, user_id, status, created_at, started_at) values (${radios.main}, ${tracks[0]}, ${users.Maya}, 'playing', now() - interval '3 minutes', now() - interval '94 seconds')`;
  for (const [i, t] of [tracks[2], tracks[5], tracks[9]].entries()) {
    await sql`insert into queue_items (radio_id, track_id, user_id, created_at) values (${radios.main}, ${t}, ${who(i + 2)}, now() - make_interval(secs => ${60 - i * 10}))`;
  }
  for (const t of [tracks[12], tracks[14]]) await sql`insert into queue_items (radio_id, track_id, user_id, is_fill) values (${radios.main}, ${t}, null, true)`;
  for (const [slug, t] of [["focus", tracks[7]], ["team-room", tracks[11]]] as const) {
    await sql`insert into queue_items (radio_id, track_id, user_id, status, started_at) values (${radios[slug]}, ${t}, ${users.Jules}, 'playing', now() - interval '40 seconds')`;
  }
  for (const [i, f] of FEEDBACK.entries()) {
    await sql`insert into feedback (user_id, kind, body, created_at, read_at) values (${who(i + 1)}, ${f.kind}, ${f.body}, now() - make_interval(mins => ${i * 50 + 12}), ${i === 2 ? sql`now()` : null})`;
  }
  // A month of listener counts, every 5 minutes: invented daily rhythms per
  // station (midday and evening for Main Stage, office hours for Team Room
  // and Focus, late evenings for Night Shift), growing a little over time.
  await sql`
    insert into listener_samples (radio_id, at, listeners)
    select r.id, g.at, greatest(0, round(
      (0.75 + 0.25 * extract(epoch from g.at - (now() - interval '30 days')) / (30 * 86400)) *
      case r.slug
        when 'main' then (3 + 11 * exp(-power((p.h - 13) / 3.5, 2)) + 8 * exp(-power((p.h - 20.5) / 2.2, 2))) * (case when p.dow >= 6 then 0.75 else 1 end) + random() * 3 - 1.5
        when 'night-shift' then case when p.h >= 20 or p.h < 2 then 2 + 7 * exp(-power((case when p.h < 2 then p.h + 24 else p.h end - 23) / 1.6, 2)) + random() * 2 else 0 end
        when 'team-room' then case when p.dow <= 5 and p.h >= 9 and p.h < 18 then 4 + 4 * exp(-power((p.h - 11) / 2, 2)) + 3 * exp(-power((p.h - 15.5) / 1.5, 2)) + random() * 2 else 0 end
        else case when p.h >= 8.5 and p.h < 19 then (case when p.dow >= 6 then 1 else 3 end) + 2 * sin((p.h - 8.5) / 10.5 * pi()) + random() * 1.5 else random() * 0.8 end
      end))::int
    from radios r
    cross join generate_series(date_trunc('hour', now()) - interval '30 days', now() - interval '5 minutes', interval '5 minutes') as g(at)
    cross join lateral (select
      extract(hour from g.at at time zone 'Europe/Paris') + extract(minute from g.at at time zone 'Europe/Paris') / 60.0 as h,
      extract(isodow from g.at at time zone 'Europe/Paris') as dow) p
    on conflict do nothing`;
  await sql.end();

  // ---------------------------------------------------------------- shots
  const shot = async (page: Page, name: string, fullPage = false) => {
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${OUT}/${name}.png`, fullPage });
  };

  const maya = await browser.newContext({ viewport: { width: 1280, height: 860 }, colorScheme: "dark" });
  const mp = await maya.newPage();
  await stage(mp);
  await signIn(mp, PEOPLE[1].email);
  await mp.goto("/");
  await expect(mp.getByText("Team Room")).toBeVisible();
  await shot(mp, "home");

  await mp.goto("/r/main");
  await expect(mp.getByText("Midnight Ferry").first()).toBeVisible();
  await shot(mp, "station");

  const box = mp.getByRole("combobox", { name: "Search for a song" });
  await box.fill("glass orchard");
  await expect(mp.getByRole("option").first()).toBeVisible();
  await shot(mp, "search");
  await box.press("Escape");

  await mp.getByRole("tab", { name: "Songs" }).click();
  await mp.getByRole("radio", { name: "Crowd favourites" }).click();
  await mp.waitForTimeout(800);
  await mp.request.patch("/api/me", { data: { theme: "light" }, headers: { origin: baseURL! } });
  await mp.reload();
  await mp.getByRole("tab", { name: "Songs" }).click();
  await mp.getByRole("radio", { name: "Crowd favourites" }).click();
  await mp.evaluate(() => window.scrollTo(0, 360));
  await shot(mp, "songs-light");

  await mp.request.patch("/api/me", { data: { theme: "vintage" }, headers: { origin: baseURL! } });
  await mp.goto("/r/main");
  await expect(mp.getByText("Midnight Ferry").first()).toBeVisible();
  await shot(mp, "station-vintage");

  await mp.goto("/connect");
  await shot(mp, "connect");
  await mp.request.patch("/api/me", { data: { theme: "night" }, headers: { origin: baseURL! } });

  // Admin: feedback and stations; the station editor.
  await stage(ap);
  await ap.goto("/admin");
  await expect(ap.getByText("unread")).toBeVisible();
  await shot(ap, "admin");
  // Listeners over time: all stations and each, hovering the busiest evening.
  const listeners = ap.locator("[data-slot=card]", { has: ap.getByText("People listening, counted every 5 minutes") });
  await expect(listeners.getByRole("region", { name: "All stations" })).toBeVisible();
  await listeners.scrollIntoViewIfNeeded();
  const chart = listeners.getByRole("region", { name: "All stations" }).locator("svg");
  const cbox = (await chart.boundingBox())!;
  await ap.mouse.move(cbox.x + cbox.width * 0.79, cbox.y + cbox.height / 2);
  await ap.waitForTimeout(400);
  await listeners.screenshot({ path: `${OUT}/listeners.png` });

  // Moving a station: the import dialog, with a file exported from Main Stage.
  const exported = await R.get("/api/radios/main/export");
  await ap.mouse.move(0, 0);
  await ap.evaluate(() => window.scrollTo(0, 0));
  await ap.getByRole("button", { name: "Import" }).click();
  const dialog = ap.getByRole("dialog", { name: "Import a station" });
  await dialog.getByLabel("Station file").setInputFiles({ name: "main-2026-09-26.lastradio.json", mimeType: "application/json", buffer: await exported.body() });
  await expect(dialog.getByLabel("Address")).toHaveValue("main-2");
  await dialog.getByLabel("Name").fill("Main Stage (from the test radio)");
  await dialog.getByLabel("Address").fill("main-stage");
  await shot(ap, "import");
  await ap.keyboard.press("Escape");

  await ap.goto("/admin/stations/team-room");
  await expect(ap.getByText("@demo.radio")).toBeVisible();
  await ap.evaluate(() => window.scrollTo(0, document.getElementById("access")!.offsetTop - 90));
  await shot(ap, "station-editor");

  // Phone.
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: "dark" });
  const pp = await phone.newPage();
  await stage(pp);
  await signIn(pp, PEOPLE[3].email);
  await pp.goto("/r/main");
  await expect(pp.getByText("Midnight Ferry").first()).toBeVisible();
  await shot(pp, "mobile");
});
