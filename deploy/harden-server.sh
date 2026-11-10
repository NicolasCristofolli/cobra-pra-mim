#!/usr/bin/env bash
# Endurecimento da VPS (Ubuntu 24.04, Hostinger). Precisa de root:
#   sudo bash deploy/harden-server.sh
# É idempotente: pode rodar de novo sem efeito colateral.
set -euo pipefail

[[ $EUID -eq 0 ]] || { echo "Rode com sudo."; exit 1; }
REPO="$(cd "$(dirname "$0")/.." && pwd)"

echo "== Firewall (UFW): só SSH, HTTP e HTTPS =="
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp   # HTTP/3 do Caddy
ufw --force enable
ufw status verbose

echo "== fail2ban (SSH) =="
apt-get update -qq
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq fail2ban unattended-upgrades
cat > /etc/fail2ban/jail.d/sshd.local <<'EOF'
[sshd]
enabled  = true
backend  = systemd
maxretry = 5
findtime = 10m
bantime  = 1h
EOF
systemctl enable --now fail2ban
systemctl restart fail2ban

echo "== Atualizações automáticas de segurança =="
dpkg-reconfigure -f noninteractive unattended-upgrades

echo "== SSH: chave própria para o usuário deploy =="
# Copia as chaves já autorizadas no root, para você poder entrar direto como
# deploy (ssh deploy@IP) e, no futuro, desligar o login de root.
if [[ -s /root/.ssh/authorized_keys && ! -s /home/deploy/.ssh/authorized_keys ]]; then
  install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
  install -m 600 -o deploy -g deploy /root/.ssh/authorized_keys /home/deploy/.ssh/authorized_keys
  echo "Chaves copiadas. Teste em outro terminal: ssh deploy@$(hostname -I | awk '{print $1}')"
fi

echo "== SSH: root só por chave (nunca por senha) =="
# Não desativa o root por completo: hoje o acesso à VPS é por chave do root.
# Quando tiver uma chave em /home/deploy/.ssh/authorized_keys, troque para
# "PermitRootLogin no" neste arquivo.
cat > /etc/ssh/sshd_config.d/10-hardening.conf <<'EOF'
PermitRootLogin prohibit-password
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
MaxAuthTries 4
X11Forwarding no
EOF
sshd -t && systemctl reload ssh

echo "== Caddy: cabeçalhos de segurança, gzip e logs =="
install -d -o caddy -g caddy /var/log/caddy
cp -n /etc/caddy/Caddyfile "/etc/caddy/Caddyfile.bak.$(date +%Y%m%d)" || true
caddy validate --config "$REPO/deploy/Caddyfile" --adapter caddyfile
install -m 644 "$REPO/deploy/Caddyfile" /etc/caddy/Caddyfile
systemctl reload caddy

echo "== Docker: rotação de logs padrão para todos os containers =="
if [[ ! -f /etc/docker/daemon.json ]]; then
  cat > /etc/docker/daemon.json <<'EOF'
{ "log-driver": "json-file", "log-opts": { "max-size": "10m", "max-file": "3" } }
EOF
  echo "daemon.json criado (vale para containers novos; reinicie o Docker numa janela de manutenção)."
fi

echo "Pronto."
