#!/usr/bin/env bash
#
# ims-db-backup.sh — encrypted, off-host-decryptable PostgreSQL backups for IMS.
#
# Dumps the `ims` database from the running container and encrypts it to the
# IMS Backup GPG public key. The matching PRIVATE key lives only on the owner's
# Mac (~/.ims-backup/ims-backup-PRIVATE.asc), never on this server — so a server
# compromise cannot decrypt these backups (addresses VAPT: encryption at rest).
#
# Restore (on a machine holding the private key):
#   gpg --decrypt ims-YYYYMMDD-HHMM.sql.gz.gpg | gunzip | psql <target-db>
#
# Installed copy: /root/ims-db-backup.sh ; canonical copy: repo deploy/.
set -uo pipefail
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

RECIPIENT=25D43FDC6DB8B57E545F5092D35743C671FC3840   # IMS Backup public key fingerprint
DB_CONTAINER=ims-db-1
DB_USER=ims_user
DB_NAME=ims
DEST=/root/backups
KEEP=14                                              # retain this many encrypted dumps
TAG="[ims-backup]"
ts() { date '+%F %T'; }
stamp=$(date '+%Y%m%d-%H%M')
out="$DEST/ims-$stamp.sql.gz.gpg"

mkdir -p "$DEST"

# Dump -> gzip -> encrypt (gpg compression off; already gzipped). Pipefail
# ensures a failure anywhere aborts before we prune old good backups.
if docker exec "$DB_CONTAINER" pg_dump -U "$DB_USER" "$DB_NAME" \
     | gzip \
     | gpg --batch --yes --trust-model always --compress-algo none \
           --recipient "$RECIPIENT" --encrypt -o "$out"; then
  size=$(du -h "$out" | cut -f1)
  echo "$(ts) $TAG wrote $out ($size)"
else
  rc=$?
  echo "$(ts) $TAG ERROR: backup failed rc=$rc"
  rm -f "$out"
  exit "$rc"
fi

# Sanity: the artifact must be a public-key-encrypted OpenPGP message, not
# plaintext. list-packets exits non-zero without the secret key (and pipefail
# would mis-read a piped grep), so capture the output first, then grep it.
packets=$(gpg --list-packets "$out" 2>/dev/null || true)
if ! printf '%s' "$packets" | grep -q "pubkey enc packet"; then
  echo "$(ts) $TAG ERROR: output is not GPG public-key encrypted — removing"; rm -f "$out"; exit 1
fi

# Retention: keep the newest $KEEP encrypted dumps.
ls -1t "$DEST"/ims-*.sql.gz.gpg 2>/dev/null | tail -n +$((KEEP + 1)) | while read -r old; do
  rm -f "$old"; echo "$(ts) $TAG pruned $old"
done

echo "$(ts) $TAG done"
