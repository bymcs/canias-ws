// apps/web/src/server/canias.ts
import "server-only";

import { CaniasClient } from "canias-ws";

let client: CaniasClient | undefined;

/** Server-only singleton. Never import this from a client component. */
export function getCanias(): CaniasClient {
  client ??= new CaniasClient({
    url: process.env.CANIAS_WS_URL!,
    client: process.env.CANIAS_WS_CLIENT ?? "00",
    language: process.env.CANIAS_WS_LANGUAGE ?? "T",
    dbServer: process.env.CANIAS_WS_DB_SERVER!,
    dbName: process.env.CANIAS_WS_DB_NAME!,
    applicationServer: process.env.CANIAS_WS_APP_SERVER!,
    username: process.env.CANIAS_WS_USER!,
    password: process.env.CANIAS_WS_PASSWORD!,
  });
  return client;
}
