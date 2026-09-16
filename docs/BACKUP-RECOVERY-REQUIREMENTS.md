# Backup and Recovery Requirements

Application code can create a PostgreSQL `pg_dump` file, but it cannot provide disaster recovery by itself.

## Implemented in the repository

- `server/services/backup.ts` derives the dump target from `DATABASE_URL`.
- Dumps use a restrictive local directory/file mode (`0700`/`0600`).
- `server/index.ts` can run an opt-in in-process scheduler with `BACKUP_ENABLED=true`.
- `DEPLOYMENT_GUIDE.md` documents manual and cron-driven backup commands.
- Render production uses Supabase object storage for uploaded application assets; local upload storage is refused unless explicitly opted in.

## Required infrastructure controls

1. **Database backup:** Use managed PostgreSQL continuous point-in-time recovery where available, plus scheduled logical backups. Do not rely on the application process or its local `backups/` directory as the only copy.
2. **Object storage:** Enable Supabase bucket durability/versioning or an equivalent independent replication/backup policy for `restaurant-assets` and the private `payment-proofs` bucket. Database backups alone do not restore objects.
3. **Retention:** Define and enforce at least 30 days of database recovery history and a separately documented retention period for payment-proof objects, subject to legal/business requirements. Keep at least one copy outside the primary account/region.
4. **Restore procedure:** Restore a database dump/PITR snapshot into an isolated project, apply committed Prisma migrations, restore or attach object storage, and verify tenant, order, payment, and asset references before promotion.
5. **Restore verification:** Perform a documented restore drill at least quarterly and after material schema/storage changes. A successful dump is not evidence of a successful restore.
6. **Monitoring:** Alert on backup job failure, stale backup age, insufficient storage, object replication failure, and restore-test failure. Route alerts to an on-call owner.
7. **RPO/RTO:** Production owners must set and record targets. Recommended initial targets are RPO <= 24 hours for logical backups (or materially lower with PITR) and RTO <= 4 hours; payment/order workloads may require stricter targets.

## Deployment-specific action

For Render, configure managed PostgreSQL PITR/backups and an external scheduled backup destination. Do not enable `BACKUP_ENABLED` as the only protection: multiple Render instances would each schedule independent local jobs and the filesystem is not a durable off-host backup target.
