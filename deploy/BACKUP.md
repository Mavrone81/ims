# IMS — Encrypted database backups

Production runs **encrypted, off-host-decryptable** PostgreSQL backups.

- **What:** `deploy/ims-db-backup.sh` (installed at `/root/ims-db-backup.sh`)
  dumps the `ims` database and encrypts it to a GPG **public** key.
- **When:** daily at 02:30 server time (cron), plus on demand by running the script.
- **Where:** `/root/backups/ims-YYYYMMDD-HHMM.sql.gz.gpg` (last 14 retained).
- **Key model:** the server holds only the **public** key (encrypt-only). The
  matching **private** key exists only on the owner's Mac at
  `~/.ims-backup/ims-backup-PRIVATE.asc` (GPG fingerprint
  `25D43FDC6DB8B57E545F5092D35743C671FC3840`). A server compromise therefore
  cannot decrypt any backup. This addresses the "encryption at rest" gap for
  the most portable/exfiltration-prone artifact (backups).

> ⚠️ **The private key is the only way to read these backups.** Store
> `~/.ims-backup/ims-backup-PRIVATE.asc` somewhere safe and durable (password
> manager / offline media). If it is lost, every encrypted backup is
> unrecoverable. Consider protecting it with a passphrase.

## Restore

On a machine holding the private key (e.g. the owner's Mac):

```bash
export GNUPGHOME="$HOME/.ims-backup/gnupg"        # or import the private key into your keyring
# fetch a backup
scp -i ~/.ssh/ims_deploy root@157.230.240.163:/root/backups/ims-YYYYMMDD-HHMM.sql.gz.gpg .

# decrypt -> gunzip -> SQL
gpg --decrypt ims-YYYYMMDD-HHMM.sql.gz.gpg | gunzip > restore.sql

# load into a target database (example: a fresh local container)
psql "postgresql://ims_user:PASS@localhost:5432/ims_restore" < restore.sql
```

To restore **into production** (destructive — overwrites current data), load the
SQL into the running container's database; take a fresh backup first.

## Re-key / rotate

1. On the Mac, generate a new keypair (see how the current one was created) and
   export the new public key.
2. `scp` the public key to the server and `gpg --import` it; update `RECIPIENT`
   in `/root/ims-db-backup.sh` (and `deploy/ims-db-backup.sh`).
3. Keep the old private key until no backups encrypted to it remain within retention.
