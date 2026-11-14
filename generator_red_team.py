"""
generator_red_team.py — Red Team: Симулятор телеметрии + Векторы атак

Запуск: python generator_red_team.py
Работает вечно, Ctrl+C для остановки.

Нормальный режим:  отправляет JSON с корректным HMAC-SHA256.
MITM атака (2.5%): данные искажены, подпись неверна.
DoS атака  (2.5%): флуд мусорными пакетами в течение ~2 сек.
"""

import json
import math
import random
import socket
import time
import hmac
import hashlib
import logging
import sys
import threading

import numpy as np

import config

# ── Настройка логирования ─────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [RED-TEAM] %(levelname)s %(message)s",
    datefmt="%H:%M:%S",
    stream=sys.stdout,
)
log = logging.getLogger("red_team")


# ── Генераторы биометрии ───────────────────────────────────────────────────────

class AstronautSimulator:
    """Симулирует биометрические данные одного космонавта."""

    def __init__(self, astro_id: int):
        self.astro_id = astro_id
        self.t = random.uniform(0, 2 * math.pi)   # начальная фаза
        # Индивидуальный «базовый» пульс
        self.base_hr = random.uniform(65, 80)
        # Уровень стресса (медленно дрейфует)
        self.stress = random.uniform(0.0, 0.3)
        self.stress_drift = random.choice([-1, 1]) * 0.001

    def _drift_stress(self):
        self.stress += self.stress_drift + random.uniform(-0.0005, 0.0005)
        self.stress = max(0.0, min(1.0, self.stress))
        if random.random() < 0.01:
            self.stress_drift *= -1

    def next(self) -> dict:
        self.t += 0.1
        self._drift_stress()

        # Пульс: синусоида дыхания + стресс + шум
        hr_base = self.base_hr + 20 * self.stress
        hr_breath = 4 * math.sin(self.t * 0.3)        # дыхательная аритмия
        hr_noise = float(np.random.normal(0, 1.5))
        heart_rate = round(hr_base + hr_breath + hr_noise, 1)
        heart_rate = max(40.0, min(180.0, heart_rate))

        # SpO2: обычно высокий, падает при высоком стрессе
        spo2 = round(99.0 - 4 * self.stress + float(np.random.normal(0, 0.3)), 1)
        spo2 = max(85.0, min(100.0, spo2))

        # Радиация: фоновая + редкие вспышки
        rad_base = 0.4 + 2.5 * self.stress
        rad_spike = 10 * max(0, math.sin(self.t * 0.05)) ** 8  # редкие пики
        radiation = round(rad_base + rad_spike + abs(float(np.random.normal(0, 0.05))), 3)

        # Статус
        if heart_rate > 110 or spo2 < 93:
            status = "CRITICAL"
        elif heart_rate > 95 or spo2 < 96:
            status = "WARNING"
        else:
            status = "NOMINAL"

        return {
            "timestamp": time.time(),
            "astro_id": self.astro_id,
            "heart_rate": heart_rate,
            "spO2": spo2,
            "radiation_level": radiation,
            "status_text": status,
        }


# ── Подпись пакетов ───────────────────────────────────────────────────────────

def sign_packet(payload: dict) -> str:
    """Возвращает HMAC-SHA256 hex-дайджест для данного payload."""
    body = json.dumps(payload, sort_keys=True).encode()
    return hmac.new(config.HMAC_SECRET, body, hashlib.sha256).hexdigest()


def build_packet(payload: dict) -> bytes:
    """Добавляет корректную подпись и сериализует в bytes."""
    signature = sign_packet(payload)
    packet = {**payload, "signature": signature}
    return (json.dumps(packet) + "\n").encode("utf-8")


# ── Векторы атак ──────────────────────────────────────────────────────────────

def build_mitm_packet(payload: dict) -> bytes:
    """
    MITM атака: данные искажены (сердце под 200 или SpO2 под 50),
    но подпись НЕ пересчитывается → несовпадение.
    """
    original_signature = sign_packet(payload)
    tampered = {**payload}
    # Подмена данных
    tampered["heart_rate"] = random.uniform(190, 220)
    tampered["spO2"] = random.uniform(45, 60)
    tampered["status_text"] = "INJECTED"
    tampered["signature"] = original_signature  # старая подпись → провалится проверка
    log.warning(f"[MITM] Sending tampered packet for astro_id={payload['astro_id']}")
    return (json.dumps(tampered) + "\n").encode("utf-8")


def flood_dos(sock: socket.socket, duration: float = 2.0):
    """DoS: отправляет мусорные пакеты в течение `duration` секунд."""
    log.warning(f"[DoS] Starting flood for {duration}s")
    deadline = time.time() + duration
    count = 0
    while time.time() < deadline:
        junk = {
            "dos": True,
            "data": "X" * random.randint(100, 500),
            "ts": time.time(),
        }
        try:
            sock.sendall((json.dumps(junk) + "\n").encode())
            count += 1
            time.sleep(0.05)  # ~20 пакетов/сек → выше порога DoS
        except OSError:
            break
    log.warning(f"[DoS] Sent {count} junk packets")


# ── Основной цикл ─────────────────────────────────────────────────────────────

class RedTeamGenerator:
    def __init__(self):
        self.simulators = {
            aid: AstronautSimulator(aid) for aid in config.ASTRONAUT_IDS
        }
        self.sock: socket.socket | None = None
        self._running = False
        self._lock = threading.Lock()

    def connect(self) -> bool:
        try:
            self.sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            self.sock.connect((config.HOST, config.PORT))
            log.info(f"Connected to server {config.HOST}:{config.PORT}")
            return True
        except ConnectionRefusedError:
            log.error(f"Cannot connect to {config.HOST}:{config.PORT} — is server_ids.py running?")
            return False

    def _send(self, data: bytes):
        with self._lock:
            if self.sock:
                self.sock.sendall(data)

    def run(self):
        self._running = True
        while self._running:
            if not self.sock:
                if not self.connect():
                    log.info("Retrying in 3s...")
                    time.sleep(3)
                    continue

            try:
                # Случайно выбираем космонавта
                aid = random.choice(config.ASTRONAUT_IDS)
                payload = self.simulators[aid].next()

                roll = random.random()

                if roll < config.ATTACK_PROBABILITY / 2:
                    # --- MITM атака ---
                    self._send(build_mitm_packet(payload))

                elif roll < config.ATTACK_PROBABILITY:
                    # --- DoS атака (в отдельном потоке, чтобы не блокировать) ---
                    t = threading.Thread(
                        target=flood_dos,
                        args=(self.sock, random.uniform(1.5, 3.0)),
                        daemon=True,
                    )
                    t.start()

                else:
                    # --- Нормальный пакет ---
                    pkt = build_packet(payload)
                    self._send(pkt)
                    log.debug(
                        f"[TELEMETRY] astro={aid} HR={payload['heart_rate']} "
                        f"SpO2={payload['spO2']} RAD={payload['radiation_level']} "
                        f"status={payload['status_text']}"
                    )

                time.sleep(1.0)

            except (BrokenPipeError, ConnectionResetError, OSError) as e:
                log.error(f"Connection lost: {e}. Reconnecting...")
                with self._lock:
                    if self.sock:
                        self.sock.close()
                    self.sock = None
                time.sleep(2)

    def stop(self):
        self._running = False
        with self._lock:
            if self.sock:
                self.sock.close()
                self.sock = None
        log.info("Generator stopped.")


# ── Точка входа ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    gen = RedTeamGenerator()
    try:
        gen.run()
    except KeyboardInterrupt:
        gen.stop()
        log.info("Goodbye.")
