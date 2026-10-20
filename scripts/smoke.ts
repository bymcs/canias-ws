import { CaniasClient, CaniasError, configFromEnv } from "../src/index.js";

const client = new CaniasClient(configFromEnv());

try {
  const services = await client.listServices();
  console.log(`Login OK. ${services.length} service(s) visible to this user.`);
  for (const name of services.slice(0, 50)) {
    console.log(`- ${name}`);
  }
  if (services.length > 50) {
    console.log(`... and ${services.length - 50} more`);
  }
} catch (error) {
  if (error instanceof CaniasError) {
    console.error(`[${error.code}] ${error.message}`);
  } else {
    console.error(error);
  }
  process.exitCode = 1;
} finally {
  await client.close();
}
