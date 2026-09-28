// Optional features an instance can turn off in its .env (read when the server starts).

/**
 * Station export and import (lib/station-transfer.ts). Export files name the
 * people in a station's history with their emails, so a radio may prefer not
 * to offer it at all: STATION_TRANSFER=off. The privacy notice follows.
 */
export const stationTransferEnabled = () => (process.env.STATION_TRANSFER ?? "on").toLowerCase() !== "off";
