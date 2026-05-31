#!/usr/bin/env bash
# =============================================================================
#  MyPanel (reseller panel for 3x-ui) — one-shot installer.
#
#  Quick install (run as root):
#    bash <(curl -fsSL https://raw.githubusercontent.com/W2F-Sa/MyPanel-hamcari/main/install.sh)
#
#  What it does:
#    - installs Node.js >= 18 (if missing) + build prerequisites
#    - clones/updates the repo into /opt/mypanel-hamcari
#    - installs npm dependencies
#    - generates a self-signed TLS certificate (the panel serves HTTPS itself —
#      no nginx/apache needed)
#    - generates random admin credentials + obscure portal paths
#    - installs & starts a systemd service (runs as an unprivileged user)
#    - opens the chosen port in ufw/firewalld if present
#
#  Re-running is safe (acts as an updater; admin credentials are preserved).
#  Environment overrides:  PORT=2053  INSTALL_DIR=/opt/mypanel-hamcari
# =============================================================================
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/W2F-Sa/MyPanel-hamcari.git}"
BRANCH="${BRANCH:-main}"
INSTALL_DIR="${INSTALL_DIR:-/opt/mypanel-hamcari}"
SERVICE_NAME="${SERVICE_NAME:-mypanel}"
PORT="${PORT:-2053}"
RUN_USER="${RUN_USER:-mypanel}"

cyan="\033[36m"; green="\033[32m"; yellow="\033[33m"; red="\033[31m"; bold="\033[1m"; rst="\033[0m"
say()  { echo -e "${cyan}==>${rst} $*"; }
ok()   { echo -e "${green}[ok]${rst} $*"; }
warn() { echo -e "${yellow}[!]${rst} $*"; }
die()  { echo -e "${red}[x]${rst} $*"; exit 1; }

[ "$(id -u)" -eq 0 ] || die "این اسکریپت باید با کاربر root اجرا شود (sudo)."

# ---------- detect package manager ----------
PM=""
if   command -v apt-get >/dev/null 2>&1; then PM="apt";
elif command -v dnf     >/dev/null 2>&1; then PM="dnf";
elif command -v yum     >/dev/null 2>&1; then PM="yum";
else warn "مدیر بسته شناسایی نشد؛ مطمئن شوید git/curl/openssl/node نصب‌اند."; fi

pkg_install() {
  case "$PM" in
    apt) export DEBIAN_FRONTEND=noninteractive; apt-get update -y -q; apt-get install -y -q "$@" ;;
    dnf) dnf install -y -q "$@" ;;
    yum) yum install -y -q "$@" ;;
  esac
}

say "نصب پیش‌نیازها..."
case "$PM" in
  apt) pkg_install ca-certificates curl git openssl python3 build-essential || true ;;
  dnf|yum) pkg_install ca-certificates curl git openssl python3 gcc-c++ make || true ;;
esac

# ---------- Node.js >= 18 ----------
need_node=1
if command -v node >/dev/null 2>&1; then
  major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  [ "${major:-0}" -ge 18 ] && need_node=0
fi
if [ "$need_node" -eq 1 ]; then
  say "نصب Node.js 20 LTS..."
  if [ "$PM" = "apt" ]; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    pkg_install nodejs
  elif [ "$PM" = "dnf" ] || [ "$PM" = "yum" ]; then
    curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
    pkg_install nodejs
  else
    die "Node.js نصب نیست و نصب خودکار ممکن نشد. لطفاً Node >= 18 را دستی نصب کنید."
  fi
fi
ok "Node $(node -v)"

# ---------- clone / update ----------
if [ -d "$INSTALL_DIR/.git" ]; then
  say "به‌روزرسانی نسخه‌ی موجود در $INSTALL_DIR ..."
  git -C "$INSTALL_DIR" fetch --depth 1 origin "$BRANCH"
  git -C "$INSTALL_DIR" reset --hard "origin/$BRANCH"
else
  say "دریافت کد از گیت‌هاب به $INSTALL_DIR ..."
  rm -rf "$INSTALL_DIR"
  git clone --depth 1 -b "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
fi

cd "$INSTALL_DIR"

say "نصب وابستگی‌های npm (این مرحله ممکن است کمی طول بکشد)..."
npm install --omit=dev --no-audit --no-fund

# ---------- unprivileged service user ----------
if ! id "$RUN_USER" >/dev/null 2>&1; then
  say "ساخت کاربر سرویس بدون دسترسی: $RUN_USER"
  useradd --system --no-create-home --shell /usr/sbin/nologin "$RUN_USER" 2>/dev/null \
    || useradd --system --no-create-home --shell /sbin/nologin "$RUN_USER" 2>/dev/null || true
fi

# ---------- TLS self-signed cert ----------
mkdir -p "$INSTALL_DIR/data/certs"
CERT="$INSTALL_DIR/data/certs/cert.pem"
KEY="$INSTALL_DIR/data/certs/key.pem"
if [ ! -f "$CERT" ] || [ ! -f "$KEY" ]; then
  say "ساخت گواهی TLS خودامضا (self-signed)..."
  openssl req -x509 -newkey rsa:2048 -nodes \
    -keyout "$KEY" -out "$CERT" -days 3650 \
    -subj "/CN=mypanel" >/dev/null 2>&1
  ok "گواهی ساخته شد."
fi

# ---------- initialize config + admin ----------
say "آماده‌سازی پیکربندی و حساب مدیر..."
INIT_OUT="$(MYPANEL_PORT="$PORT" node src/cli/initConfig.js)"
echo "$INIT_OUT"

# pull computed paths from the saved config for the final summary
ADMIN_PATH="$(node -e 'console.log(JSON.parse(require("fs").readFileSync("data/config.json")).adminPath)')"
RES_PATH="$(node -e 'console.log(JSON.parse(require("fs").readFileSync("data/config.json")).resellerPath)')"
CFG_PORT="$(node -e 'console.log(JSON.parse(require("fs").readFileSync("data/config.json")).port)')"

# ---------- permissions ----------
chown -R "$RUN_USER":"$RUN_USER" "$INSTALL_DIR/data" 2>/dev/null || true
chmod -R go-rwx "$INSTALL_DIR/data" 2>/dev/null || true

# ---------- systemd service ----------
say "نصب سرویس systemd ($SERVICE_NAME)..."
cat > "/etc/systemd/system/${SERVICE_NAME}.service" <<UNIT
[Unit]
Description=MyPanel - reseller panel for 3x-ui
After=network.target

[Service]
Type=simple
User=${RUN_USER}
WorkingDirectory=${INSTALL_DIR}
ExecStart=$(command -v node) ${INSTALL_DIR}/src/server.js
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true
ReadWritePaths=${INSTALL_DIR}/data
AmbientCapabilities=
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable "$SERVICE_NAME" >/dev/null 2>&1 || true
systemctl restart "$SERVICE_NAME"

# ---------- firewall (best effort) ----------
if command -v ufw >/dev/null 2>&1; then
  ufw allow "${CFG_PORT}/tcp" >/dev/null 2>&1 || true
fi
if command -v firewall-cmd >/dev/null 2>&1; then
  firewall-cmd --permanent --add-port="${CFG_PORT}/tcp" >/dev/null 2>&1 || true
  firewall-cmd --reload >/dev/null 2>&1 || true
fi

# ---------- public IP ----------
IP="$(curl -fsSL --max-time 5 https://api.ipify.org 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}')"
[ -z "$IP" ] && IP="<server-ip>"

sleep 1
if systemctl is-active --quiet "$SERVICE_NAME"; then
  STATUS="${green}در حال اجرا${rst}"
else
  STATUS="${red}اجرا نشد (systemctl status ${SERVICE_NAME})${rst}"
fi

cat <<SUMMARY

${bold}=====================================================================${rst}
${green}${bold}  نصب MyPanel کامل شد${rst}
${bold}=====================================================================${rst}

  وضعیت سرویس : ${STATUS}
  پورت        : ${CFG_PORT}

  ${bold}پنل مدیر    :${rst} ${cyan}https://${IP}:${CFG_PORT}${ADMIN_PATH}${rst}
  ${bold}پنل نماینده :${rst} ${cyan}https://${IP}:${CFG_PORT}${RES_PATH}${rst}

  نام کاربری و رمز مدیر در خروجی بالا چاپ شده است (آن را ذخیره کنید).
  اگر رمز را گم کردید:  cd ${INSTALL_DIR} && node src/cli/resetAdmin.js

  مدیریت سرویس:
    systemctl restart ${SERVICE_NAME}     # ری‌استارت
    systemctl stop ${SERVICE_NAME}        # توقف
    journalctl -u ${SERVICE_NAME} -f      # مشاهده لاگ زنده

  نکته: گواهی TLS خودامضا است؛ مرورگر یک هشدار نشان می‌دهد که عادی است.
  مسیرهای پنل مخفی‌اند؛ آن‌ها را خصوصی نگه دارید.
${bold}=====================================================================${rst}

SUMMARY
