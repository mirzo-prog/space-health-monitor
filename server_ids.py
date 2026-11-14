"""
server_ids.py — Blue Team: TCP-сервер + IDS (Intrusion Detection System)

Запускается в паре с gui_dashboard.py.
Принимает данные от generator_red_team.py, фильтрует через IDS
и пересылает валидные данные в GUI через queue.Queue.
"""

import hashlib
import hmac
import json
import logging
import queue
import socket
import sys
import threading
import time
from collections import defaultdict, deque
from datetime import datetime

import config

# ── Логирование ───────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [SERVER-IDS] %(levelname)s %(message)s",
    datefmt="%H:%M:%S",
    stream=sys.stdout,
)
log = logging.getLogger("server_ids")

# ── Файл инцидентов ───────────────────────────────────────────────────────────
_incident_lock = threading.Lock()


def log_incident(source_addr: str, reason: str, raw_data: str):
    """Записывает инцидент безопасности в файл."""
    ts = datetime.utcnow().isoformat(timespec="seconds") + "Z"
    entry = f"[{ts}] SOURCE={source_addr} REASON={reason} RAW={raw_data[:200]}\n"
    with _incident_lock:
        with open(config.SECURITY_LOG_FILE, "a", encoding="utf-8") as f:
            f.write(entry)
    log.warning(f"INCIDENT LOGGED — {reason} from {source_addr}")


# ── IDS ───────────────────────────────────────────────────────────────────────

class IntrusionDetectionSystem:
    """
    Stateful IDS с двумя типами детекции:
      1. Integrity check — HMAC-SHA256 подпись пакета.
      2. Rate limiting   — количество пакетов за скользящее окно (DoS).
    """

    def __init__(self):
        # source_addr → deque of timestamps (скользящее окно 1 сек)
        self._rate_tracker: dict[str, deque] = defaultdict(lambda: deque())
        self._rate_lock = threading.Lock()

    # ── Целостность ──────────────────────────────────────────────────────────

    @staticmethod
    def _compute_signature(payload: dict) -> str:
        """Пересчитываем подпись без поля 'signature'."""
        clean = {k: v for k, v in payload.items() if k != "signature"}
        body = json.dumps(clean, sort_keys=True).encode()
        return hmac.new(config.HMAC_SECRET, body, hashlib.sha256).hexdigest()

    def check_integrity(self, packet: dict) -> tuple[bool, str]:
        """Возвращает (ok, reason)."""
        if "signature" not in packet:
            return False, "MISSING_SIGNATURE"
        expected = self._compute_signature(packet)
        received = packet.get("signature", "")
        if not hmac.compare_digest(expected, received):
            return False, "SIGNATURE_MISMATCH"
        return True, "OK"

    # ── Rate limiting ─────────────────────────────────────────────────────────

    def check_rate(self, source_addr: str) -> tuple[bool, str]:
        """Возвращает (ok, reason). Использует скользящее окно 1 сек."""
        now = time.monotonic()
        with self._rate_lock:
            dq = self._rate_tracker[source_addr]
            # Убираем записи старше 1 секунды
            while dq and now - dq[0] > 1.0:
                dq.popleft()
            dq.append(now)
            rate = len(dq)

        if rate > config.DOS_RATE_THRESHOLD:
            return False, f"DOS_FLOOD (rate={rate} pkt/s > threshold={config.DOS_RATE_THRESHOLD})"
        return True, "OK"

    # ── Главный метод ─────────────────────────────────────────────────────────

    def inspect(self, raw_line: str, source_addr: str) -> tuple[bool, str, dict | None]:
        """
        Возвращает (is_valid, reason, parsed_packet).
        is_valid=False → пакет MALICIOUS.
        """
        # 1. Rate check (работает даже для мусорных DoS-пакетов)
        rate_ok, rate_reason = self.check_rate(source_addr)
        if not rate_ok:
            return False, rate_reason, None

        # 2. JSON parse
        try:
            packet = json.loads(raw_line.strip())
        except json.JSONDecodeError:
            return False, "INVALID_JSON", None

        # 3. Обязательные поля
        required = {"timestamp", "astro_id", "heart_rate", "spO2",
                    "radiation_level", "status_text", "signature"}
        missing = required - set(packet.keys())
        if missing:
            return False, f"MISSING_FIELDS:{missing}", None

        # 4. Integrity
        integrity_ok, integrity_reason = self.check_integrity(packet)
        if not integrity_ok:
            return False, integrity_reason, None

        # 5. Sanity ranges (базовая аномалия)
        hr = packet.get("heart_rate", 0)
        spo2 = packet.get("spO2", 0)
        if not (20 <= hr <= 220):
            return False, f"RANGE_VIOLATION:HR={hr}", None
        if not (50 <= spo2 <= 100):
            return False, f"RANGE_VIOLATION:SpO2={spo2}", None

        return True, "OK", packet


# ── Обработчик клиента ────────────────────────────────────────────────────────

class ClientHandler(threading.Thread):
    """Один поток на одно TCP-соединение."""

    def __init__(
        self,
        conn: socket.socket,
        addr: tuple,
        ids: IntrusionDetectionSystem,
        data_queue: queue.Queue,
        alert_queue: queue.Queue,
    ):
        super().__init__(daemon=True)
        self.conn = conn
        self.addr_str = f"{addr[0]}:{addr[1]}"
        self.ids = ids
        self.data_queue = data_queue
        self.alert_queue = alert_queue
        self._running = True

    def run(self):
        log.info(f"Client connected: {self.addr_str}")
        buffer = ""
        try:
            self.conn.settimeout(5.0)
            while self._running:
                try:
                    chunk = self.conn.recv(config.BUFFER_SIZE).decode("utf-8", errors="replace")
                    if not chunk:
                        break
                    buffer += chunk
                    # Обрабатываем все полные строки (разделитель \n)
                    while "\n" in buffer:
                        line, buffer = buffer.split("\n", 1)
                        line = line.strip()
                        if not line:
                            continue
                        self._process_line(line)
                except socket.timeout:
                    continue
        except (ConnectionResetError, OSError) as e:
            log.debug(f"Client {self.addr_str} disconnected: {e}")
        finally:
            self.conn.close()
            log.info(f"Client disconnected: {self.addr_str}")

    def _process_line(self, line: str):
        is_valid, reason, packet = self.ids.inspect(line, self.addr_str)
        if is_valid:
            self.data_queue.put(packet)
        else:
            # Вредоносный пакет
            log_incident(self.addr_str, reason, line)
            alert = {
                "timestamp": time.time(),
                "source": self.addr_str,
                "reason": reason,
                "raw_preview": line[:100],
            }
            self.alert_queue.put(alert)

    def stop(self):
        self._running = False


# ── TCP-сервер ────────────────────────────────────────────────────────────────

class IDSServer(threading.Thread):
    """
    TCP-сервер, принимающий соединения от generator_red_team.
    Работает в отдельном потоке, не блокирует GUI.
    """

    def __init__(self, data_queue: queue.Queue, alert_queue: queue.Queue):
        super().__init__(daemon=True, name="IDSServer")
        self.data_queue = data_queue
        self.alert_queue = alert_queue
        self.ids = IntrusionDetectionSystem()
        self._server_sock: socket.socket | None = None
        self._running = False
        self._clients: list[ClientHandler] = []

    def run(self):
        self._running = True
        self._server_sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self._server_sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            self._server_sock.bind((config.HOST, config.PORT))
            self._server_sock.listen(10)
            self._server_sock.settimeout(1.0)
            log.info(f"IDS Server listening on {config.HOST}:{config.PORT}")
        except OSError as e:
            log.error(f"Cannot bind server: {e}")
            return

        while self._running:
            try:
                conn, addr = self._server_sock.accept()
                handler = ClientHandler(
                    conn, addr, self.ids, self.data_queue, self.alert_queue
                )
                handler.start()
                self._clients.append(handler)
                # Чистим завершённые
                self._clients = [c for c in self._clients if c.is_alive()]
            except socket.timeout:
                continue
            except OSError:
                break

        log.info("IDS Server stopped.")

    def stop(self):
        self._running = False
        for c in self._clients:
            c.stop()
        if self._server_sock:
            self._server_sock.close()
        log.info("IDS Server shutdown complete.")


# ── Точка входа (автономный запуск без GUI) ───────────────────────────────────

if __name__ == "__main__":
    dq: queue.Queue = queue.Queue()
    aq: queue.Queue = queue.Queue()
    server = IDSServer(dq, aq)
    server.start()

    try:
        while True:
            # В автономном режиме просто распечатываем очереди
            while not dq.empty():
                pkt = dq.get_nowait()
                log.info(f"[HEALTH] astro={pkt['astro_id']} HR={pkt['heart_rate']} "
                         f"SpO2={pkt['spO2']} RAD={pkt['radiation_level']}")
            while not aq.empty():
                alert = aq.get_nowait()
                log.warning(f"[ALERT] {alert['reason']} from {alert['source']}")
            time.sleep(0.5)
    except KeyboardInterrupt:
        server.stop()
        log.info("Goodbye.")
