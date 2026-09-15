import 'dotenv/config';
import fs from 'node:fs/promises';
import pg from 'pg';

const { Client } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required to run database migrations.');
}

const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

try {
  await client.connect();
  const schema = await fs.readFile(new URL('../schema.sql', import.meta.url), 'utf8');
  await client.query(schema);
  console.log('Database schema applied successfully.');
} finally {
  await client.end();
}
