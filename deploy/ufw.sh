#!/usr/bin/env bash
#
# Firewall for the department server (V2 guide 11.3): the app is reachable
# ONLY from inside the hospital network; SSH only from the admin VLAN.
# Adjust the two subnets before running.

set -euo pipefail

HOSPITAL_SUBNET="${HOSPITAL_SUBNET:-10.10.0.0/16}"
ADMIN_VLAN="${ADMIN_VLAN:-10.10.99.0/24}"

ufw --force reset

ufw default deny incoming
ufw default allow outgoing

# The app: HTTPS (and the 80 -> 443 redirect) from the hospital subnet only.
ufw allow from "${HOSPITAL_SUBNET}" to any port 443 proto tcp
ufw allow from "${HOSPITAL_SUBNET}" to any port 80 proto tcp

# SSH from the admin VLAN only; fail2ban watches this port.
ufw allow from "${ADMIN_VLAN}" to any port 22 proto tcp

ufw --force enable
ufw status verbose

cat <<'EOF'

Also install (one-time):
  apt install fail2ban unattended-upgrades
  dpkg-reconfigure -plow unattended-upgrades   # enable security auto-updates
Fail2ban's default sshd jail is enough; verify with: fail2ban-client status sshd
EOF
