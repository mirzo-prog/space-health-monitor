"""
config.py — Глобальные константы проекта Space Health Monitor & IDS
"""

# ── Сеть ──────────────────────────────────────────────────────────────────────
HOST = "127.0.0.1"
PORT = 9999
BUFFER_SIZE = 4096

# ── Космонавты ────────────────────────────────────────────────────────────────
ASTRONAUT_IDS = [1, 2, 3]
ASTRONAUT_NAMES = {
    1: "Ivanov A.",
    2: "Petrov B.",
    3: "Sidorova C.",
}

# ── Базовые медицинские показатели (нормальные диапазоны) ─────────────────────
BASELINE = {
    "heart_rate": {       # уд/мин
        "min": 50,
        "max": 100,
        "nominal": 72,
    },
    "spO2": {             # % насыщения кислородом
        "min": 94.0,
        "max": 100.0,
        "nominal": 98.0,
    },
    "radiation_level": {  # мкЗв/ч
        "min": 0.1,
        "max": 5.0,
        "nominal": 0.5,
    },
}

# ── Безопасность ──────────────────────────────────────────────────────────────
HMAC_SECRET = b"space_station_alpha_secret_key_2024"

# Максимальная допустимая частота пакетов (пакетов/сек) от одного источника
DOS_RATE_THRESHOLD = 10  # если больше — считаем DoS

# Вероятность генерации атаки (0.0 – 1.0)
ATTACK_PROBABILITY = 0.05  # 5%

# ── Файлы логов ───────────────────────────────────────────────────────────────
SECURITY_LOG_FILE = "security_incidents.log"
HEALTH_LOG_FILE   = "health_data.log"

# ── Ollama ────────────────────────────────────────────────────────────────────
OLLAMA_BASE_URL   = "http://localhost:11434"
OLLAMA_API_URL    = f"{OLLAMA_BASE_URL}/api/generate"
OLLAMA_MODEL      = "llama3"          # fallback: "phi3", "mistral"
OLLAMA_TIMEOUT    = 30                # секунд
AI_ANALYSIS_INTERVAL = 15            # секунд между анализами

# ── GUI ───────────────────────────────────────────────────────────────────────
WINDOW_TITLE  = "Space Health Monitor — IDS Active"
WINDOW_WIDTH  = 1400
WINDOW_HEIGHT = 820
WINDOW_OPACITY = 0.93                # полупрозрачность

# Цвета темы (тёмный sci-fi)
COLORS = {
    "background":   "#0A0E1A",
    "panel":        "#0D1526",
    "panel_border": "#1A2A4A",
    "accent":       "#00D4FF",
    "accent2":      "#00FF9F",
    "text":         "#C8D8F0",
    "text_dim":     "#5A7090",
    "alert_red":    "#FF3B3B",
    "alert_orange": "#FF8C00",
    "alert_green":  "#00FF9F",
    "grid":         "#1A2A4A",
    "hr_line":      "#00D4FF",
    "spo2_line":    "#00FF9F",
    "rad_line":     "#FF8C00",
}

# Сколько точек хранить на графике
GRAPH_HISTORY_LEN = 120
