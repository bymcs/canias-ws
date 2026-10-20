import { CaniasClient } from "canias-ws";

const client = new CaniasClient({
  url: "http://host:8080/CaniasWS-v2/services/CaniasWebService",
  client: "00",
  language: "T",
  dbServer: "DBS",
  dbName: "DB",
  applicationServer: "APP",
  username: process.env.CANIAS_WS_USER ?? "",
  password: process.env.CANIAS_WS_PASSWORD ?? "",
});

console.log("services:", await client.listServices());

// One login, many calls. Replace MY_SERVICE with a service from the list.
await client.withSession(async (active) => {
  const first = await active.call("MY_SERVICE", ["first"]);
  console.log(`first:  ok=${first.ok} ${first.sysStatusError || first.value}`);

  const second = await active.call("MY_SERVICE", ["second"]);
  console.log(`second: ok=${second.ok} ${second.sysStatusError || second.value}`);
});

await client.close();
