#!/usr/bin/env bash
# One-off preparation of a fresh Ubuntu 24.04 VPS. Run as root on the server:
#   bash server-setup.sh
#
# Installs Docker, brings the machine up to date, adds swap (image builds are memory-hungry
# and small droplets have 1-2 GB), opens only 22/80/443 and creates an unprivileged "deploy"
# user that may run docker. It deliberately does NOT touch sshd_config: lock SSH down by
# hand AFTER you have confirmed that you can log in as "deploy" (see docs/DEPLOY.md).
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "run me as root" >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive

apt-get update
apt-get -y upgrade
apt-get -y install unattended-upgrades fail2ban ufw rsync curl ca-certificates

if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi

# 2 GB swap unless the machine already has some.
if [ "$(swapon --show --noheadings | wc -l)" -eq 0 ]; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

if ! id deploy >/dev/null 2>&1; then
  adduser --disabled-password --gecos "" deploy
fi
usermod -aG docker deploy
mkdir -p /home/deploy/.ssh
if [ -f /root/.ssh/authorized_keys ]; then
  cp /root/.ssh/authorized_keys /home/deploy/.ssh/authorized_keys
fi
chown -R deploy:deploy /home/deploy/.ssh
chmod 700 /home/deploy/.ssh
chmod 600 /home/deploy/.ssh/authorized_keys 2>/dev/null || true

echo
echo "Done. Now, from your PC, check:  ssh deploy@<server-ip>  (must work without a password)."
echo "Only then lock SSH down - see docs/DEPLOY.md, section 1."
