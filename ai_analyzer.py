"""
ai_analyzer.py — Обёртка для Ollama: анализ биометрии в отдельном потоке.

Класс AIAnalyzer:
  - Принимает очередь с валидными пакетами здоровья.
  - Каждые AI_ANALYSIS_INTERVAL секунд берёт последние 10 записей,
    формирует промпт и отправляет в Ollama.
  - Результат возвращается через callback (используется из GUI).
"""

import json
import logging
import queue
import threading
import time
from collections import deque
from typing import Callable

import requests

import config

log = logging.getLogger("ai_analyzer")


# ── Формирование промпта ──────────────────────────────────────────────────────

def build_prompt(records: list[dict]) -> str:
    """
    Строит лаконичный промпт для LLM на основе последних записей телеметрии.
    """
    lines = []
    for r in records:
        ts = time.strftime("%H:%M:%S", time.localtime(r.get("timestamp", 0)))
        aid = r.get("astro_id", "?")
        hr = r.get("heart_rate", "?")
        spo2 = r.get("spO2", "?")
        rad = r.get("radiation_level", "?")
        status = r.get("status_text", "?")
        name = config.ASTRONAUT_NAMES.get(aid, f"ID-{aid}")
        lines.append(
            f"  [{ts}] {name}: HR={hr} bpm, SpO2={spo2}%, RAD={rad} μSv/h, Status={status}"
        )

    data_block = "\n".join(lines)
    return (
        "You are a space medicine AI assistant. Analyze the following astronaut "
        "telemetry data and provide a brief status assessment in 1-3 short lines. "
        "Be concise. Use terms like 'Nominal', 'Elevated stress', 'Tachycardia', "
        "'Hypoxia risk', 'High radiation', 'Fatigue detected'. "
        "Respond in the same language the data implies (Russian OK).\n\n"
        f"Recent telemetry (last {len(records)} records):\n{data_block}\n\n"
        "Assessment:"
    )


# ── Обращение к Ollama ────────────────────────────────────────────────────────

def query_ollama(prompt: str, model: str = config.OLLAMA_MODEL) -> str:
    """
    Отправляет запрос в Ollama REST API (не-streaming).
    Возвращает текст ответа или сообщение об ошибке.
    """
    payload = {
        "model": model,
        "prompt": prompt,
        "stream": False,
        "options": {
            "temperature": 0.3,
            "num_predict": 150,
        },
    }
    try:
        resp = requests.post(
            config.OLLAMA_API_URL,
            json=payload,
            timeout=config.OLLAMA_TIMEOUT,
        )
        resp.raise_for_status()
        data = resp.json()
        return data.get("response", "").strip()
    except requests.exceptions.ConnectionError:
        return "⚠ Ollama недоступна (connection refused). Запустите: ollama serve"
    except requests.exceptions.Timeout:
        return f"⚠ Ollama не ответила за {config.OLLAMA_TIMEOUT}s"
    except requests.exceptions.HTTPError as e:
        # Если модель не найдена — пробуем fallback
        if resp.status_code == 404:
            return f"⚠ Модель '{model}' не найдена. Запустите: ollama pull {model}"
        return f"⚠ HTTP ошибка: {e}"
    except Exception as e:
        return f"⚠ Ошибка ИИ: {e}"


# ── Основной класс ────────────────────────────────────────────────────────────

class AIAnalyzer(threading.Thread):
    """
    Работает в фоновом потоке.
    Каждые config.AI_ANALYSIS_INTERVAL секунд анализирует накопленные данные.

    Параметры:
        data_queue  — queue.Queue с валидными пакетами от сервера IDS.
        on_result   — callback(text: str), вызывается в фоновом потоке
                      (в GUI нужно использовать сигнал/очередь для thread-safety).
    """

    def __init__(
        self,
        data_queue: queue.Queue,
        on_result: Callable[[str], None],
    ):
        super().__init__(daemon=True, name="AIAnalyzer")
        self.data_queue = data_queue
        self.on_result = on_result
        self._buffer: deque[dict] = deque(maxlen=50)
        self._running = False

    def _drain_queue(self):
        """Переносит все доступные пакеты из очереди в внутренний буфер."""
        while True:
            try:
                pkt = self.data_queue.get_nowait()
                self._buffer.append(pkt)
            except queue.Empty:
                break

    def _analyze(self):
        """Берёт последние 10 записей и запрашивает Ollama."""
        self._drain_queue()
        records = list(self._buffer)[-10:]
        if not records:
            self.on_result("⏳ Нет данных для анализа…")
            return

        log.info(f"Sending {len(records)} records to Ollama ({config.OLLAMA_MODEL})…")
        prompt = build_prompt(records)
        result = query_ollama(prompt)
        log.info(f"AI response: {result[:80]}…" if len(result) > 80 else f"AI response: {result}")
        self.on_result(result)

    def run(self):
        self._running = True
        log.info(f"AI Analyzer started (interval={config.AI_ANALYSIS_INTERVAL}s, model={config.OLLAMA_MODEL})")

        # Первый анализ — через 5 секунд после запуска
        time.sleep(5)

        while self._running:
            self._analyze()
            # Ждём интервал, но проверяем флаг каждую секунду
            for _ in range(config.AI_ANALYSIS_INTERVAL):
                if not self._running:
                    break
                time.sleep(1)

    def stop(self):
        self._running = False
        log.info("AI Analyzer stopped.")


# ── Быстрый тест ──────────────────────────────────────────────────────────────

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")

    test_records = [
        {
            "timestamp": time.time() - i * 2,
            "astro_id": (i % 3) + 1,
            "heart_rate": 72 + i * 2,
            "spO2": 98 - i * 0.3,
            "radiation_level": 0.5 + i * 0.1,
            "status_text": "NOMINAL" if i < 4 else "WARNING",
        }
        for i in range(10)
    ]

    prompt = build_prompt(test_records)
    print("=== PROMPT ===")
    print(prompt)
    print("\n=== OLLAMA RESPONSE ===")
    result = query_ollama(prompt)
    print(result)
