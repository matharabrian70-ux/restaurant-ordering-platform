import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';

const { Client } = pg;

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required to run database migrations.');

const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

try {
  await client.connect();
  await client.query(`create table if not exists schema_migrations (
    version text primary key,
    applied_at timestamptz not null default now()
  )`);
  await client.query('select pg_advisory_lock(hashtext($1))',['restaurant-ordering-schema-migrations']);
  try {
    const dir=new URL('./migrations/',import.meta.url);
    const names=(await fs.readdir(dir)).filter(name=>/^\\d+_.+\\.sql$/.test(name)).sort();
    for(const name of names){
      const version=name.split('_')[0];
      const exists=await client.query('select 1 from schema_migrations where version=$1',[version]);
      if(exists.rowCount)continue;
      const sql=await fs.readFile(new URL(name,dir),'utf8');
      await client.query('begin');
      try{
        await client.query(sql);
        await client.query('insert into schema_migrations(version) values($1)',[version]);
        await client.query('commit');
        console.log(`Applied migration ${name}`);
      }catch(error){
        await client.query('rollback');
        throw error;
      }
    }
  } finally {
    await client.query('select pg_advisory_unlock(hashtext($1))',['restaurant-ordering-schema-migrations']);
  }
} finally {
  await client.end();
}
