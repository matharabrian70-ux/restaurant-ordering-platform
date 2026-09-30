# Versioned database migrations

Production schema changes for Phase A live in this directory.

Run:

`npm run migrate`

The migration runner records each applied version in `schema_migrations` and takes a PostgreSQL advisory lock so two API instances cannot apply the same migration concurrently.

Runtime `ensure...Schema()` functions remain temporarily for backward compatibility with the existing deployment. New production schema work should be added here rather than adding more startup DDL.
