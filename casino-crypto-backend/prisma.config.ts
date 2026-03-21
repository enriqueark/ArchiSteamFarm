import "dotenv/config";
import { defineConfig } from "prisma/config";

const resolveDatasourceUrl = (): string => {
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL;
  }

  // Railway can expose split Postgres env vars instead of DATABASE_URL.
  const host = process.env.PGHOST;
  const port = process.env.PGPORT;
  const database = process.env.PGDATABASE;
  const password = process.env.PGPASSWORD;
  const user = process.env.PGUSER ?? "postgres";

  if (host && port && database && password) {
    return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${database}?schema=public`;
  }

  throw new Error(
    "DATABASE_URL is required (or set PGHOST, PGPORT, PGDATABASE, PGPASSWORD, and optional PGUSER)."
  );
};

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: resolveDatasourceUrl()
  },
});
