// Messages that mean the source is gone for good (as opposed to a hiccup).
const GONE = [
  /video unavailable/i,
  /private video/i,
  /has been removed/i,
  /account .* terminated/i,
  /no longer available/i,
  /not available in your country/i,
  /this video is not available/i,
  /copyright/i,
  /\b(404|410)\b/,
  /not found/i,
  /unsupported url/i,
];

export const looksGone = (message: string) => GONE.some((re) => re.test(message));
