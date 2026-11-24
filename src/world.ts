// The town's weather, season and light: pure functions of the date, so the
// same day looks the same for everyone (seeded by the date, not by chance).
import { seeded } from "./model.ts";

export type Weather = "clear" | "cloudy" | "rain" | "windy" | "fog";
export type Season = "spring" | "summer" | "autumn" | "winter";

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;

/** The season by month (northern-hemisphere months). */
export function seasonOf(d: Date): Season {
  const m = d.getMonth();
  return m >= 2 && m <= 4 ? "spring" : m >= 5 && m <= 7 ? "summer" : m >= 8 && m <= 10 ? "autumn" : "winter";
}

/**
 * The day's weather, from a seed of the date. Fog only on some mornings
 * (it lifts by ten); rain is rarer in summer; winter rain falls as snow.
 */
export function weatherOf(d: Date): Weather {
  const rnd = seeded(`weather-${dayKey(d)}`);
  const season = seasonOf(d);
  const r = rnd();
  const rain = season === "summer" ? 0.1 : 0.18;
  let w: Weather = r < 0.45 ? "clear" : r < 0.68 ? "cloudy" : r < 0.68 + rain ? "rain" : r < 0.9 ? "windy" : "fog";
  if (w === "fog" && d.getHours() >= 10) w = "cloudy";
  return w;
}

/** How hard the wind blows, 0..1 (trees sway with it). */
export function windOf(w: Weather): number {
  return w === "windy" ? 1 : w === "rain" ? 0.6 : w === "cloudy" ? 0.35 : w === "fog" ? 0.05 : 0.2;
}

/**
 * The light over the town as a continuous wash (not four steps): the
 * multiplied colour and how strongly, and whether lamps and windows are on.
 */
export function lightAt(d: Date, dark: boolean): { color: number; alpha: number; lamps: boolean } {
  if (dark) return { color: 0x1c2a5a, alpha: 0.62, lamps: true };
  const h = d.getHours() + d.getMinutes() / 60;
  // Keys through the day: [hour, colour, alpha].
  const keys: [number, number, number][] = [
    [0, 0x1c2a5a, 0.62], [5, 0x1c2a5a, 0.6], [6.5, 0xffc7b5, 0.28], [8.5, 0xffffff, 0],
    [16.5, 0xffffff, 0], [18.5, 0xff9f62, 0.3], [20, 0x2a3266, 0.55], [24, 0x1c2a5a, 0.62],
  ];
  let i = 0;
  while (i < keys.length - 2 && h >= keys[i + 1]![0]) i++;
  const [h0, c0, a0] = keys[i]!, [h1, c1, a1] = keys[i + 1]!;
  const t = Math.min(1, Math.max(0, (h - h0) / (h1 - h0)));
  const mix = (a: number, b: number, s: number) => Math.round(a + (b - a) * s);
  const ch = (c: number, k: number) => (c >> k) & 0xff;
  const color = (mix(ch(c0, 16), ch(c1, 16), t) << 16) | (mix(ch(c0, 8), ch(c1, 8), t) << 8) | mix(ch(c0, 0), ch(c1, 0), t);
  return { color, alpha: a0 + (a1 - a0) * t, lamps: h >= 18 || h < 6.5 };
}

/** How many townspeople are out, 0..1, by the hour (a quiet night is quiet). */
export function streetLife(d: Date, dark: boolean): number {
  const h = d.getHours() + d.getMinutes() / 60;
  if (h < 6 || h >= 23) return dark ? 0.2 : 0.15; // a night owl or two
  if (h < 8) return 0.35;
  if (h < 20) return 1;
  return 0.4;
}
