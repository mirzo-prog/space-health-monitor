"""
gui_dashboard.py — Главное окно Space Health Monitor & IDS

Запуск: python gui_dashboard.py
(запускает встроенный IDS-сервер + AI-анализатор автоматически)

Особенности:
  - Frameless window + полупрозрачный тёмный фон (Sci-Fi стиль)
  - pyqtgraph: графики пульса, SpO2, радиации в реальном времени
  - Виджет алертов IDS (красным)
  - Виджет ИИ-ассистента
  - Перетаскивание окна мышью (т.к. рамки нет)
"""

import queue
import sys
import time
from collections import defaultdict, deque

import numpy as np
import pyqtgraph as pg
from PyQt5.QtCore import (
    QObject, QPoint, Qt, QThread, QTimer, pyqtSignal, pyqtSlot,
)
from PyQt5.QtGui import QColor, QFont, QFontDatabase, QPainter, QPalette
from PyQt5.QtWidgets import (
    QApplication, QFrame, QGraphicsDropShadowEffect, QHBoxLayout,
    QLabel, QMainWindow, QScrollArea, QSizePolicy, QSplitter,
    QTextEdit, QVBoxLayout, QWidget,
)

import config
from ai_analyzer import AIAnalyzer
from server_ids import IDSServer

# ── PyQtGraph глобальные настройки ───────────────────────────────────────────
pg.setConfigOption("background", config.COLORS["background"])
pg.setConfigOption("foreground", config.COLORS["text"])
pg.setConfigOption("antialias", True)


# ── Мост очередей → Qt-сигналы ───────────────────────────────────────────────

class QueueBridge(QObject):
    """
    Работает в основном потоке (QTimer), опрашивает обе очереди
    и испускает Qt-сигналы — потокобезопасно.
    """
    health_received = pyqtSignal(dict)
    alert_received  = pyqtSignal(dict)
    ai_result       = pyqtSignal(str)

    def __init__(
        self,
        data_queue: queue.Queue,
        alert_queue: queue.Queue,
        parent: QObject | None = None,
    ):
        super().__init__(parent)
        self.data_queue = data_queue
        self.alert_queue = alert_queue

        self._timer = QTimer(self)
        self._timer.setInterval(200)  # опрос каждые 200 мс
        self._timer.timeout.connect(self._poll)
        self._timer.start()

    @pyqtSlot()
    def _poll(self):
        while not self.data_queue.empty():
            try:
                pkt = self.data_queue.get_nowait()
                self.health_received.emit(pkt)
            except queue.Empty:
                break
        while not self.alert_queue.empty():
            try:
                alert = self.alert_queue.get_nowait()
                self.alert_received.emit(alert)
            except queue.Empty:
                break

    def emit_ai(self, text: str):
        """Thread-safe вызов из AIAnalyzer (фонового потока)."""
        self.ai_result.emit(text)


# ── Вспомогательные виджеты ───────────────────────────────────────────────────

def _make_panel(title: str = "") -> tuple[QFrame, QVBoxLayout]:
    """Создаёт тёмную панель с рамкой в sci-fi стиле."""
    frame = QFrame()
    frame.setObjectName("Panel")
    frame.setStyleSheet(f"""
        QFrame#Panel {{
            background-color: {config.COLORS['panel']};
            border: 1px solid {config.COLORS['panel_border']};
            border-radius: 8px;
        }}
    """)
    lay = QVBoxLayout(frame)
    lay.setContentsMargins(12, 10, 12, 12)
    lay.setSpacing(6)
    if title:
        lbl = QLabel(title)
        lbl.setStyleSheet(
            f"color: {config.COLORS['accent']};"
            f"font-size: 11px; font-weight: bold; letter-spacing: 2px;"
            f"border: none; padding: 0;"
        )
        lay.addWidget(lbl)
    return frame, lay


def _make_label(text: str, size: int = 12, color: str = None, bold: bool = False) -> QLabel:
    c = color or config.COLORS["text"]
    w = "bold" if bold else "normal"
    lbl = QLabel(text)
    lbl.setStyleSheet(f"color: {c}; font-size: {size}px; font-weight: {w};")
    return lbl


# ── График одного показателя ──────────────────────────────────────────────────

class MetricGraph(QWidget):
    """Плавный pyqtgraph-виджет для одного показателя (несколько линий по astro_id)."""

    def __init__(
        self,
        title: str,
        unit: str,
        y_range: tuple,
        line_colors: dict[int, str],
        parent=None,
    ):
        super().__init__(parent)
        self._history: dict[int, deque] = {
            aid: deque([0.0] * config.GRAPH_HISTORY_LEN, maxlen=config.GRAPH_HISTORY_LEN)
            for aid in config.ASTRONAUT_IDS
        }
        self._colors = line_colors

        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)

        self.plot_widget = pg.PlotWidget(title=f"<span style='color:{config.COLORS['accent']}'>{title}</span>")
        self.plot_widget.setYRange(*y_range)
        self.plot_widget.showGrid(x=True, y=True, alpha=0.15)
        self.plot_widget.setLabel("left", unit, color=config.COLORS["text_dim"])
        self.plot_widget.getAxis("bottom").setStyle(showValues=False)
        self.plot_widget.setBackground(config.COLORS["panel"])

        # Линии для каждого космонавта
        self._curves: dict[int, pg.PlotDataItem] = {}
        for aid in config.ASTRONAUT_IDS:
            color = self._colors.get(aid, "#FFFFFF")
            pen = pg.mkPen(color=color, width=2)
            curve = self.plot_widget.plot(
                np.zeros(config.GRAPH_HISTORY_LEN),
                pen=pen,
                name=config.ASTRONAUT_NAMES.get(aid, f"ID-{aid}"),
            )
            self._curves[aid] = curve

        # Легенда
        legend = self.plot_widget.addLegend(
            offset=(10, 10),
            labelTextColor=config.COLORS["text"],
        )
        layout.addWidget(self.plot_widget)

    def push(self, astro_id: int, value: float):
        if astro_id in self._history:
            self._history[astro_id].append(value)
            self._curves[astro_id].setData(list(self._history[astro_id]))


# ── Статус-карточка космонавта ────────────────────────────────────────────────

class AstronautCard(QFrame):
    """Маленькая карточка с текущим HR / SpO2 / RAD и цветным статусом."""

    STATUS_COLORS = {
        "NOMINAL":   config.COLORS["alert_green"],
        "WARNING":   config.COLORS["alert_orange"],
        "CRITICAL":  config.COLORS["alert_red"],
        "INJECTED":  "#FF00FF",
    }

    def __init__(self, astro_id: int, parent=None):
        super().__init__(parent)
        self.astro_id = astro_id
        name = config.ASTRONAUT_NAMES.get(astro_id, f"ID-{astro_id}")

        self.setObjectName("AstroCard")
        self.setFixedWidth(200)
        self.setStyleSheet(f"""
            QFrame#AstroCard {{
                background: {config.COLORS['panel']};
                border: 1px solid {config.COLORS['panel_border']};
                border-radius: 8px;
            }}
        """)

        lay = QVBoxLayout(self)
        lay.setContentsMargins(10, 8, 10, 10)
        lay.setSpacing(3)

        self.name_lbl = _make_label(name, 11, config.COLORS["accent"], bold=True)
        lay.addWidget(self.name_lbl)

        self.hr_lbl   = _make_label("HR: —", 13, config.COLORS["hr_line"])
        self.spo2_lbl = _make_label("SpO2: —", 13, config.COLORS["spo2_line"])
        self.rad_lbl  = _make_label("RAD: —", 13, config.COLORS["rad_line"])
        self.status_lbl = _make_label("WAIT", 10, config.COLORS["text_dim"], bold=True)

        for w in (self.hr_lbl, self.spo2_lbl, self.rad_lbl, self.status_lbl):
            lay.addWidget(w)

    def update_data(self, pkt: dict):
        self.hr_lbl.setText(f"HR: {pkt['heart_rate']:.1f} bpm")
        self.spo2_lbl.setText(f"SpO2: {pkt['spO2']:.1f}%")
        self.rad_lbl.setText(f"RAD: {pkt['radiation_level']:.3f} μSv/h")
        status = pkt.get("status_text", "NOMINAL")
        color = self.STATUS_COLORS.get(status, config.COLORS["text"])
        self.status_lbl.setText(f"◉ {status}")
        self.status_lbl.setStyleSheet(f"color: {color}; font-size: 10px; font-weight: bold;")


# ── Главное окно ──────────────────────────────────────────────────────────────

class SpaceDashboard(QMainWindow):
    def __init__(
        self,
        data_queue: queue.Queue,
        alert_queue: queue.Queue,
    ):
        super().__init__()

        # ── Оконные настройки ────────────────────────────────────────────────
        self.setWindowTitle(config.WINDOW_TITLE)
        self.resize(config.WINDOW_WIDTH, config.WINDOW_HEIGHT)
        self.setWindowOpacity(config.WINDOW_OPACITY)

        # Frameless + прозрачный фон
        self.setWindowFlags(
            Qt.FramelessWindowHint |
            Qt.WindowStaysOnTopHint  # опционально; уберите если мешает
        )
        self.setAttribute(Qt.WA_TranslucentBackground, False)

        # Глобальный стиль
        self.setStyleSheet(f"""
            QMainWindow, QWidget {{
                background-color: {config.COLORS['background']};
                color: {config.COLORS['text']};
                font-family: 'Monospace', 'Courier New', monospace;
                font-size: 12px;
            }}
            QScrollBar:vertical {{
                background: {config.COLORS['panel']};
                width: 8px;
                border-radius: 4px;
            }}
            QScrollBar::handle:vertical {{
                background: {config.COLORS['panel_border']};
                border-radius: 4px;
            }}
            QTextEdit {{
                background-color: {config.COLORS['panel']};
                border: 1px solid {config.COLORS['panel_border']};
                border-radius: 6px;
                color: {config.COLORS['text']};
                font-family: monospace;
                font-size: 11px;
            }}
        """)

        # Перетаскивание (drag) окна без рамки
        self._drag_pos: QPoint | None = None

        # ── Данные ───────────────────────────────────────────────────────────
        self._packet_count = 0
        self._alert_count  = 0
        self._last_ai_text = "Ожидание данных…"

        # ── Мост очередей → сигналы ──────────────────────────────────────────
        self.bridge = QueueBridge(data_queue, alert_queue, self)
        self.bridge.health_received.connect(self._on_health)
        self.bridge.alert_received.connect(self._on_alert)
        self.bridge.ai_result.connect(self._on_ai_result)

        # ── Строим UI ────────────────────────────────────────────────────────
        central = QWidget()
        self.setCentralWidget(central)
        root_lay = QVBoxLayout(central)
        root_lay.setContentsMargins(12, 10, 12, 10)
        root_lay.setSpacing(8)

        root_lay.addWidget(self._build_header())

        splitter = QSplitter(Qt.Horizontal)
        splitter.setHandleWidth(6)
        splitter.setStyleSheet("QSplitter::handle { background: #1A2A4A; }")

        # Левая колонка: карточки + графики
        left = QWidget()
        left_lay = QVBoxLayout(left)
        left_lay.setContentsMargins(0, 0, 0, 0)
        left_lay.setSpacing(8)
        left_lay.addLayout(self._build_astro_cards())
        left_lay.addWidget(self._build_graphs(), stretch=1)
        splitter.addWidget(left)

        # Правая колонка: алерты + ИИ
        right = QWidget()
        right_lay = QVBoxLayout(right)
        right_lay.setContentsMargins(0, 0, 0, 0)
        right_lay.setSpacing(8)
        right_lay.addWidget(self._build_ids_panel(), stretch=2)
        right_lay.addWidget(self._build_ai_panel(), stretch=1)
        splitter.addWidget(right)

        splitter.setSizes([int(config.WINDOW_WIDTH * 0.70), int(config.WINDOW_WIDTH * 0.30)])
        root_lay.addWidget(splitter, stretch=1)

        root_lay.addWidget(self._build_status_bar())

        # ── Таймер заголовка (часы) ──────────────────────────────────────────
        self._clock_timer = QTimer(self)
        self._clock_timer.setInterval(1000)
        self._clock_timer.timeout.connect(self._update_clock)
        self._clock_timer.start()

    # ══════════════════════════════════════════════════════════════════════════
    # Построители UI
    # ══════════════════════════════════════════════════════════════════════════

    def _build_header(self) -> QWidget:
        frame, lay = _make_panel()
        lay.setContentsMargins(16, 8, 16, 8)
        h = QHBoxLayout()
        h.setSpacing(16)

        # Лого / название
        logo = _make_label("🛸  SPACE HEALTH MONITOR", 16, config.COLORS["accent"], bold=True)
        logo.setStyleSheet(
            f"color: {config.COLORS['accent']}; font-size: 16px; font-weight: bold;"
            f"letter-spacing: 3px; border: none;"
        )
        h.addWidget(logo)
        h.addStretch()

        # IDS статус
        self.ids_badge = _make_label("🛡 IDS ACTIVE", 11, config.COLORS["alert_green"], bold=True)
        h.addWidget(self.ids_badge)

        # Часы UTC
        self.clock_lbl = _make_label("UTC --:--:--", 11, config.COLORS["text_dim"])
        h.addWidget(self.clock_lbl)

        # Кнопка закрытия
        close_btn = QLabel("✕")
        close_btn.setStyleSheet(
            f"color: {config.COLORS['alert_red']}; font-size: 16px;"
            f"padding: 2px 8px; border-radius: 4px;"
        )
        close_btn.setCursor(Qt.PointingHandCursor)
        close_btn.mousePressEvent = lambda e: QApplication.quit()
        h.addWidget(close_btn)

        lay.addLayout(h)
        return frame

    def _build_astro_cards(self) -> QHBoxLayout:
        h = QHBoxLayout()
        h.setSpacing(10)
        self._cards: dict[int, AstronautCard] = {}
        for aid in config.ASTRONAUT_IDS:
            card = AstronautCard(aid)
            self._cards[aid] = card
            h.addWidget(card)
        h.addStretch()
        return h

    def _build_graphs(self) -> QWidget:
        frame, lay = _make_panel("БИОМЕТРИЯ В РЕАЛЬНОМ ВРЕМЕНИ")

        # Цвета линий по астронавту
        hr_colors   = {1: "#00D4FF", 2: "#00FF9F", 3: "#FF8C00"}
        spo2_colors = {1: "#00FF9F", 2: "#00D4FF", 3: "#FFDD44"}
        rad_colors  = {1: "#FF8C00", 2: "#FF4444", 3: "#CC88FF"}

        self.hr_graph   = MetricGraph("ПУЛЬС (HR)", "bpm",   (40, 180), hr_colors)
        self.spo2_graph = MetricGraph("SpO2",        "%",    (88, 101), spo2_colors)
        self.rad_graph  = MetricGraph("РАДИАЦИЯ",   "μSv/h", (0, 15),   rad_colors)

        # Горизонтальная ссылочная линия нормы для SpO2
        ref_line = pg.InfiniteLine(
            pos=config.BASELINE["spO2"]["min"],
            angle=0,
            pen=pg.mkPen(color="#FF3B3B", width=1, style=Qt.DashLine),
            label="Min 94%",
            labelOpts={"color": "#FF3B3B", "position": 0.05},
        )
        self.spo2_graph.plot_widget.addItem(ref_line)

        for g in (self.hr_graph, self.spo2_graph, self.rad_graph):
            lay.addWidget(g, stretch=1)

        return frame

    def _build_ids_panel(self) -> QWidget:
        frame, lay = _make_panel("🚨  IDS — ЖУРНАЛ ИНЦИДЕНТОВ БЕЗОПАСНОСТИ")

        self.ids_log = QTextEdit()
        self.ids_log.setReadOnly(True)
        self.ids_log.setMinimumHeight(120)
        self.ids_log.setPlaceholderText("Нет инцидентов…")
        lay.addWidget(self.ids_log)

        # Счётчики
        h = QHBoxLayout()
        self.packet_count_lbl = _make_label("Пакетов: 0", 10, config.COLORS["text_dim"])
        self.alert_count_lbl  = _make_label("Алертов: 0", 10, config.COLORS["alert_red"])
        h.addWidget(self.packet_count_lbl)
        h.addStretch()
        h.addWidget(self.alert_count_lbl)
        lay.addLayout(h)

        return frame

    def _build_ai_panel(self) -> QWidget:
        frame, lay = _make_panel("🤖  ИИ-АССИСТЕНТ (Ollama)")

        self.ai_text = QTextEdit()
        self.ai_text.setReadOnly(True)
        self.ai_text.setPlaceholderText("Анализ не запускался…")
        self.ai_text.setStyleSheet(
            f"color: {config.COLORS['accent2']};"
            f"background: {config.COLORS['panel']};"
            f"border: 1px solid {config.COLORS['panel_border']};"
            f"border-radius: 6px; font-size: 12px;"
        )
        lay.addWidget(self.ai_text)

        self.ai_status_lbl = _make_label(
            f"Модель: {config.OLLAMA_MODEL}  |  Интервал: {config.AI_ANALYSIS_INTERVAL}s",
            9, config.COLORS["text_dim"]
        )
        lay.addWidget(self.ai_status_lbl)

        return frame

    def _build_status_bar(self) -> QWidget:
        frame, lay = _make_panel()
        lay.setContentsMargins(12, 4, 12, 4)
        h = QHBoxLayout()
        h.setSpacing(20)

        self.status_lbl = _make_label(
            f"HOST: {config.HOST}:{config.PORT}  |  ASTRONAUTS: {len(config.ASTRONAUT_IDS)}  |  IDS: ON",
            10, config.COLORS["text_dim"]
        )
        h.addWidget(self.status_lbl)
        h.addStretch()

        self.fps_lbl = _make_label("PKT/s: 0.0", 10, config.COLORS["text_dim"])
        h.addWidget(self.fps_lbl)

        lay.addLayout(h)
        return frame

    # ══════════════════════════════════════════════════════════════════════════
    # Слоты (обновление данных)
    # ══════════════════════════════════════════════════════════════════════════

    @pyqtSlot(dict)
    def _on_health(self, pkt: dict):
        aid = pkt.get("astro_id")
        if aid not in config.ASTRONAUT_IDS:
            return

        # Обновляем карточку
        if aid in self._cards:
            self._cards[aid].update_data(pkt)

        # Обновляем графики
        self.hr_graph.push(aid,   pkt.get("heart_rate", 0))
        self.spo2_graph.push(aid, pkt.get("spO2", 0))
        self.rad_graph.push(aid,  pkt.get("radiation_level", 0))

        # Счётчик пакетов
        self._packet_count += 1
        self.packet_count_lbl.setText(f"Пакетов: {self._packet_count}")

    @pyqtSlot(dict)
    def _on_alert(self, alert: dict):
        self._alert_count += 1
        self.alert_count_lbl.setText(f"🚨 Алертов: {self._alert_count}")

        ts = time.strftime("%H:%M:%S", time.localtime(alert.get("timestamp", time.time())))
        reason = alert.get("reason", "UNKNOWN")
        source = alert.get("source", "?")
        preview = alert.get("raw_preview", "")[:80]

        # Определяем цвет по типу атаки
        if "MITM" in reason or "SIGNATURE" in reason:
            color = config.COLORS["alert_red"]
            icon  = "⚠ MITM"
        elif "DOS" in reason or "FLOOD" in reason:
            color = config.COLORS["alert_orange"]
            icon  = "⛔ DoS"
        else:
            color = config.COLORS["alert_orange"]
            icon  = "⚠ IDS"

        html = (
            f'<span style="color:{color}; font-weight:bold;">'
            f'[{ts}] {icon} | {reason}</span>'
            f'<br><span style="color:{config.COLORS["text_dim"]}; font-size:10px;">'
            f'  SRC: {source} | {preview}</span><br>'
        )
        self.ids_log.append(html)

        # Скролл вниз
        sb = self.ids_log.verticalScrollBar()
        sb.setValue(sb.maximum())

        # Мигание badge
        self.ids_badge.setText("🚨 IDS ALERT")
        self.ids_badge.setStyleSheet(f"color: {config.COLORS['alert_red']}; font-size: 11px; font-weight: bold;")
        QTimer.singleShot(2000, self._reset_ids_badge)

    @pyqtSlot(str)
    def _on_ai_result(self, text: str):
        self._last_ai_text = text
        ts = time.strftime("%H:%M:%S")
        self.ai_text.setPlainText(f"[{ts}]\n{text}")

    def _reset_ids_badge(self):
        self.ids_badge.setText("🛡 IDS ACTIVE")
        self.ids_badge.setStyleSheet(
            f"color: {config.COLORS['alert_green']}; font-size: 11px; font-weight: bold;"
        )

    def _update_clock(self):
        import datetime
        utc = datetime.datetime.utcnow().strftime("%H:%M:%S")
        self.clock_lbl.setText(f"UTC {utc}")

    # ══════════════════════════════════════════════════════════════════════════
    # Перетаскивание окна
    # ══════════════════════════════════════════════════════════════════════════

    def mousePressEvent(self, event):
        if event.button() == Qt.LeftButton:
            self._drag_pos = event.globalPos() - self.frameGeometry().topLeft()
            event.accept()

    def mouseMoveEvent(self, event):
        if event.buttons() == Qt.LeftButton and self._drag_pos is not None:
            self.move(event.globalPos() - self._drag_pos)
            event.accept()

    def mouseReleaseEvent(self, event):
        self._drag_pos = None

    # ══════════════════════════════════════════════════════════════════════════
    # Закрытие приложения
    # ══════════════════════════════════════════════════════════════════════════

    def closeEvent(self, event):
        # Сигнализируем всем фоновым сервисам остановиться
        if hasattr(self, "_ids_server"):
            self._ids_server.stop()
        if hasattr(self, "_ai_analyzer"):
            self._ai_analyzer.stop()
        event.accept()


# ── Точка входа ───────────────────────────────────────────────────────────────

def main():
    import logging
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(name)-12s] %(levelname)s %(message)s",
        datefmt="%H:%M:%S",
    )

    app = QApplication(sys.argv)
    app.setApplicationName("Space Health Monitor")

    # Общие очереди (потокобезопасные)
    data_queue:  queue.Queue = queue.Queue(maxsize=500)
    alert_queue: queue.Queue = queue.Queue(maxsize=200)

    # ── Запуск IDS-сервера ────────────────────────────────────────────────────
    ids_server = IDSServer(data_queue, alert_queue)
    ids_server.start()

    # ── GUI ───────────────────────────────────────────────────────────────────
    window = SpaceDashboard(data_queue, alert_queue)
    window._ids_server = ids_server  # для корректного закрытия

    # ── AI Analyzer (нужна отдельная очередь - AI читает свою копию) ──────────
    # Создаём "дублирующую" очередь через прокси в bridge
    ai_data_queue: queue.Queue = queue.Queue(maxsize=500)

    def _health_forwarder(pkt: dict):
        try:
            ai_data_queue.put_nowait(pkt)
        except queue.Full:
            pass

    # Соединяем сигнал
    window.bridge.health_received.connect(lambda pkt: _health_forwarder(pkt))

    ai_analyzer = AIAnalyzer(
        data_queue=ai_data_queue,
        on_result=window.bridge.emit_ai,
    )
    ai_analyzer.start()
    window._ai_analyzer = ai_analyzer

    window.show()

    exit_code = app.exec_()

    # Корректное завершение
    ids_server.stop()
    ai_analyzer.stop()
    ids_server.join(timeout=3)

    sys.exit(exit_code)


if __name__ == "__main__":
    main()
