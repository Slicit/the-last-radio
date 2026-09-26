// Invented artists, titles and artwork for README screenshots: nothing here
// belongs to anyone, so the pictures can be shared freely.

const palettes = [
  ["#ff6b6b", "#5f27cd"], ["#48dbfb", "#0abde3"], ["#feca57", "#ff9f43"], ["#1dd1a1", "#10ac84"],
  ["#ff9ff3", "#f368e0"], ["#54a0ff", "#2e86de"], ["#c8d6e5", "#576574"], ["#ee5253", "#222f3e"],
  ["#00d2d3", "#01a3a4"], ["#5f27cd", "#341f97"], ["#ff793f", "#b33939"], ["#33d9b2", "#218c74"],
];

/** A square gradient "cover" with the song's initials, as a data URI. */
export function cover(title: string, i: number): string {
  const [a, b] = palettes[i % palettes.length];
  const initials = title.split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="300" height="300" fill="url(#g)"/><circle cx="${60 + ((i * 47) % 180)}" cy="${80 + ((i * 31) % 140)}" r="${40 + (i % 5) * 12}" fill="#fff" opacity=".15"/><text x="150" y="175" font-family="Helvetica,Arial,sans-serif" font-size="92" font-weight="700" fill="#fff" text-anchor="middle" opacity=".92">${initials}</text></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

export const SONGS: { title: string; artist: string; sec: number }[] = [
  { title: "Midnight Ferry", artist: "Neon Harbor", sec: 243 },
  { title: "Paper Satellites", artist: "The Lanterns", sec: 211 },
  { title: "Velvet Static", artist: "Moth & Mirror", sec: 276 },
  { title: "Coastline Radio", artist: "Juniper Days", sec: 198 },
  { title: "Glass Orchard", artist: "Echo Valley", sec: 304 },
  { title: "Summer in Reverse", artist: "Polaroid Kids", sec: 227 },
  { title: "Northbound", artist: "Atlas Fields", sec: 262 },
  { title: "Honey Circuit", artist: "Mira Vale", sec: 189 },
  { title: "Low Tide Parade", artist: "The Driftwoods", sec: 251 },
  { title: "Electric Orchids", artist: "Sable Rivers", sec: 233 },
  { title: "Slow Motion Skyline", artist: "Night Arcade", sec: 288 },
  { title: "Tin Can Telephone", artist: "Little Comets", sec: 174 },
  { title: "Amber Hours", artist: "Wren & Willow", sec: 239 },
  { title: "静かな夜 (Quiet Night)", artist: "Kōri", sec: 256 },
  { title: "Cassette Hearts", artist: "Vinyl Ghosts", sec: 207 },
  { title: "Harbor Lights", artist: "Neon Harbor", sec: 222 },
];

export const PEOPLE = [
  { displayName: "Alex", email: "alex@demo.radio" },
  { displayName: "Maya", email: "maya@demo.radio" },
  { displayName: "Jules", email: "jules@demo.radio" },
  { displayName: "Sam", email: "sam@demo.radio" },
  { displayName: "Noor", email: "noor@demo.radio" },
];

export const FEEDBACK = [
  { kind: "idea", body: "Could we get a 'focus' station with only instrumental songs for work hours?" },
  { kind: "bug", body: "On my phone the volume slider is hard to grab while the keyboard is open." },
  { kind: "idea", body: "Love Alfred's picks! Maybe show why he chose a song?" },
];
