#!/usr/bin/env bash
#
# Build the load-test credential file from the seeded accounts of the Docker
# parity stack (docs/CAPACITY_TEST_REPORT.md). Every seeded development account
# shares the DevUserSeeder password, so the CSV pairs each active account that
# is not forced to change its password with that value. The file is written to
# artifacts/load-tests/ (git-ignored) and is only meaningful for the local
# parity stack; production accounts never appear here.
#
#   scripts/capacity/make-credentials.sh [output.csv]

set -Eeuo pipefail

OUTPUT="${1:-artifacts/load-tests/parity-credentials.csv}"
PASSWORD="${LOAD_SEED_PASSWORD:-StPaul2026!}"

mkdir -p "$(dirname "${OUTPUT}")"

docker compose exec -T app php artisan tinker --execute='
  $rows = \App\Models\User::query()
    ->where("active", true)
    ->where("password_change_required", false)
    ->orderByRaw("CASE role_key WHEN \"nurse\" THEN 0 WHEN \"admin\" THEN 1 WHEN \"superadmin\" THEN 1 WHEN \"resident\" THEN 2 WHEN \"consultant\" THEN 2 ELSE 3 END")
    ->orderBy("email")
    ->get(["email", "role_key"]);
  foreach ($rows as $row) { echo $row->email, ",", $row->role_key, PHP_EOL; }
' | grep -E '^[^,]+@[^,]+,[a-z_]+$' > "${OUTPUT}.roles"

# Interleave roles so any prefix of the file (LOAD_USERS=25, 50, ...) keeps
# the seeded proportions instead of being all nurses.
python - "${OUTPUT}" "${PASSWORD}" <<'EOF'
import sys, itertools
out, password = sys.argv[1], sys.argv[2]
groups = {}
for line in open(out + '.roles', encoding='utf-8'):
    email, role = line.strip().split(',')
    groups.setdefault(role, []).append(email)
total = sum(len(v) for v in groups.values())
order = sorted(groups.items(), key=lambda kv: -len(kv[1]))
# Weighted round robin: emit each role in proportion to its size.
emitted = []
cursors = {role: 0 for role, _ in order}
while len(emitted) < total:
    for role, emails in order:
        share = max(1, round(len(emails) / total * 10))
        for _ in range(share):
            if cursors[role] < len(emails):
                emitted.append(emails[cursors[role]])
                cursors[role] += 1
with open(out, 'w', encoding='utf-8', newline='\n') as fh:
    fh.write('# parity-stack load accounts (local only, never production)\n')
    for email in emitted:
        fh.write(f'{email},{password}\n')
print(f'{len(emitted)} accounts -> {out}; by role: ' + ', '.join(f'{r}={len(v)}' for r, v in order))
EOF
rm -f "${OUTPUT}.roles"
