#!/usr/bin/env bash
# install.sh — Установка Space Health Monitor на Arch Linux
# Запуск: bash install.sh

set -e

echo "==> [1/3] Устанавливаем зависимости через pacman..."
sudo pacman -S --needed --noconfirm \
    python-pyqt5 \
    python-pyqtgraph \
    python-numpy \
    python-requests

echo "==> [2/3] Создаём venv с доступом к системным пакетам..."
# --system-site-packages позволяет venv видеть PyQt5/numpy/etc. из pacman
python -m venv --system-site-packages .venv

echo "==> [3/3] Проверяем импорты..."
.venv/bin/python -c "
import PyQt5; print('  PyQt5 OK')
import pyqtgraph; print('  pyqtgraph OK')
import numpy; print('  numpy OK')
import requests; print('  requests OK')
"

echo ""
echo "✅ Готово! Запускайте:"
echo "   .venv/bin/python gui_dashboard.py"
echo "   .venv/bin/python generator_red_team.py  # в отдельном терминале"
