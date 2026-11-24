import tkinter as tk
import tkinter.font as tkfont
import ctypes
from ctypes import wintypes
import sys
import os
import json
import math
import base64
import queue
import subprocess
import threading
import urllib.parse
import urllib.request
import urllib.error
from datetime import datetime


def _hide_console_window_on_windows():
    if not sys.platform.startswith("win"):
        return
    try:
        hwnd = ctypes.windll.kernel32.GetConsoleWindow()
        if hwnd:
            ctypes.windll.user32.ShowWindow(hwnd, 0)
    except Exception:
        # If console API is unavailable, continue without failing app startup.
        pass


def _set_windows_app_user_model_id():
    if not sys.platform.startswith("win"):
        return
    try:
        ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID("tugu.clock.topmost")
    except Exception:
        pass


def _ensure_pythonw_on_windows():
    if not sys.platform.startswith("win"):
        return
    if os.environ.get("CLOCK_DISABLE_PYTHONW_RELAUNCH") == "1":
        return
    if sys.stdout is not None and sys.stdout.isatty():
        return

    script_dir = os.path.dirname(os.path.abspath(__file__))
    preferred_pythonw = os.path.join(script_dir, ".venv", "Scripts", "pythonw.exe")

    executable_name = os.path.basename(sys.executable).lower()
    current_executable = os.path.abspath(sys.executable)

    if os.path.exists(preferred_pythonw):
        target_pythonw = preferred_pythonw
    else:
        if executable_name == "pythonw.exe":
            return
        target_pythonw = os.path.join(os.path.dirname(current_executable), "pythonw.exe")
        if not os.path.exists(target_pythonw):
            return

    if executable_name == "pythonw.exe" and os.path.normcase(current_executable) == os.path.normcase(target_pythonw):
        return

    creation_flags = 0
    if hasattr(subprocess, "DETACHED_PROCESS"):
        creation_flags |= subprocess.DETACHED_PROCESS
    if hasattr(subprocess, "CREATE_NEW_PROCESS_GROUP"):
        creation_flags |= subprocess.CREATE_NEW_PROCESS_GROUP

    env = os.environ.copy()
    env["CLOCK_DISABLE_PYTHONW_RELAUNCH"] = "1"

    subprocess.Popen(
        [target_pythonw, os.path.abspath(__file__), *sys.argv[1:]],
        cwd=os.path.dirname(os.path.abspath(__file__)),
        creationflags=creation_flags,
        close_fds=True,
        env=env,
    )
    raise SystemExit(0)


DIGIT_MAP = {
    0: ("a", "b", "c", "d", "e", "f"),
    1: ("b", "c"),
    2: ("a", "b", "g", "e", "d"),
    3: ("a", "b", "g", "c", "d"),
    4: ("f", "g", "b", "c"),
    5: ("a", "f", "g", "c", "d"),
    6: ("a", "f", "g", "e", "c", "d"),
    7: ("a", "b", "c"),
    8: ("a", "b", "c", "d", "e", "f", "g"),
    9: ("a", "b", "c", "d", "f", "g"),
}

WEEKDAYS = ("MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN")

ON_COLOR = "#ffffff"
OFF_COLOR = "#2a2a2a"

WINDOW_BG = "#000000"
PANEL_BG = "#0a0a0a"
TEXT_COLOR = "#ffffff"
MUTED_TEXT_COLOR = "#b8b8b8"
BUTTON_BG = "#1a1a1a"
BUTTON_ACTIVE_BG = "#2a2a2a"
SCALE_TROUGH_COLOR = "#303030"
GRIP_COLOR = "#7a7a7a"

ACCENT_COLOR = "#5fd7ff"
CARD_BG = "#121212"
CARD_BORDER = "#242424"
WEATHER_UPDATE_INTERVAL_SEC = 10 * 60
RADAR_UPDATE_INTERVAL_SEC = 5 * 60
RADAR_DEFAULT_CITY = "Toyota"
RADAR_DEFAULT_LAT = 35.083
RADAR_DEFAULT_LON = 137.156
RADAR_DEFAULT_ZOOM = 7
RADAR_STATE_FILE = "clock_radar_state.json"
RADAR_FOCUS_X_RATIO = 0.46
RADAR_FOCUS_Y_RATIO = 0.44
PAGE_SWITCH_INTERVAL_SEC = 9
SLIDE_STEPS = 22
SLIDE_INTERVAL_MS = 14
WMO_WEATHER = {
    0: "Clear",
    1: "Mainly clear",
    2: "Partly cloudy",
    3: "Overcast",
    45: "Fog",
    48: "Rime fog",
    51: "Drizzle",
    53: "Drizzle",
    55: "Drizzle",
    56: "Freezing drizzle",
    57: "Freezing drizzle",
    61: "Rain",
    63: "Rain",
    65: "Heavy rain",
    66: "Freezing rain",
    67: "Freezing rain",
    71: "Snow",
    73: "Snow",
    75: "Heavy snow",
    77: "Snow grains",
    80: "Rain showers",
    81: "Rain showers",
    82: "Violent showers",
    85: "Snow showers",
    86: "Snow showers",
    95: "Thunderstorm",
    96: "Thunderstorm hail",
    99: "Thunderstorm hail",
}

GWL_EXSTYLE = -20
WS_EX_LAYERED = 0x00080000
WS_EX_TRANSPARENT = 0x00000020
WS_EX_TOOLWINDOW = 0x00000080
WS_EX_APPWINDOW = 0x00040000
LWA_ALPHA = 0x00000002
SWP_NOSIZE = 0x0001
SWP_NOMOVE = 0x0002
SWP_NOZORDER = 0x0004
SWP_FRAMECHANGED = 0x0020


class RECT(ctypes.Structure):
    _fields_ = [
        ("left", wintypes.LONG),
        ("top", wintypes.LONG),
        ("right", wintypes.LONG),
        ("bottom", wintypes.LONG),
    ]


class MONITORINFO(ctypes.Structure):
    _fields_ = [
        ("cbSize", wintypes.DWORD),
        ("rcMonitor", RECT),
        ("rcWork", RECT),
        ("dwFlags", wintypes.DWORD),
    ]


class MEMORYSTATUSEX(ctypes.Structure):
    _fields_ = [
        ("dwLength", wintypes.DWORD),
        ("dwMemoryLoad", wintypes.DWORD),
        ("ullTotalPhys", ctypes.c_ulonglong),
        ("ullAvailPhys", ctypes.c_ulonglong),
        ("ullTotalPageFile", ctypes.c_ulonglong),
        ("ullAvailPageFile", ctypes.c_ulonglong),
        ("ullTotalVirtual", ctypes.c_ulonglong),
        ("ullAvailVirtual", ctypes.c_ulonglong),
        ("sullAvailExtendedVirtual", ctypes.c_ulonglong),
    ]


class FILETIME(ctypes.Structure):
    _fields_ = [
        ("dwLowDateTime", wintypes.DWORD),
        ("dwHighDateTime", wintypes.DWORD),
    ]


class PROCESS_MEMORY_COUNTERS(ctypes.Structure):
    _fields_ = [
        ("cb", wintypes.DWORD),
        ("PageFaultCount", wintypes.DWORD),
        ("PeakWorkingSetSize", ctypes.c_size_t),
        ("WorkingSetSize", ctypes.c_size_t),
        ("QuotaPeakPagedPoolUsage", ctypes.c_size_t),
        ("QuotaPagedPoolUsage", ctypes.c_size_t),
        ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t),
        ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
        ("PagefileUsage", ctypes.c_size_t),
        ("PeakPagefileUsage", ctypes.c_size_t),
    ]


class MIB_IFROW(ctypes.Structure):
    _fields_ = [
        ("wszName", wintypes.WCHAR * 256),
        ("dwIndex", wintypes.DWORD),
        ("dwType", wintypes.DWORD),
        ("dwMtu", wintypes.DWORD),
        ("dwSpeed", wintypes.DWORD),
        ("dwPhysAddrLen", wintypes.DWORD),
        ("bPhysAddr", wintypes.BYTE * 8),
        ("dwAdminStatus", wintypes.DWORD),
        ("dwOperStatus", wintypes.DWORD),
        ("dwLastChange", wintypes.DWORD),
        ("dwInOctets", wintypes.DWORD),
        ("dwInUcastPkts", wintypes.DWORD),
        ("dwInNUcastPkts", wintypes.DWORD),
        ("dwInDiscards", wintypes.DWORD),
        ("dwInErrors", wintypes.DWORD),
        ("dwInUnknownProtos", wintypes.DWORD),
        ("dwOutOctets", wintypes.DWORD),
        ("dwOutUcastPkts", wintypes.DWORD),
        ("dwOutNUcastPkts", wintypes.DWORD),
        ("dwOutDiscards", wintypes.DWORD),
        ("dwOutErrors", wintypes.DWORD),
        ("dwOutQLen", wintypes.DWORD),
        ("dwDescrLen", wintypes.DWORD),
        ("bDescr", wintypes.BYTE * 256),
    ]


class MIB_IFTABLE(ctypes.Structure):
    _fields_ = [
        ("dwNumEntries", wintypes.DWORD),
        ("table", MIB_IFROW * 1),
    ]


class PDH_FMT_COUNTERVALUE_UNION(ctypes.Union):
    _fields_ = [
        ("longValue", ctypes.c_long),
        ("doubleValue", ctypes.c_double),
        ("largeValue", ctypes.c_longlong),
    ]


class PDH_FMT_COUNTERVALUE(ctypes.Structure):
    _fields_ = [
        ("CStatus", wintypes.DWORD),
        ("Anonymous", PDH_FMT_COUNTERVALUE_UNION),
    ]


class PDH_FMT_COUNTERVALUE_ITEM_W(ctypes.Structure):
    _fields_ = [
        ("szName", wintypes.LPWSTR),
        ("FmtValue", PDH_FMT_COUNTERVALUE),
    ]


def _get_windows_rightmost_monitor_work_area():
    if not sys.platform.startswith("win"):
        return None

    user32 = ctypes.windll.user32
    monitors = []
    monitor_enum_proc = ctypes.WINFUNCTYPE(
        wintypes.BOOL,
        wintypes.HANDLE,
        wintypes.HDC,
        ctypes.POINTER(RECT),
        wintypes.LPARAM,
    )

    def _enum_callback(hmonitor, _hdc, _rect, _lparam):
        info = MONITORINFO()
        info.cbSize = ctypes.sizeof(MONITORINFO)
        if user32.GetMonitorInfoW(hmonitor, ctypes.byref(info)):
            work = info.rcWork
            monitors.append((work.left, work.top, work.right, work.bottom))
        return True

    callback_ptr = monitor_enum_proc(_enum_callback)
    if not user32.EnumDisplayMonitors(None, None, callback_ptr, 0):
        return None
    if not monitors:
        return None

    # Pick the monitor whose right edge is farthest on the virtual desktop.
    return max(monitors, key=lambda area: (area[2], -area[1]))


class SevenSegmentDigit(tk.Canvas):
    def __init__(self, parent, width, height, bg, segment_thickness, pad, **kwargs):
        super().__init__(
            parent,
            width=width,
            height=height,
            bg=bg,
            highlightthickness=0,
            bd=0,
            **kwargs,
        )
        self.width = width
        self.height = height
        self.thickness = segment_thickness
        self.pad = pad
        self.current_value = 0
        self.segment_ids = {}
        self._build_segments()

    def _build_segments(self):
        x0 = self.pad
        y0 = self.pad
        x1 = self.width - self.pad
        y1 = self.height - self.pad
        t = self.thickness
        gap = max(2, t // 4)
        mid = (y0 + y1) / 2

        h_left = x0 + t
        h_right = x1 - t

        self.segment_ids["a"] = self._poly_horizontal(h_left, y0, h_right, y0 + t)
        self.segment_ids["g"] = self._poly_horizontal(h_left, mid - t / 2, h_right, mid + t / 2)
        self.segment_ids["d"] = self._poly_horizontal(h_left, y1 - t, h_right, y1)

        vt = t
        upper_top = y0 + t - gap
        upper_bottom = mid - gap
        lower_top = mid + gap
        lower_bottom = y1 - t + gap

        self.segment_ids["f"] = self._poly_vertical(x0, upper_top, x0 + vt, upper_bottom)
        self.segment_ids["b"] = self._poly_vertical(x1 - vt, upper_top, x1, upper_bottom)
        self.segment_ids["e"] = self._poly_vertical(x0, lower_top, x0 + vt, lower_bottom)
        self.segment_ids["c"] = self._poly_vertical(x1 - vt, lower_top, x1, lower_bottom)

    def _poly_horizontal(self, left, top, right, bottom):
        skew = self.thickness * 0.45
        points = (
            left + skew,
            top,
            right - skew,
            top,
            right,
            (top + bottom) / 2,
            right - skew,
            bottom,
            left + skew,
            bottom,
            left,
            (top + bottom) / 2,
        )
        return self.create_polygon(points, fill=OFF_COLOR, outline="")

    def _poly_vertical(self, left, top, right, bottom):
        skew = self.thickness * 0.45
        points = (
            left,
            top + skew,
            (left + right) / 2,
            top,
            right,
            top + skew,
            right,
            bottom - skew,
            (left + right) / 2,
            bottom,
            left,
            bottom - skew,
        )
        return self.create_polygon(points, fill=OFF_COLOR, outline="")

    def set_number(self, value):
        self.current_value = int(value)
        active = set(DIGIT_MAP.get(int(value), ()))
        for segment_name, item_id in self.segment_ids.items():
            color = ON_COLOR if segment_name in active else OFF_COLOR
            self.itemconfig(item_id, fill=color)

    def set_segment_colors_blend(self, on_color_blend, off_color_blend):
        """Set segment colors for all active and inactive segments based on fade blend."""
        active = set(DIGIT_MAP.get(int(self.current_value), ()))
        for segment_name, item_id in self.segment_ids.items():
            color = on_color_blend if segment_name in active else off_color_blend
            try:
                self.itemconfig(item_id, fill=color)
            except tk.TclError:
                pass

    def resize_digit(self, width, height, segment_thickness, pad):
        self.width = width
        self.height = height
        self.thickness = segment_thickness
        self.pad = pad
        self.configure(width=width, height=height)
        self.delete("all")
        self.segment_ids = {}
        self._build_segments()
        self.set_number(self.current_value)


class TopmostClockApp:
    def __init__(self, root):
        self.base_width = 940
        self.base_height = 500
        self.min_width = 620
        self.min_height = 340
        self._last_size = (0, 0)
        self.root = root
        self._drag_start_x = 0
        self._drag_start_y = 0
        self._resize_start_x = 0
        self._resize_start_y = 0
        self._resize_start_width = 0
        self._resize_start_height = 0
        self._drag_exclude_widgets = set()
        self._click_through = False
        self._topmost_enabled = True
        self._alpha_value = 1.0
        self._ui_queue = queue.Queue()
        self._last_minute_key = ""
        self._last_weather_fetch = datetime.min
        self._last_radar_fetch = datetime.min
        self._last_perf_fetch = datetime.min
        self._last_status_fetch = datetime.min
        self._busy_weather = False
        self._busy_radar = False
        self._page_names = ["clock", "weather", "status"]
        self._page_index = 0
        self._current_page = "clock"
        self._default_page_switch_seconds = max(3, int(os.environ.get("CLOCK_PAGE_SECONDS", str(PAGE_SWITCH_INTERVAL_SEC))))
        self._page_switch_seconds_map = {
            "clock": max(3, int(os.environ.get("CLOCK_PAGE_SECONDS_CLOCK", "15"))),
            "weather": max(3, int(os.environ.get("CLOCK_PAGE_SECONDS_WEATHER", "9"))),
            "status": max(3, int(os.environ.get("CLOCK_PAGE_SECONDS_STATUS", "9"))),
        }
        self._fade_animating = False
        self._slide_animating = False
        self._clock_fade_ratio = 0.0
        self._weather_fade_ratio = 0.0
        self._last_weather_fade_level = -1
        self._last_radar_overlay_level = -1
        self._text_fade_widgets = []
        self._text_base_colors = {}
        self._last_weather_code = -1
        self._last_second_key = ""
        self._radar_tile_photos = []
        self._last_radar_message = "Loading radar..."
        self._script_dir = os.path.dirname(os.path.abspath(__file__))
        self._radar_state_path = os.path.join(self._script_dir, RADAR_STATE_FILE)
        self._app_started_at = datetime.now()
        self._last_cpu_times = None
        self._last_wifi_sample = None
        self._cached_wifi_text = "--"
        self._last_disk_percent = None
        self._wifi_bytes_prev = None

        self.weather_city = os.environ.get("CLOCK_CITY", "Tokyo")
        self.weather_lat = os.environ.get("CLOCK_LAT", "").strip()
        self.weather_lon = os.environ.get("CLOCK_LON", "").strip()
        self.radar_city = os.environ.get("CLOCK_RADAR_CITY", RADAR_DEFAULT_CITY).strip() or RADAR_DEFAULT_CITY
        self.radar_lat = os.environ.get("CLOCK_RADAR_LAT", "").strip()
        self.radar_lon = os.environ.get("CLOCK_RADAR_LON", "").strip()
        persisted_zoom = self._load_persisted_radar_zoom()
        radar_zoom_raw = os.environ.get("CLOCK_RADAR_ZOOM", "").strip()
        if radar_zoom_raw:
            try:
                initial_zoom = int(radar_zoom_raw)
            except ValueError:
                initial_zoom = RADAR_DEFAULT_ZOOM
        else:
            initial_zoom = RADAR_DEFAULT_ZOOM
        self.radar_zoom = max(6, min(7, initial_zoom))

        self.root.title("Fixed Topmost Clock")
        self.root.geometry(f"{self.base_width}x{self.base_height}")
        self.root.minsize(self.min_width, self.min_height)
        self.root.configure(bg=WINDOW_BG)
        self.root.attributes("-topmost", True)
        self.root.attributes("-alpha", self._alpha_value)
        self.root.overrideredirect(False)
        self.root.resizable(True, True)

        self._place_top_right(self.base_width, self.base_height)
        self._apply_toolwindow_hint()
        self._apply_taskbar_entry()
        self.root.after(80, self._refresh_taskbar_entry)

        self.root.bind("<Escape>", lambda _event: self.root.destroy())
        self.root.bind("<Button-3>", lambda _event: self.root.destroy())
        self.root.bind("<Control-t>", self._toggle_click_through)
        self.root.bind("<F6>", lambda _event: self._snap_top_right())
        self.root.bind("<Configure>", self._on_window_configure)

        self.date_font = tkfont.Font(family="Consolas", size=16, weight="bold")
        self.mode_font = tkfont.Font(family="Consolas", size=10, weight="bold")
        self.colon_font = tkfont.Font(family="Consolas", size=90, weight="bold")
        self.small_time_font = tkfont.Font(family="Consolas", size=12, weight="bold")
        self.grip_font = tkfont.Font(family="Consolas", size=12, weight="bold")
        self.section_title_font = tkfont.Font(family="Consolas", size=12, weight="bold")
        self.info_font = tkfont.Font(family="Consolas", size=12, weight="bold")
        self.small_info_font = tkfont.Font(family="Consolas", size=10, weight="normal")

        self.outer = tk.Frame(
            root,
            bg=WINDOW_BG,
            bd=0,
            highlightthickness=0,
            padx=18,
            pady=18,
        )
        self.outer.pack(fill="both", expand=True)

        self.inner = tk.Frame(
            self.outer,
            bg=PANEL_BG,
            bd=5,
            relief="flat",
            highlightbackground="#1f1f1f",
            highlightthickness=5,
            padx=22,
            pady=18,
        )
        self.inner.pack(fill="both", expand=True)

        top_row = tk.Frame(self.inner, bg=PANEL_BG)
        top_row.pack(fill="x")

        self.date_label = tk.Label(
            top_row,
            text="",
            fg=TEXT_COLOR,
            bg=PANEL_BG,
            font=self.date_font,
            anchor="e",
        )
        self.date_label.pack(side="right")

        self.mode_label = tk.Label(
            top_row,
            text="DRAG",
            fg=MUTED_TEXT_COLOR,
            bg=PANEL_BG,
            font=self.mode_font,
            anchor="w",
        )
        self.mode_label.pack(side="left")

        controls_row = tk.Frame(top_row, bg=PANEL_BG)
        controls_row.pack(side="left", padx=(14, 0))

        self.page_host = tk.Frame(self.inner, bg=PANEL_BG)
        self.page_host.pack(fill="both", expand=True, pady=(10, 10))
        self.pages = {}
        self._build_pages()

        topmost_holder = tk.Frame(controls_row, bg=PANEL_BG)
        topmost_holder.pack(side="left", padx=(0, 12))

        self.topmost_button = tk.Button(
            topmost_holder,
            text="TOP ON",
            fg=TEXT_COLOR,
            bg=BUTTON_BG,
            activebackground=BUTTON_ACTIVE_BG,
            activeforeground=TEXT_COLOR,
            relief="flat",
            bd=0,
            highlightthickness=0,
            padx=10,
            pady=3,
            font=self.mode_font,
            command=self._toggle_topmost,
            cursor="hand2",
        )
        self.topmost_button.pack(side="left")
        self._drag_exclude_widgets.add(self.topmost_button)

        alpha_holder = tk.Frame(controls_row, bg=PANEL_BG)
        alpha_holder.pack(side="left")

        self.alpha_label = tk.Label(
            alpha_holder,
            text="OPA",
            fg=MUTED_TEXT_COLOR,
            bg=PANEL_BG,
            font=self.mode_font,
            anchor="w",
        )
        self.alpha_label.pack(side="left", padx=(0, 6))

        self.alpha_scale = tk.Scale(
            alpha_holder,
            from_=35,
            to=100,
            orient="horizontal",
            length=140,
            showvalue=False,
            relief="flat",
            bd=0,
            highlightthickness=0,
            sliderrelief="flat",
            bg=PANEL_BG,
            activebackground=PANEL_BG,
            troughcolor=SCALE_TROUGH_COLOR,
            command=self._on_alpha_change,
        )
        self.alpha_scale.set(100)
        self.alpha_scale.pack(side="left")

        self.alpha_value_label = tk.Label(
            alpha_holder,
            text="100%",
            fg=MUTED_TEXT_COLOR,
            bg=PANEL_BG,
            font=self.mode_font,
            anchor="w",
            width=4,
        )
        self.alpha_value_label.pack(side="left", padx=(6, 0))

        self._drag_exclude_widgets.add(self.alpha_scale)

        self.sec_holder = tk.Frame(self.inner, bg=PANEL_BG)
        self.sec_holder.place(relx=1.0, rely=1.0, anchor="se", x=-18, y=-34)

        self.sec_digits_frame = tk.Frame(self.sec_holder, bg=PANEL_BG)
        self.sec_1 = SevenSegmentDigit(self.sec_digits_frame, 40, 72, PANEL_BG, 7, 2)
        self.sec_2 = SevenSegmentDigit(self.sec_digits_frame, 40, 72, PANEL_BG, 7, 2)
        self.sec_1.pack(side="left", padx=1)
        self.sec_2.pack(side="left", padx=1)
        self.sec_digits_frame.pack(side="right")

        self.small_time_label = tk.Label(
            self.sec_holder,
            text="00:00:00",
            fg=TEXT_COLOR,
            bg=PANEL_BG,
            font=self.small_time_font,
            anchor="e",
        )
        self.small_time_label.pack_forget()

        grip_row = tk.Frame(self.inner, bg=PANEL_BG)
        grip_row.pack(fill="x")

        self.resize_grip = tk.Label(
            grip_row,
            text="///",
            fg=GRIP_COLOR,
            bg=PANEL_BG,
            font=self.grip_font,
            cursor="bottom_right_corner",
        )
        self.resize_grip.pack(side="right", padx=(0, 2), pady=(0, 1))
        self._drag_exclude_widgets.add(self.resize_grip)
        self._bind_resize_grip(self.resize_grip)

        self._bind_drag(root)
        self._apply_scale(self.base_width, self.base_height)
        self._reset_startup_state()
        self._show_page("clock")
        self._register_text_fade_widgets()

        self.root.after(200, self._drain_ui_queue)
        self._schedule_next_page_rotation()
        self._request_weather_refresh(force=True)
        self._request_radar_refresh(force=True)

        self._tick()

    def _reset_startup_state(self):
        self._alpha_value = 1.0
        self.alpha_scale.set(100)
        self.alpha_value_label.config(text="100%")
        self.root.attributes("-alpha", self._alpha_value)
        self._set_topmost(True)
        self._set_click_through(False)
        self._snap_top_right()

    def _apply_window_alpha(self):
        self.root.attributes("-alpha", self._alpha_value)
        if self._click_through and sys.platform.startswith("win"):
            hwnd = self.root.winfo_id()
            alpha_byte = max(1, min(255, int(self._alpha_value * 255)))
            ctypes.windll.user32.SetLayeredWindowAttributes(hwnd, 0, alpha_byte, LWA_ALPHA)

    def _set_topmost(self, enabled):
        self._topmost_enabled = bool(enabled)
        self.root.attributes("-topmost", self._topmost_enabled)
        button_text = "TOP ON" if self._topmost_enabled else "TOP OFF"
        self.topmost_button.config(text=button_text)

    def _toggle_topmost(self):
        self._set_topmost(not self._topmost_enabled)

    def _on_window_configure(self, event):
        if event.widget is not self.root:
            return
        size = (event.width, event.height)
        if size == self._last_size:
            return
        self._last_size = size
        self._apply_scale(event.width, event.height)

    def _apply_scale(self, width, height):
        scale = min(width / self.base_width, height / self.base_height)
        scale = max(0.65, min(1.8, scale))

        outer_pad = max(10, int(18 * scale))
        inner_pad_x = max(12, int(22 * scale))
        inner_pad_y = max(10, int(18 * scale))
        border = max(2, int(5 * scale))

        self.outer.configure(padx=outer_pad, pady=outer_pad)
        self.inner.configure(padx=inner_pad_x, pady=inner_pad_y, highlightthickness=border)

        main_w = max(72, int(104 * scale))
        main_h = max(126, int(186 * scale))
        main_t = max(10, int(18 * scale))
        main_p = max(3, int(6 * scale))

        small_w = max(26, int(40 * scale))
        small_h = max(48, int(72 * scale))
        small_t = max(4, int(7 * scale))
        small_p = max(1, int(2 * scale))

        self.hour_1.resize_digit(main_w, main_h, main_t, main_p)
        self.hour_2.resize_digit(main_w, main_h, main_t, main_p)
        self.min_1.resize_digit(main_w, main_h, main_t, main_p)
        self.min_2.resize_digit(main_w, main_h, main_t, main_p)

        self.date_font.configure(size=max(10, int(16 * scale)))
        self.mode_font.configure(size=max(8, int(10 * scale)))
        self.colon_font.configure(size=max(44, int(90 * scale)))
        self.small_time_font.configure(size=max(9, int(13 * scale)))
        self.grip_font.configure(size=max(8, int(12 * scale)))
        self.section_title_font.configure(size=max(8, int(11 * scale)))
        self.info_font.configure(size=max(9, int(11 * scale)))
        self.small_info_font.configure(size=max(8, int(10 * scale)))
        self.sec_1.resize_digit(small_w, small_h, small_t, small_p)
        self.sec_2.resize_digit(small_w, small_h, small_t, small_p)
        if hasattr(self, "sec_holder"):
            self.sec_holder.place_configure(
                x=-max(14, int(18 * scale)),
                y=-max(26, int(34 * scale)),
            )

    def _place_top_right(self, width, height, margin=16):
        work_area = _get_windows_rightmost_monitor_work_area()
        if work_area:
            left, top, right, bottom = work_area
            screen_width = right - left
            screen_height = bottom - top
            fit_width = min(width, max(self.min_width, screen_width - margin * 2))
            fit_height = min(height, max(self.min_height, screen_height - margin * 2))
            x = max(left, right - fit_width - margin)
            y = max(top, top + margin)
        else:
            sw = self.root.winfo_screenwidth()
            sh = self.root.winfo_screenheight()
            fit_width = min(width, max(self.min_width, sw - margin * 2))
            fit_height = min(height, max(self.min_height, sh - margin * 2))
            x = max(0, sw - fit_width - margin)
            y = max(0, margin)
        self.root.geometry(f"{fit_width}x{fit_height}+{x}+{y}")

    def _apply_toolwindow_hint(self):
        if sys.platform.startswith("win"):
            try:
                # Keep APP window behavior so Windows can create a taskbar button.
                self.root.wm_attributes("-toolwindow", False)
            except tk.TclError:
                pass

    def _apply_taskbar_entry(self):
        if not sys.platform.startswith("win"):
            return
        try:
            hwnd = self.root.winfo_id()
            user32 = ctypes.windll.user32
            get_window_long = user32.GetWindowLongPtrW
            set_window_long = user32.SetWindowLongPtrW
            style = get_window_long(hwnd, GWL_EXSTYLE)
            style = (style | WS_EX_APPWINDOW) & ~WS_EX_TOOLWINDOW
            set_window_long(hwnd, GWL_EXSTYLE, style)
            user32.SetWindowPos(hwnd, 0, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_FRAMECHANGED)
        except Exception:
            pass

    def _refresh_taskbar_entry(self):
        if not sys.platform.startswith("win"):
            return
        self._apply_taskbar_entry()

    def _build_pages(self):
        page_clock = tk.Frame(self.page_host, bg=PANEL_BG)
        page_weather = tk.Frame(self.page_host, bg=PANEL_BG)
        page_status = tk.Frame(self.page_host, bg=PANEL_BG)

        for page in (page_clock, page_weather, page_status):
            page.place(relx=0, rely=0, relwidth=1, relheight=1)

        digits_holder = tk.Frame(page_clock, bg=PANEL_BG)
        digits_holder.place(relx=0.5, rely=0.5, anchor="center")

        self.hour_1 = SevenSegmentDigit(digits_holder, 104, 186, PANEL_BG, 18, 6)
        self.hour_2 = SevenSegmentDigit(digits_holder, 104, 186, PANEL_BG, 18, 6)
        self.min_1 = SevenSegmentDigit(digits_holder, 104, 186, PANEL_BG, 18, 6)
        self.min_2 = SevenSegmentDigit(digits_holder, 104, 186, PANEL_BG, 18, 6)

        self.hour_1.pack(side="left", padx=4)
        self.hour_2.pack(side="left", padx=4)

        self.colon_label = tk.Label(
            digits_holder,
            text=":",
            fg=ON_COLOR,
            bg=PANEL_BG,
            font=self.colon_font,
        )
        self.colon_label.pack(side="left", padx=2)

        self.min_1.pack(side="left", padx=4)
        self.min_2.pack(side="left", padx=4)

        self.weather_card = tk.Frame(
            page_weather,
            bg=CARD_BG,
            bd=1,
            highlightthickness=1,
            highlightbackground=CARD_BORDER,
            padx=16,
            pady=14,
        )
        self.weather_card.place(relx=0.5, rely=0.5, anchor="center", relwidth=0.9, relheight=0.85)

        self.weather_title = tk.Label(
            self.weather_card,
            text="WEATHER",
            fg=ACCENT_COLOR,
            bg=CARD_BG,
            font=self.section_title_font,
            anchor="w",
        )
        self.weather_title.pack(fill="x")

        self.weather_body = tk.Frame(self.weather_card, bg=CARD_BG)
        self.weather_body.pack(fill="both", expand=True, pady=(8, 0))

        self.weather_left = tk.Frame(self.weather_body, bg=CARD_BG)
        self.weather_left.pack(side="left", fill="both", expand=True, padx=(0, 10))

        self.weather_right = tk.Frame(self.weather_body, bg=CARD_BG)
        self.weather_right.pack(side="left", fill="both", expand=True)

        self.weather_visual_row = tk.Frame(self.weather_left, bg=CARD_BG)
        self.weather_visual_row.pack(fill="x", pady=(0, 0))

        self.weather_icon_canvas = tk.Canvas(
            self.weather_visual_row,
            width=88,
            height=58,
            bg=CARD_BG,
            highlightthickness=0,
            bd=0,
        )
        self.weather_icon_canvas.pack(side="left")

        self.weather_text_col = tk.Frame(self.weather_visual_row, bg=CARD_BG)
        self.weather_text_col.pack(side="left", fill="x", expand=True, padx=(10, 0))

        self.weather_condition_label = tk.Label(
            self.weather_text_col,
            text="--",
            fg=TEXT_COLOR,
            bg=CARD_BG,
            font=self.info_font,
            anchor="w",
            justify="left",
        )
        self.weather_condition_label.pack(fill="x")

        self.weather_main_label = tk.Label(
            self.weather_left,
            text="Loading weather...",
            fg=TEXT_COLOR,
            bg=CARD_BG,
            font=self.info_font,
            anchor="w",
            justify="left",
        )
        self.weather_main_label.pack(fill="x", pady=(8, 0))

        self.weather_sub_label = tk.Label(
            self.weather_left,
            text="",
            fg=MUTED_TEXT_COLOR,
            bg=CARD_BG,
            font=self.small_info_font,
            anchor="w",
            justify="left",
        )
        self.weather_sub_label.pack(fill="x", pady=(8, 0))

        self.weather_detail_label = tk.Label(
            self.weather_left,
            text="",
            fg=MUTED_TEXT_COLOR,
            bg=CARD_BG,
            font=self.small_info_font,
            anchor="w",
            justify="left",
        )
        self.weather_detail_label.pack(fill="x", pady=(6, 0))

        self.radar_canvas = tk.Canvas(
            self.weather_right,
            width=280,
            height=210,
            bg="#0d0d0d",
            highlightthickness=1,
            highlightbackground=CARD_BORDER,
            bd=0,
        )
        self.radar_canvas.pack(fill="both", expand=True, pady=(0, 0))
        self._radar_overlay_item = self.radar_canvas.create_rectangle(
            0,
            0,
            1,
            1,
            fill=PANEL_BG,
            outline="",
            state="hidden",
            tags=("fade_overlay",),
        )
        self._radar_title_item = self.radar_canvas.create_text(
            12,
            12,
            text="RAIN RADAR",
            fill=ACCENT_COLOR,
            font=self.section_title_font,
            anchor="nw",
            tags=("radar_overlay_text",),
        )
        self._radar_status_item = self.radar_canvas.create_text(
            12,
            0,
            text="Loading radar...",
            fill=MUTED_TEXT_COLOR,
            font=self.small_info_font,
            anchor="sw",
            tags=("radar_overlay_text",),
        )
        self.radar_canvas.bind("<Configure>", self._on_radar_canvas_configure)

        self.status_card = tk.Frame(
            page_status,
            bg=CARD_BG,
            bd=1,
            highlightthickness=1,
            highlightbackground=CARD_BORDER,
            padx=18,
            pady=12,
        )
        self.status_card.place(relx=0.5, rely=0.5, anchor="center", relwidth=0.94, relheight=0.88)

        self.status_title = tk.Label(
            self.status_card,
            text="SYSTEM STATUS",
            fg=ACCENT_COLOR,
            bg=CARD_BG,
            font=self.section_title_font,
            anchor="w",
        )
        self.status_title.pack(fill="x")

        self.status_body = tk.Frame(self.status_card, bg=CARD_BG)
        self.status_body.pack(fill="both", expand=True, pady=(8, 0))

        self.status_left_col = tk.Frame(self.status_body, bg=CARD_BG)
        self.status_left_col.pack(side="left", fill="both", expand=True, padx=(0, 12))

        self.status_right_col = tk.Frame(self.status_body, bg=CARD_BG)
        self.status_right_col.pack(side="left", fill="both", expand=True)

        self.status_cpu_row = self._create_status_metric(self.status_left_col, "CPU Usage", "--", primary=True)
        self.status_disk_row = self._create_status_metric(self.status_left_col, "Disk Usage", "--")
        self.status_memory_row = self._create_status_metric(self.status_left_col, "Memory Used", "--", primary=True)

        self.status_runtime_row = self._create_status_text_row(self.status_right_col, "App Runtime", "--", primary=True)
        self.status_uptime_row = self._create_status_text_row(self.status_right_col, "System Uptime", "--")
        self.status_wifi_row = self._create_status_metric(self.status_right_col, "Wi-Fi Speed", "--", primary=True, cap=100.0)

        self.pages = {
            "clock": page_clock,
            "weather": page_weather,
            "status": page_status,
        }

    def _show_page(self, page_name):
        page = self.pages.get(page_name)
        if page is None:
            return
        self._current_page = page_name
        page.tkraise()
        self._update_secondary_clock_display()
        if page_name == "status":
            self.root.update_idletasks()
            self._update_status_panel(force=True)

    def _get_current_page_duration_ms(self):
        seconds = self._page_switch_seconds_map.get(self._current_page, self._default_page_switch_seconds)
        return max(3000, int(seconds * 1000))

    def _schedule_next_page_rotation(self):
        self.root.after(self._get_current_page_duration_ms(), self._rotate_page)

    def _rotate_page(self):
        if self._fade_animating or self._slide_animating:
            self.root.after(120, self._rotate_page)
            return
        self._page_index = (self._page_index + 1) % len(self._page_names)
        target_page = self._page_names[self._page_index]
        self._fade_to_page(target_page)

    def _fade_to_page(self, page_name):
        # Lightweight slide-in transition.
        self._fade_animating = True

        if page_name == self._current_page:
            self._fade_animating = False
            self._schedule_next_page_rotation()
            return

        self._run_slide_in(page_name, self._finish_page_transition)

    def _finish_page_transition(self):
        self._apply_text_fade(0.0, page_name="clock")
        self._apply_text_fade(0.0, page_name="weather")
        self._apply_page_fade("weather", 0.0)
        self._fade_animating = False
        self._schedule_next_page_rotation()

    def _run_slide_in(self, page_name, on_done=None):
        if self._slide_animating:
            if on_done:
                on_done()
            return

        from_page_name = self._current_page
        from_page = self.pages.get(from_page_name)
        to_page = self.pages.get(page_name)
        if to_page is None:
            if on_done:
                on_done()
            return

        self._slide_animating = True
        self.page_host.update_idletasks()
        host_w = max(1, self.page_host.winfo_width())

        to_page.place_configure(x=host_w)
        to_page.tkraise()

        def ease_out_cubic(t):
            t = max(0.0, min(1.0, float(t)))
            return 1.0 - (1.0 - t) ** 3

        def animate(step=0):
            if step > SLIDE_STEPS:
                to_page.place_configure(x=0)
                if from_page is not None:
                    from_page.place_configure(x=0)
                self._current_page = page_name
                self._update_secondary_clock_display()
                self._slide_animating = False
                if on_done:
                    on_done()
                return

            p = ease_out_cubic(step / SLIDE_STEPS)
            x_to = int(host_w * (1.0 - p))
            to_page.place_configure(x=x_to)

            if from_page is not None:
                x_from = int(-host_w * 0.06 * p)
                from_page.place_configure(x=x_from)

            self.root.after(SLIDE_INTERVAL_MS, lambda: animate(step + 1))

        animate(0)

    def _register_text_fade_widgets(self):
        self._clock_fade_widgets = [
            self.date_label,
            self.colon_label,
        ]
        self._clock_digit_fade_widgets = [
            self.hour_1,
            self.hour_2,
            self.min_1,
            self.min_2,
            self.sec_1,
            self.sec_2,
        ]
        self._weather_fade_widgets = [
            self.mode_label,
            self.weather_title,
            self.weather_condition_label,
            self.weather_main_label,
            self.weather_sub_label,
            self.weather_detail_label,
            self.small_time_label,
        ]
        self._status_fade_widgets = [
            self.status_title,
            self.status_cpu_row["title"], self.status_cpu_row["value"],
            self.status_disk_row["title"], self.status_disk_row["value"],
            self.status_memory_row["title"], self.status_memory_row["value"],
            self.status_runtime_row["title"], self.status_runtime_row["value"],
            self.status_uptime_row["title"], self.status_uptime_row["value"],
            self.status_wifi_row["title"], self.status_wifi_row["value"],
        ]
        self._text_base_colors = {}
        for widget in self._clock_fade_widgets + self._weather_fade_widgets + self._status_fade_widgets:
            self._text_base_colors[widget] = widget.cget("fg")

    def _hex_to_rgb(self, color):
        color = color.lstrip("#")
        return int(color[0:2], 16), int(color[2:4], 16), int(color[4:6], 16)

    def _blend_color(self, fg, bg, ratio):
        fr, fg_c, fb = self._hex_to_rgb(fg)
        br, bg_c, bb = self._hex_to_rgb(bg)
        rr = int(fr * (1.0 - ratio) + br * ratio)
        rg = int(fg_c * (1.0 - ratio) + bg_c * ratio)
        rb = int(fb * (1.0 - ratio) + bb * ratio)
        return f"#{rr:02x}{rg:02x}{rb:02x}"

    def _apply_text_fade(self, ratio, page_name=None):
        ratio = max(0.0, min(1.0, float(ratio)))

        if page_name is None or page_name == "clock":
            self._clock_fade_ratio = ratio
            for widget in self._clock_fade_widgets:
                if not widget.winfo_exists():
                    continue
                base_fg = self._text_base_colors.get(widget, widget.cget("fg"))
                bg = widget.cget("bg")
                try:
                    widget.config(fg=self._blend_color(base_fg, bg, ratio))
                except tk.TclError:
                    pass

            self._apply_clock_digit_fade(ratio)

        if page_name is None or page_name == "weather":
            self._weather_fade_ratio = ratio
            for widget in self._weather_fade_widgets:
                if not widget.winfo_exists():
                    continue
                base_fg = self._text_base_colors.get(widget, widget.cget("fg"))
                bg = widget.cget("bg")
                try:
                    widget.config(fg=self._blend_color(base_fg, bg, ratio))
                except tk.TclError:
                    pass

        if page_name is None or page_name == "status":
            for widget in self._status_fade_widgets:
                if not widget.winfo_exists():
                    continue
                base_fg = self._text_base_colors.get(widget, widget.cget("fg"))
                bg = widget.cget("bg")
                try:
                    widget.config(fg=self._blend_color(base_fg, bg, ratio))
                except tk.TclError:
                    pass

    def _apply_clock_digit_fade(self, ratio):
        on_blend = self._blend_color(ON_COLOR, PANEL_BG, ratio)
        off_blend = self._blend_color(OFF_COLOR, PANEL_BG, ratio)
        for digit_widget in self._clock_digit_fade_widgets:
            try:
                digit_widget.set_segment_colors_blend(on_blend, off_blend)
            except (tk.TclError, AttributeError):
                pass

    def _apply_page_fade(self, page_name, ratio):
        ratio = max(0.0, min(1.0, float(ratio)))
        if page_name != "weather":
            return

        fade_level = int(ratio * 16 + 0.5)
        if fade_level != self._last_weather_fade_level:
            self._last_weather_fade_level = fade_level
            ratio_for_page = fade_level / 16.0

            bg_color = self._blend_color(CARD_BG, PANEL_BG, ratio_for_page)
            border_color = self._blend_color(CARD_BORDER, PANEL_BG, ratio_for_page)
            icon_bg = bg_color

            for widget in (
                self.weather_card,
                self.weather_body,
                self.weather_left,
                self.weather_right,
                self.weather_visual_row,
                self.weather_text_col,
            ):
                try:
                    widget.config(bg=bg_color)
                except tk.TclError:
                    pass

            try:
                self.weather_card.config(highlightbackground=border_color)
            except tk.TclError:
                pass

            try:
                self.weather_icon_canvas.config(bg=icon_bg)
            except tk.TclError:
                pass

            try:
                self.radar_canvas.config(bg=self._blend_color("#0d0d0d", PANEL_BG, ratio_for_page), highlightbackground=border_color)
            except tk.TclError:
                pass

            self._draw_weather_icon(self._last_weather_code, fade_ratio=ratio_for_page)

        self._apply_radar_fade_overlay(ratio)

    def _apply_radar_fade_overlay(self, ratio):
        ratio = max(0.0, min(1.0, float(ratio)))
        try:
            canvas_w = max(1, self.radar_canvas.winfo_width(), self.radar_canvas.winfo_reqwidth())
            canvas_h = max(1, self.radar_canvas.winfo_height(), self.radar_canvas.winfo_reqheight())
            self.radar_canvas.coords(self._radar_overlay_item, 0, 0, canvas_w, canvas_h)

            overlay_level = int(ratio * 8 + 0.5)
            if overlay_level == self._last_radar_overlay_level:
                return
            self._last_radar_overlay_level = overlay_level

            if overlay_level <= 0:
                self.radar_canvas.itemconfig(self._radar_overlay_item, state="hidden")
                return

            if overlay_level >= 8:
                self.radar_canvas.itemconfig(
                    self._radar_overlay_item,
                    fill=PANEL_BG,
                    stipple="",
                    state="normal",
                )
                self.radar_canvas.tag_raise("fade_overlay")
                return

            if overlay_level >= 6:
                stipple = "gray75"
            elif overlay_level >= 4:
                stipple = "gray50"
            elif overlay_level >= 2:
                stipple = "gray25"
            else:
                stipple = "gray12"

            self.radar_canvas.itemconfig(
                self._radar_overlay_item,
                fill=PANEL_BG,
                stipple=stipple,
                state="normal",
            )
            self.radar_canvas.tag_raise("fade_overlay")
        except tk.TclError:
            pass

    def _on_radar_canvas_configure(self, _event=None):
        try:
            canvas_w = max(1, self.radar_canvas.winfo_width(), self.radar_canvas.winfo_reqwidth())
            canvas_h = max(1, self.radar_canvas.winfo_height(), self.radar_canvas.winfo_reqheight())
            self.radar_canvas.coords(self._radar_overlay_item, 0, 0, canvas_w, canvas_h)
            self.radar_canvas.coords(self._radar_title_item, 12, 12)
            self.radar_canvas.coords(self._radar_status_item, 12, canvas_h - 12)
            self.radar_canvas.tag_raise("fade_overlay")
        except tk.TclError:
            pass

    def _update_secondary_clock_display(self):
        if self._current_page == "clock":
            self.small_time_label.pack_forget()
            self.sec_digits_frame.pack(side="right")
        else:
            self.sec_digits_frame.pack_forget()
            self.small_time_label.pack(side="right")

    def _snap_top_right(self, margin=16):
        self.root.update_idletasks()
        self._place_top_right(self.root.winfo_width(), self.root.winfo_height(), margin)

    def _set_click_through(self, enabled):
        if not sys.platform.startswith("win"):
            self._click_through = False
            self.mode_label.config(text="DRAG")
            return

        hwnd = self.root.winfo_id()
        user32 = ctypes.windll.user32

        get_window_long = user32.GetWindowLongPtrW
        set_window_long = user32.SetWindowLongPtrW
        style = get_window_long(hwnd, GWL_EXSTYLE)

        if enabled:
            style = style | WS_EX_LAYERED | WS_EX_TRANSPARENT
            alpha_byte = max(1, min(255, int(self._alpha_value * 255)))
            user32.SetLayeredWindowAttributes(hwnd, 0, alpha_byte, LWA_ALPHA)
            self.mode_label.config(text="PASS")
            self._click_through = True
        else:
            style = style & ~WS_EX_TRANSPARENT & ~WS_EX_LAYERED
            self.mode_label.config(text="DRAG")
            self._click_through = False

        set_window_long(hwnd, GWL_EXSTYLE, style)
        self._apply_window_alpha()

    def _on_alpha_change(self, value):
        percent = max(35, min(100, int(float(value))))
        self._alpha_value = percent / 100.0
        self.alpha_value_label.config(text=f"{percent}%")
        self._apply_window_alpha()

    def _toggle_click_through(self, _event=None):
        self._set_click_through(not self._click_through)

    def _bind_drag(self, widget, visited=None):
        if visited is None:
            visited = set()

        widget_id = id(widget)
        if widget_id in visited:
            return
        visited.add(widget_id)

        if widget not in self._drag_exclude_widgets:
            widget.bind("<ButtonPress-1>", self._start_drag)
            widget.bind("<B1-Motion>", self._do_drag)
            widget.bind("<ButtonRelease-1>", self._end_drag)
            widget.bind("<Double-Button-1>", self._move_by_double_click)
        for child in widget.winfo_children():
            self._bind_drag(child, visited)

    def _bind_resize_grip(self, widget):
        widget.bind("<ButtonPress-1>", self._start_resize)
        widget.bind("<B1-Motion>", self._do_resize)
        widget.bind("<ButtonRelease-1>", self._end_resize)

    def _start_resize(self, event):
        if self._click_through:
            return
        self._resize_start_x = event.x_root
        self._resize_start_y = event.y_root
        self._resize_start_width = self.root.winfo_width()
        self._resize_start_height = self.root.winfo_height()
        self.root.grab_set()

    def _do_resize(self, event):
        if self._click_through:
            return

        dx = event.x_root - self._resize_start_x
        dy = event.y_root - self._resize_start_y
        new_width = max(self.min_width, self._resize_start_width + dx)
        new_height = max(self.min_height, self._resize_start_height + dy)
        self.root.geometry(f"{new_width}x{new_height}")

    def _end_resize(self, _event):
        try:
            if self.root.grab_current() == self.root:
                self.root.grab_release()
        except tk.TclError:
            pass

    def _start_drag(self, event):
        if self._click_through:
            return
        self._drag_start_x = event.x_root
        self._drag_start_y = event.y_root
        self.root.grab_set()

    def _do_drag(self, event):
        if self._click_through:
            return
        dx = event.x_root - self._drag_start_x
        dy = event.y_root - self._drag_start_y
        x = self.root.winfo_x() + dx
        y = self.root.winfo_y() + dy
        self.root.geometry(f"+{x}+{y}")
        self._drag_start_x = event.x_root
        self._drag_start_y = event.y_root

    def _end_drag(self, _event):
        try:
            if self.root.grab_current() == self.root:
                self.root.grab_release()
        except tk.TclError:
            pass

    def _move_by_double_click(self, event):
        if self._click_through:
            return
        self.root.update_idletasks()
        width = self.root.winfo_width()
        height = self.root.winfo_height()

        # Move so the window center lands at the double-click screen position.
        x = int(event.x_root - (width / 2))
        y = int(event.y_root - (height / 2))
        self.root.geometry(f"+{x}+{y}")

    def _drain_ui_queue(self):
        while not self._ui_queue.empty():
            kind, payload = self._ui_queue.get_nowait()
            if kind == "weather":
                self.weather_main_label.config(text=payload.get("main", "Weather unavailable"))
                self.weather_sub_label.config(text=payload.get("sub", ""))
                self.weather_detail_label.config(text=payload.get("detail", ""))
                self.weather_condition_label.config(text=payload.get("condition", "--"))
                self._last_weather_code = payload.get("code", -1)
                self._draw_weather_icon(self._last_weather_code)
            elif kind == "radar":
                self._update_radar_ui(payload)
        self.root.after(250, self._drain_ui_queue)

    def _update_radar_ui(self, payload):
        base_tiles = payload.get("base_tiles", [])
        radar_tiles = payload.get("radar_tiles", [])
        status_text = payload.get("status", "Radar unavailable")
        focus_px_x = float(payload.get("focus_px_x", 128.0))
        focus_px_y = float(payload.get("focus_px_y", 128.0))

        self._last_radar_message = status_text
        canvas_w = max(1, self.radar_canvas.winfo_width(), self.radar_canvas.winfo_reqwidth())
        canvas_h = max(1, self.radar_canvas.winfo_height(), self.radar_canvas.winfo_reqheight())

        if not base_tiles and not radar_tiles:
            self._draw_radar_placeholder(status_text)
            return

        self.radar_canvas.delete("radar_content")
        self._radar_tile_photos = []

        origin_x = (canvas_w * 0.5) - focus_px_x
        origin_y = (canvas_h * 0.5) - focus_px_y

        decoded_any = False
        for tile in base_tiles:
            image_b64 = tile.get("image_b64", "")
            if not image_b64:
                continue
            try:
                photo = tk.PhotoImage(data=image_b64, format="png")
            except tk.TclError:
                continue
            self._radar_tile_photos.append(photo)
            self.radar_canvas.create_image(
                origin_x + (int(tile.get("dx", 0)) * 256),
                origin_y + (int(tile.get("dy", 0)) * 256),
                image=photo,
                anchor="nw",
                tags=("radar_content",),
            )
            decoded_any = True

        for tile in radar_tiles:
            image_b64 = tile.get("image_b64", "")
            if not image_b64:
                continue
            try:
                photo = tk.PhotoImage(data=image_b64, format="png")
            except tk.TclError:
                continue
            self._radar_tile_photos.append(photo)
            self.radar_canvas.create_image(
                origin_x + (int(tile.get("dx", 0)) * 256),
                origin_y + (int(tile.get("dy", 0)) * 256),
                image=photo,
                anchor="nw",
                tags=("radar_content",),
            )
            decoded_any = True

        if not decoded_any:
            self._draw_radar_placeholder(status_text)
            return

        self._apply_radar_fade_overlay(self._weather_fade_ratio)

    def _draw_radar_placeholder(self, text):
        self.radar_canvas.delete("radar_content")
        canvas_w = max(1, self.radar_canvas.winfo_width(), self.radar_canvas.winfo_reqwidth())
        canvas_h = max(1, self.radar_canvas.winfo_height(), self.radar_canvas.winfo_reqheight())
        self.radar_canvas.create_text(
            canvas_w / 2,
            canvas_h / 2,
            text=text,
            fill=MUTED_TEXT_COLOR,
            font=("Consolas", 10, "bold"),
            justify="center",
            width=max(120, canvas_w - 16),
            tags=("radar_content",),
        )
        self._apply_radar_fade_overlay(self._weather_fade_ratio)

    def _request_radar_refresh(self, force=False):
        now = datetime.now()
        if self._busy_radar:
            return
        if not force and (now - self._last_radar_fetch).total_seconds() < RADAR_UPDATE_INTERVAL_SEC:
            return
        self._busy_radar = True
        threading.Thread(target=self._fetch_radar_worker, daemon=True).start()

    def _latlon_to_tile(self, lat, lon, zoom):
        lat = max(-85.0511, min(85.0511, float(lat)))
        lon = max(-179.9999, min(179.9999, float(lon)))
        n = 2 ** int(zoom)
        x = int((lon + 180.0) / 360.0 * n)
        lat_rad = math.radians(lat)
        y = int((1.0 - math.log(math.tan(lat_rad) + (1.0 / math.cos(lat_rad))) / math.pi) / 2.0 * n)
        x = max(0, min(n - 1, x))
        y = max(0, min(n - 1, y))
        return x, y

    def _latlon_to_tile_with_pixel(self, lat, lon, zoom):
        lat = max(-85.0511, min(85.0511, float(lat)))
        lon = max(-179.9999, min(179.9999, float(lon)))
        n = 2 ** int(zoom)

        x_float = (lon + 180.0) / 360.0 * n
        lat_rad = math.radians(lat)
        y_float = (1.0 - math.log(math.tan(lat_rad) + (1.0 / math.cos(lat_rad))) / math.pi) / 2.0 * n

        x = int(x_float)
        y = int(y_float)
        x = max(0, min(n - 1, x))
        y = max(0, min(n - 1, y))

        focus_px_x = max(0.0, min(255.999, (x_float - x) * 256.0))
        focus_px_y = max(0.0, min(255.999, (y_float - y) * 256.0))
        return x, y, focus_px_x, focus_px_y

    def _http_get_bytes(self, url, headers=None, timeout=8):
        req = urllib.request.Request(url, headers=headers or {})
        with urllib.request.urlopen(req, timeout=timeout) as response:
            return response.read()

    def _load_persisted_radar_zoom(self):
        if not os.path.exists(self._radar_state_path):
            return None
        try:
            with open(self._radar_state_path, "r", encoding="utf-8") as f:
                payload = json.load(f)
            zoom = int(payload.get("last_good_zoom"))
            return max(6, min(7, zoom))
        except Exception:
            return None

    def _save_persisted_radar_zoom(self, zoom):
        try:
            payload = {
                "last_good_zoom": int(max(6, min(7, int(zoom)))),
                "saved_at": datetime.now().isoformat(timespec="seconds"),
            }
            with open(self._radar_state_path, "w", encoding="utf-8") as f:
                json.dump(payload, f, ensure_ascii=True, indent=2)
        except Exception:
            pass

    def _fetch_radar_worker(self):
        try:
            lat, lon, city = self._resolve_radar_location()
            if lat is None or lon is None:
                self._ui_queue.put(("radar", {"status": "Radar location is not set"}))
                return

            meta = self._http_get_json("https://api.rainviewer.com/public/weather-maps.json")
            host = meta.get("host", "https://tilecache.rainviewer.com")
            radar = meta.get("radar", {})
            frames = radar.get("past", []) + radar.get("nowcast", [])
            if not frames:
                self._ui_queue.put(("radar", {"status": "Radar frame unavailable"}))
                return

            latest = frames[-1]
            path = latest.get("path")
            if not path:
                self._ui_queue.put(("radar", {"status": "Radar path unavailable"}))
                return

            requested_zoom = max(6, min(7, self.radar_zoom))
            requested_zoom = max(6, min(7, self.radar_zoom))
            base_tiles = []
            radar_tiles = []
            used_zoom = requested_zoom
            map_headers = {"User-Agent": "clock-topmost/1.0"}

            x, y, focus_px_x, focus_px_y = self._latlon_to_tile_with_pixel(lat, lon, requested_zoom)
            tile_x_count = 3
            tile_y_count = 3
            start_dx = -(tile_x_count // 2)
            start_dy = -(tile_y_count // 2)

            for dy in range(start_dy, start_dy + tile_y_count):
                for dx in range(start_dx, start_dx + tile_x_count):
                    tile_x = x + dx
                    tile_y = y + dy
                    if tile_x < 0 or tile_y < 0:
                        continue
                    max_tile = 2 ** requested_zoom
                    if tile_x >= max_tile or tile_y >= max_tile:
                        continue

                    map_url = f"https://tile.openstreetmap.org/{requested_zoom}/{tile_x}/{tile_y}.png"
                    tile_url = f"{host}{path}/256/{requested_zoom}/{tile_x}/{tile_y}/2/1_1.png"

                    try:
                        map_bytes = self._http_get_bytes(map_url, headers=map_headers, timeout=10)
                        if map_bytes.startswith(b"\x89PNG\r\n\x1a\n"):
                            base_tiles.append(
                                {
                                    "dx": dx,
                                    "dy": dy,
                                    "image_b64": base64.b64encode(map_bytes).decode("ascii"),
                                }
                            )
                    except Exception:
                        pass

                    try:
                        image_bytes = self._http_get_bytes(tile_url, timeout=10)
                        if image_bytes.startswith(b"\x89PNG\r\n\x1a\n"):
                            radar_tiles.append(
                                {
                                    "dx": dx,
                                    "dy": dy,
                                    "image_b64": base64.b64encode(image_bytes).decode("ascii"),
                                }
                            )
                    except urllib.error.HTTPError as exc:
                        body_preview = ""
                        try:
                            body_preview = exc.read(256).decode("utf-8", errors="ignore").lower()
                        except Exception:
                            body_preview = ""
                        exc_text = str(exc).lower()
                        if "zoom level not supported" in body_preview or "zoom level not supported" in exc_text:
                            pass
                    except Exception:
                        pass

            frame_time = latest.get("time")
            if frame_time:
                updated = datetime.fromtimestamp(frame_time).strftime("%H:%M")
                status = f"{city}  updated {updated}"
            else:
                status = f"{city}  updated"

            status = f"{status}  (z{requested_zoom})"

            if used_zoom is not None:
                self._save_persisted_radar_zoom(used_zoom)

            if not base_tiles:
                self._ui_queue.put(("radar", {"status": "Radar map tiles unavailable"}))
                return

            if not radar_tiles:
                status = f"{status}  (radar overlay unavailable)"

            self._ui_queue.put(
                (
                    "radar",
                    {
                        "base_tiles": base_tiles,
                        "radar_tiles": radar_tiles,
                        "focus_px_x": focus_px_x,
                        "focus_px_y": focus_px_y,
                        "status": status,
                    },
                )
            )
            self._last_radar_fetch = datetime.now()
        except Exception as exc:
            self._ui_queue.put(("radar", {"status": f"Radar fetch failed: {exc}"}))
        finally:
            self._busy_radar = False

    def _resolve_radar_location(self):
        # Keep radar center fixed on Toyota area regardless of weather location settings.
        return RADAR_DEFAULT_LAT, RADAR_DEFAULT_LON, RADAR_DEFAULT_CITY

    def _draw_weather_icon(self, code, fade_ratio=0.0):
        fade_ratio = max(0.0, min(1.0, float(fade_ratio)))
        c = self.weather_icon_canvas
        c.delete("all")

        if code is None:
            code = -1

        sun_color = self._blend_color("#f5c542", CARD_BG, fade_ratio)
        cloud_color = self._blend_color("#9db0bd", CARD_BG, fade_ratio)
        rain_color = self._blend_color("#5fd7ff", CARD_BG, fade_ratio)
        snow_color = self._blend_color("#d9f3ff", CARD_BG, fade_ratio)
        bolt_color = self._blend_color("#ffd35a", CARD_BG, fade_ratio)

        # sun
        if code in (0, 1):
            c.create_oval(28, 12, 62, 46, fill=sun_color, outline="")
            for x0, y0, x1, y1 in (
                (45, 2, 45, 10),
                (45, 48, 45, 56),
                (18, 29, 26, 29),
                (64, 29, 72, 29),
                (24, 11, 30, 17),
                (60, 41, 66, 47),
                (24, 47, 30, 41),
                (60, 17, 66, 11),
            ):
                c.create_line(x0, y0, x1, y1, fill=sun_color, width=2)
            return

        # cloud base
        c.create_oval(22, 20, 50, 42, fill=cloud_color, outline="")
        c.create_oval(40, 14, 67, 39, fill=cloud_color, outline="")
        c.create_oval(52, 21, 78, 42, fill=cloud_color, outline="")
        c.create_rectangle(30, 30, 70, 45, fill=cloud_color, outline="")

        # partly cloudy
        if code == 2:
            c.create_oval(14, 8, 36, 30, fill=sun_color, outline="")
            return

        # rain / showers
        if code in (51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82):
            for x in (36, 48, 60):
                c.create_line(x, 46, x - 4, 56, fill=rain_color, width=2)
            return

        # snow
        if code in (71, 73, 75, 77, 85, 86):
            for x, y in ((38, 52), (52, 52), (66, 52)):
                c.create_text(x, y, text="*", fill=snow_color, font=("Consolas", 10, "bold"))
            return

        # storm
        if code in (95, 96, 99):
            c.create_polygon(48, 44, 38, 56, 49, 56, 43, 68, 59, 52, 50, 52, fill=bolt_color, outline="")

    def _request_weather_refresh(self, force=False):
        now = datetime.now()
        if self._busy_weather:
            return
        if not force and (now - self._last_weather_fetch).total_seconds() < WEATHER_UPDATE_INTERVAL_SEC:
            return
        self._busy_weather = True
        threading.Thread(target=self._fetch_weather_worker, daemon=True).start()

    def _fetch_weather_worker(self):
        try:
            lat, lon, city = self._resolve_location()
            if lat is None or lon is None:
                self._ui_queue.put(
                    (
                        "weather",
                        {
                            "main": "Weather location not set",
                            "sub": "Set CLOCK_CITY or CLOCK_LAT/CLOCK_LON",
                        },
                    )
                )
                return

            query = urllib.parse.urlencode(
                {
                    "latitude": lat,
                    "longitude": lon,
                    "current": "temperature_2m,weather_code,precipitation,wind_speed_10m",
                    "daily": "temperature_2m_max,temperature_2m_min",
                    "timezone": "Asia/Tokyo",
                    "forecast_days": 1,
                }
            )
            url = f"https://api.open-meteo.com/v1/forecast?{query}"
            weather = self._http_get_json(url)
            current = weather.get("current", {})
            daily = weather.get("daily", {})

            temperature = current.get("temperature_2m")
            code = int(current.get("weather_code", -1))
            condition = WMO_WEATHER.get(code, "Unknown")
            precipitation = current.get("precipitation")
            wind_speed = current.get("wind_speed_10m")

            max_list = daily.get("temperature_2m_max", [None])
            min_list = daily.get("temperature_2m_min", [None])
            day_max = max_list[0] if max_list else None
            day_min = min_list[0] if min_list else None

            main = f"{city}: {temperature:.1f}C / {condition}" if temperature is not None else f"{city}: {condition}"
            sub = ""
            if day_max is not None and day_min is not None:
                sub = f"Today {day_min:.1f}C - {day_max:.1f}C"

            detail_parts = []
            if precipitation is not None:
                detail_parts.append(f"Rain {precipitation:.1f} mm")
            if wind_speed is not None:
                detail_parts.append(f"Wind {wind_speed / 3.6:.1f} m/s")
            detail_text = " | ".join(detail_parts)

            self._ui_queue.put(
                (
                    "weather",
                    {
                        "main": main,
                        "sub": sub,
                        "detail": detail_text,
                        "condition": condition,
                        "code": code,
                    },
                )
            )
            self._last_weather_fetch = datetime.now()
        except Exception as exc:
            self._ui_queue.put(
                (
                    "weather",
                    {
                        "main": "Weather fetch failed",
                        "sub": str(exc),
                        "detail": "",
                        "condition": "--",
                        "code": -1,
                    },
                )
            )
        finally:
            self._busy_weather = False

    def _resolve_location(self):
        if self.weather_lat and self.weather_lon:
            try:
                return float(self.weather_lat), float(self.weather_lon), self.weather_city
            except ValueError:
                pass

        city = self.weather_city.strip()
        if not city:
            return None, None, ""

        query = urllib.parse.urlencode({"name": city, "count": 1, "language": "en", "format": "json"})
        url = f"https://geocoding-api.open-meteo.com/v1/search?{query}"
        payload = self._http_get_json(url)
        results = payload.get("results", [])
        if not results:
            return None, None, city

        first = results[0]
        lat = first.get("latitude")
        lon = first.get("longitude")
        name = first.get("name", city)
        return lat, lon, name

    def _http_get_json(self, url, headers=None, timeout=8):
        req = urllib.request.Request(url, headers=headers or {})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as response:
                body = response.read().decode("utf-8")
                return json.loads(body)
        except urllib.error.HTTPError as e:
            print(f"[Clock] HTTP Error {e.code}: {e.reason}")
            print(f"[Clock] URL: {url}")
            raise
        except Exception as e:
            print(f"[Clock] Error fetching {url}: {e}")
            raise

    def _format_bytes_gb(self, byte_value):
        if byte_value is None:
            return "--"
        return f"{byte_value / (1024 ** 3):.1f} GB"

    def _format_duration(self, seconds):
        seconds = max(0, int(seconds))
        h = seconds // 3600
        m = (seconds % 3600) // 60
        s = seconds % 60
        return f"{h:02d}:{m:02d}:{s:02d}"

    def _create_status_metric(self, parent, title, value_text, primary=False, cap=100.0):
        row = tk.Frame(parent, bg=CARD_BG)
        row.pack(fill="x", pady=(0, 10))

        title_font = self.info_font if primary else self.small_info_font
        value_font = self.info_font if primary else self.small_info_font

        title_label = tk.Label(
            row,
            text=title,
            fg=ACCENT_COLOR if primary else MUTED_TEXT_COLOR,
            bg=CARD_BG,
            font=title_font,
            anchor="w",
        )
        title_label.pack(fill="x")

        value_label = tk.Label(
            row,
            text=value_text,
            fg=TEXT_COLOR,
            bg=CARD_BG,
            font=value_font,
            anchor="w",
        )
        value_label.pack(fill="x", pady=(1, 3))

        bar = tk.Canvas(
            row,
            height=10,
            bg=CARD_BG,
            highlightthickness=0,
            bd=0,
        )
        bar.pack(fill="x")
        track = bar.create_rectangle(0, 2, 1, 8, fill="#202020", outline="")
        fill = bar.create_rectangle(0, 2, 1, 8, fill=ACCENT_COLOR, outline="")

        return {
            "frame": row,
            "title": title_label,
            "value": value_label,
            "bar": bar,
            "track": track,
            "fill": fill,
            "cap": float(cap),
        }

    def _create_status_text_row(self, parent, title, value_text, primary=False):
        row = tk.Frame(parent, bg=CARD_BG)
        row.pack(fill="x", pady=(0, 10))

        title_label = tk.Label(
            row,
            text=title,
            fg=ACCENT_COLOR if primary else MUTED_TEXT_COLOR,
            bg=CARD_BG,
            font=self.info_font if primary else self.small_info_font,
            anchor="w",
        )
        title_label.pack(fill="x")

        value_label = tk.Label(
            row,
            text=value_text,
            fg=TEXT_COLOR,
            bg=CARD_BG,
            font=self.info_font if primary else self.small_info_font,
            anchor="w",
        )
        value_label.pack(fill="x", pady=(1, 0))

        return {
            "frame": row,
            "title": title_label,
            "value": value_label,
        }

    def _set_metric_row(self, row, value_text, percent_value=None):
        row["value"].config(text=value_text)
        width = max(1, row["bar"].winfo_width(), row["bar"].winfo_reqwidth())
        if percent_value is None:
            row["bar"].itemconfig(row["fill"], state="hidden")
            row["bar"].coords(row["track"], 0, 2, width, 8)
            return

        row["bar"].itemconfig(row["fill"], state="normal")
        track_w = width
        fill_w = max(1, int(track_w * max(0.0, min(1.0, percent_value / row["cap"]))))
        row["bar"].coords(row["track"], 0, 2, track_w, 8)
        row["bar"].coords(row["fill"], 0, 2, fill_w, 8)

    def _set_text_row(self, row, value_text):
        row["value"].config(text=value_text)

    def _read_disk_usage_windows(self):
        if not sys.platform.startswith("win"):
            return None
        try:
            free_bytes = ctypes.c_ulonglong(0)
            total_bytes = ctypes.c_ulonglong(0)
            total_free_bytes = ctypes.c_ulonglong(0)
            root_drive = os.environ.get("SystemDrive", "C:") + "\\"
            ok = ctypes.windll.kernel32.GetDiskFreeSpaceExW(
                root_drive,
                ctypes.byref(free_bytes),
                ctypes.byref(total_bytes),
                ctypes.byref(total_free_bytes),
            )
            if not ok or total_bytes.value <= 0:
                return None
            used_bytes = total_bytes.value - total_free_bytes.value
            used_percent = (used_bytes * 100.0) / total_bytes.value
            return used_percent, used_bytes, total_bytes.value, total_free_bytes.value
        except Exception:
            return None

    def _read_wifi_speed_windows(self):
        if not sys.platform.startswith("win"):
            return None
        try:
            iphlpapi = ctypes.windll.iphlpapi
            size = wintypes.ULONG(0)
            result = iphlpapi.GetIfTable(None, ctypes.byref(size), False)
            if result != 122 or size.value == 0:
                return None

            buffer = (ctypes.c_byte * size.value)()
            result = iphlpapi.GetIfTable(buffer, ctypes.byref(size), False)
            if result != 0:
                return None

            table = ctypes.cast(buffer, ctypes.POINTER(MIB_IFTABLE)).contents
            row_count = int(table.dwNumEntries)
            if row_count <= 0:
                return None

            row_ptr = ctypes.cast(ctypes.addressof(buffer) + ctypes.sizeof(wintypes.DWORD), ctypes.POINTER(MIB_IFROW))
            now = datetime.now()
            for index in range(row_count):
                row = row_ptr[index]
                name = row.wszName.lower()
                if row.dwType != 71 and not any(token in name for token in ("wi-fi", "wifi", "wlan", "wireless", "802.11")):
                    continue

                current = (int(row.dwInOctets), int(row.dwOutOctets), now)
                if self._last_wifi_sample is None:
                    self._last_wifi_sample = current
                    return None

                prev_rx, prev_tx, prev_time = self._last_wifi_sample
                self._last_wifi_sample = current
                delta_sec = max(0.001, (now - prev_time).total_seconds())
                delta_bytes = max(0.0, (current[0] - prev_rx) + (current[1] - prev_tx))
                mbps = (delta_bytes * 8.0) / (delta_sec * 1_000_000.0)
                return max(0.0, mbps)
            return None
        except Exception:
            return None

    def _read_cpu_percent_windows(self):
        if not sys.platform.startswith("win"):
            return None
        try:
            idle = FILETIME()
            kernel = FILETIME()
            user = FILETIME()
            if not ctypes.windll.kernel32.GetSystemTimes(ctypes.byref(idle), ctypes.byref(kernel), ctypes.byref(user)):
                return None

            def ft_to_int(ft):
                return (int(ft.dwHighDateTime) << 32) | int(ft.dwLowDateTime)

            idle_now = ft_to_int(idle)
            kernel_now = ft_to_int(kernel)
            user_now = ft_to_int(user)

            if self._last_cpu_times is None:
                self._last_cpu_times = (idle_now, kernel_now, user_now)
                return None

            idle_prev, kernel_prev, user_prev = self._last_cpu_times
            self._last_cpu_times = (idle_now, kernel_now, user_now)

            total_delta = (kernel_now - kernel_prev) + (user_now - user_prev)
            idle_delta = idle_now - idle_prev
            if total_delta <= 0:
                return None
            return max(0.0, min(100.0, (total_delta - idle_delta) * 100.0 / total_delta))
        except Exception:
            return None

    def _read_memory_status_windows(self):
        if not sys.platform.startswith("win"):
            return None
        try:
            mem = MEMORYSTATUSEX()
            mem.dwLength = ctypes.sizeof(MEMORYSTATUSEX)
            if not ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(mem)):
                return None
            used = int(mem.ullTotalPhys - mem.ullAvailPhys)
            return {
                "total": int(mem.ullTotalPhys),
                "avail": int(mem.ullAvailPhys),
                "used": used,
                "load": int(mem.dwMemoryLoad),
            }
        except Exception:
            return None

    def _read_process_memory_windows(self):
        if not sys.platform.startswith("win"):
            return None
        try:
            counters = PROCESS_MEMORY_COUNTERS()
            counters.cb = ctypes.sizeof(PROCESS_MEMORY_COUNTERS)
            process_handle = ctypes.windll.kernel32.GetCurrentProcess()
            ok = ctypes.windll.psapi.GetProcessMemoryInfo(process_handle, ctypes.byref(counters), counters.cb)
            if not ok:
                return None
            return int(counters.WorkingSetSize)
        except Exception:
            return None

    def _update_status_panel(self, force=False):
        now = datetime.now()
        if not force and self._current_page != "status":
            return
        if not force and (now - self._last_status_fetch).total_seconds() < 1:
            return
        self._last_status_fetch = now

        cpu = self._read_cpu_percent_windows()
        mem = self._read_memory_status_windows()
        disk = self._read_disk_usage_windows()
        wifi = self._read_wifi_speed_windows()

        if cpu is None:
            self._set_metric_row(self.status_cpu_row, "--", None)
        else:
            self._set_metric_row(self.status_cpu_row, f"{cpu:.1f}%", cpu)

        if disk is None:
            self._set_metric_row(self.status_disk_row, "--", None)
        else:
            used_percent, used_bytes, total_bytes, _free_bytes = disk
            self._set_metric_row(
                self.status_disk_row,
                f"{used_percent:.1f}% ({self._format_bytes_gb(used_bytes)} / {self._format_bytes_gb(total_bytes)})",
                used_percent,
            )

        if mem is None:
            self._set_metric_row(self.status_memory_row, "--", None)
        else:
            self._set_metric_row(
                self.status_memory_row,
                f"{self._format_bytes_gb(mem['used'])} / {self._format_bytes_gb(mem['total'])} ({mem['load']}%)",
                mem['load'],
            )

        if wifi is None:
            self._set_metric_row(self.status_wifi_row, "--", None)
        else:
            self._set_metric_row(self.status_wifi_row, f"{wifi:.2f} Mbps", wifi)

        app_runtime = datetime.now() - self._app_started_at
        self._set_text_row(self.status_runtime_row, self._format_duration(app_runtime.total_seconds()))

        if sys.platform.startswith("win") and hasattr(ctypes.windll.kernel32, "GetTickCount64"):
            tick_ms = ctypes.windll.kernel32.GetTickCount64()
            self._set_text_row(self.status_uptime_row, self._format_duration(tick_ms / 1000.0))
        else:
            self._set_text_row(self.status_uptime_row, "--")

    def _tick(self):
        now = datetime.now()
        second_key = now.strftime("%Y%m%d%H%M%S")

        if second_key == self._last_second_key:
            self.root.after(80, self._tick)
            return
        self._last_second_key = second_key

        hh = f"{now.hour:02d}"
        mm = f"{now.minute:02d}"
        ss = f"{now.second:02d}"

        self.hour_1.set_number(hh[0])
        self.hour_2.set_number(hh[1])
        self.min_1.set_number(mm[0])
        self.min_2.set_number(mm[1])
        self.sec_1.set_number(ss[0])
        self.sec_2.set_number(ss[1])
        self._apply_clock_digit_fade(self._clock_fade_ratio)
        self.small_time_label.config(text=f"{hh}:{mm}:{ss}")

        weekday = WEEKDAYS[now.weekday()]
        self.date_label.config(text=f"{now.year}/{now.month}/{now.day} {weekday}")

        minute_key = now.strftime("%Y%m%d%H%M")
        if minute_key != self._last_minute_key:
            self._last_minute_key = minute_key
            self._request_weather_refresh()
            self._request_radar_refresh()

        if self._current_page == "status":
            self._update_status_panel()

        self.root.after(120, self._tick)


def _load_env_file():
    """Load .env file from the script directory."""
    script_dir = os.path.dirname(os.path.abspath(__file__))
    env_file = os.path.join(script_dir, ".env")
    
    if os.path.exists(env_file):
        try:
            loaded_count = 0
            with open(env_file, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith("#"):
                        if "=" in line:
                            key, value = line.split("=", 1)
                            key = key.strip()
                            value = value.strip()
                            if key and value:
                                os.environ[key] = value
                                loaded_count += 1
            print(f"[Clock] Loaded {loaded_count} environment variables from {env_file}")
        except Exception as exc:
            print(f"[Clock] Warning: Could not load .env file: {exc}")
    else:
        print(f"[Clock] Warning: .env file not found at {env_file}")


def main():
    _load_env_file()
    _set_windows_app_user_model_id()
    _ensure_pythonw_on_windows()
    _hide_console_window_on_windows()
    root = tk.Tk()
    app = TopmostClockApp(root)
    _ = app
    try:
        root.mainloop()
    except KeyboardInterrupt:
        # Allow clean termination when interrupted from terminal.
        try:
            root.destroy()
        except tk.TclError:
            pass


if __name__ == "__main__":
    main()
