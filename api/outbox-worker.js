import 'dotenv/config';
import pg from 'pg';
import crypto from 'node:crypto';

const {Pool}=pg;
const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.NODE_ENV==='production'?{rejectUnauthorized:false}:false});
const instanceId=crypto.randomUUID();

async function publish(event){
  // PostgreSQL NOTIFY is the shared event transport used by API instances.
  // The durable outbox row remains the source of truth if a worker is restarted.
  await pool.query('select pg_notify($1,$2)',['restaurant_outbox',JSON.stringify({instanceId,event})]);
}

async function processBatch(){
  const client=await pool.connect();
  try{
    await client.query('begin');
    const rows=await client.query(`select * from outbox_events
      where status in ('PENDING','FAILED') and available_at<=now()
      order by created_at
      for update skip locked limit 50`);
    for(const row of rows.rows){
      await client.query(`update outbox_events
        set status='PROCESSING',attempts=attempts+1
        where id=$1`,[row.id]);
    }
    await client.query('commit');
    for(const row of rows.rows){
      try{
        await publish({...row,payload:row.payload});
        await pool.query(`update outbox_events set status='PUBLISHED',processed_at=now(),last_error=null where id=$1`,[row.id]);
      }catch(error){
        await pool.query(`update outbox_events set status='FAILED',available_at=now()+interval '15 seconds',last_error=$2 where id=$1`,[row.id,error.message.slice(0,1000)]);
      }
    }
  }catch(error){try{await client.query('rollback')}catch{}console.error('Outbox worker error',error)}
  finally{client.release()}
}
setInterval(processBatch,1000).unref?.();
processBatch();
