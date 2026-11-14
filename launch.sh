#!/usr/bin/env bash
# space-health — Лаунчер Space Health Monitor
# Открывает два окна foot: GUI и генератор телеметрии

PROJECT="/home/mirzo/space-health-monitor"
PYTHON="$PROJECT/.venv/bin/python"

# Если venv ещё не создан — сначала установка
if [ ! -f "$PYTHON" ]; then
    foot bash -c "cd $PROJECT && bash install.sh; read -p 'Нажмите Enter...'" &
    sleep 1
fi

# Окно 1: GUI + IDS сервер
foot --title "Space Health Monitor" \
     --app-id "space-health-gui" \
     bash -c "cd $PROJECT && $PYTHON gui_dashboard.py" &

# Небольшая пауза — дать серверу подняться
sleep 2

# Окно 2: Red Team генератор
foot --title "Red Team Generator" \
     --app-id "space-health-gen" \
     bash -c "cd $PROJECT && $PYTHON generator_red_team.py; read -p 'Генератор остановлен. Enter для закрытия...'" &

echo "Space Health Monitor запущен."
