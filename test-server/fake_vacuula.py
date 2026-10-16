"""A fake Vacuula server for tests.

It mimics the real server's HTTP API (see ``server/src/vacuula_server/handlers``):

* success bodies of POST endpoints are the bare text ``OK`` (labelled JSON),
* Gen3 commands return the robot's raw JSON (HTTP 400 when ``result`` != ok),
* Gen4 commands return ``{"type": "response", "id", "code", "body"}`` and use the
  robot's response code as HTTP status,
* SSE streams carry ``event: robots`` frames (server) and ``data: {...}`` frames
  (per robot), with ``: keepalive`` comments.
"""

from __future__ import annotations

import asyncio
import json
import uuid
from typing import Any

from aiohttp import web

GEN3_SERIAL = "OPS01234-0123456789AB"
GEN4_SERIAL = "g4robot0001"
GEN4_LABEL = "AAAAN2BBBBBBBBB"  # label serial of a D10 ("N2" at index 4)

MAP3_ID = "map-gen3-1"
ZONE3_ID = "zone-gen3-1"
PLAN4_ID = "11111111-aaaa-bbbb-cccc-000000000001"
ZONE4_ID = "zone-gen4-1"
NOGO4_ID = "nogo-gen4-1"


def _rle(width: int, height: int) -> list[list[int]]:
    """A little room: wall border, free inside."""
    cells: list[int] = []
    for y in range(height):
        for x in range(width):
            border = x in (0, width - 1) or y in (0, height - 1)
            cells.append(2 if border else 1)
    rle: list[list[int]] = []
    for value in cells:
        if rle and rle[-1][0] == value:
            rle[-1][1] += 1
        else:
            rle.append([value, 1])
    return rle


def floor_map(width: int = 40, height: int = 30) -> dict[str, Any]:
    return {
        "width": width,
        "height": height,
        "downsample": 1,
        "map_type": "floor",
        "legend": {"0": "unknown", "1": "free", "2": "wall"},
        "rle": _rle(width, height),
        "metadata": {"resolution": 40, "origin_x": -40000, "origin_y": -40000},
        "img_size": [width, height],
    }


def run_map(width: int = 40, height: int = 30) -> dict[str, Any]:
    cells = [0] * (width * height)
    for x in range(5, 30):
        cells[10 * width + x] = 7
        cells[11 * width + x] = 9
    rle: list[list[int]] = []
    for value in cells:
        if rle and rle[-1][0] == value:
            rle[-1][1] += 1
        else:
            rle.append([value, 1])
    return {
        "width": width,
        "height": height,
        "downsample": 1,
        "map_type": "path",
        "legend": {"0": "x", "7": "path_value_7", "9": "path_value_9"},
        "rle": rle,
        "metadata": {},
        "img_size": [width, height],
    }


class FakeVacuula:
    """State and behaviour of the fake server."""

    def __init__(self) -> None:
        self.version = "1.0.0-test"
        self.timezone = "Europe/Stockholm"
        self.utc_offset_minutes = 120
        self.commands: list[tuple[str, dict[str, Any]]] = []
        self.http_calls: list[tuple[str, str, Any]] = []
        self.server_streams: list[asyncio.Queue[bytes | None]] = []
        self.robot_streams: dict[str, list[asyncio.Queue[bytes | None]]] = {}
        self.fail_commands: dict[str, tuple[int, Any]] = {}
        self.offline = False  # make /api/* answer 503

        self.robots: dict[str, dict[str, Any]] = {
            GEN3_SERIAL: {"type": "neato.gen3", "name": "Downstairs", "connected": True},
            GEN4_SERIAL: {
                "type": "neato.gen4",
                "name": "Upstairs",
                "connected": True,
                "label_serial": GEN4_LABEL,
            },
        }

        # ---- Gen3 robot state
        self.g3_state: dict[str, Any] = {
            "version": 1,
            "reqId": "0",
            "result": "ok",
            "data": {},
            "state": 1,  # idle
            "action": 0,
            "alert": None,
            "cleaning": {"category": 2, "mode": 1, "modifier": 1, "navigationMode": 1},
            "details": {
                "isCharging": True,
                "isDocked": True,
                "dockHasBeenSeen": True,
                "charge": 96,
                "isScheduleEnabled": True,
            },
            "availableCommands": {
                "start": True,
                "stop": False,
                "pause": False,
                "resume": False,
                "goToBase": False,
            },
            "meta": {"modelName": "BotVacD7Connected", "firmware": "4.6.0"},
        }
        self.g3_schedule: dict[str, Any] = {
            "enabled": True,
            # robot clock is UTC: Monday 07:00 UTC == 09:00 Stockholm (UTC+2)
            "events": [{"mode": 1, "day": 1, "startTime": "07:00"}],
        }
        self.g3_prefs: dict[str, Any] = {
            "robotSounds": True,
            "dirtbinAlertReminderInterval": 60,
            "filterChangeReminderInterval": 43200,
            "brushChangeReminderInterval": 172800,
        }
        self.g3_maps = [
            {
                "id": MAP3_ID,
                "robot": GEN3_SERIAL,
                "name": "Ground floor",
                "enabled": True,
                "in_maps_list": True,
                "base": [0.0, 0.0],
            }
        ]
        self.g3_boundaries = [
            {
                "id": ZONE3_ID,
                "name": "Kitchen",
                "color": "#ff7a45",
                "type": "polygon",
                "vertices": [[0.2, 0.2], [0.6, 0.2], [0.6, 0.6], [0.2, 0.6]],
                "enabled": True,
            },
            {
                "id": "line-gen3-1",
                "name": "Rug",
                "color": "#fb7185",
                "type": "polyline",
                "vertices": [[0.1, 0.8], [0.9, 0.8]],
                "enabled": True,
            },
        ]
        self.g3_runs = [
            {
                "id": "run-g3-1",
                "robot": GEN3_SERIAL,
                "persistent_map": MAP3_ID,
                "run": {
                    "id": "run-g3-1",
                    "status": "completed",
                    "launched_from": "app",
                    "start_at": "2026-10-10T08:00:00Z",
                    "end_at": "2026-10-10T08:45:00Z",
                    "cleaned_area": 42.5,
                    "run_charge_at_start": 100,
                    "run_charge_at_end": 70,
                },
            }
        ]

        # ---- Gen4 robot state
        self.g4_state: dict[str, Any] = {
            "state": "idle",
            "action": "invalid",
            "errors": None,
            "available_commands": {
                "start": True,
                "cancel": False,
                "pause": False,
                "resume": False,
                "return_to_base": False,
            },
            "details": {
                "is_charging": False,
                "is_docked": True,
                "charge": 80,
                "base_type": "standard",
                "is_quickboost": False,
                "quickboost_estimate": 0,
            },
            "cleaning_center": {},
            "autonomy_states": {},
        }
        self.g4_schedule: dict[str, Any] = {
            "enabled": True,
            "events": [
                {
                    "id": "evt-1",
                    "enabled": True,
                    "days": ["tue", "thu"],
                    "time": "18:30",
                    "command": {
                        "ability": "cleaning.start",
                        "auto_localization": False,
                        "force_floorplan": False,
                        "runs": [
                            {
                                "settings": {"mode": "eco", "navigation_mode": "normal"},
                                "map": {
                                    "rank_id": PLAN4_ID,
                                    "track_id": ZONE4_ID,
                                    "nogo_enabled": True,
                                },
                            }
                        ],
                    },
                }
            ],
        }
        self.g4_cleaning_options = {"force_floorplan": False}
        self.g4_language = {"language": "en", "available_languages": ["en", "de", "sv"]}
        self.g4_maps = [
            {
                "id": PLAN4_ID,
                "robot": GEN4_SERIAL,
                "name": "Upstairs plan",
                "promoted": True,
                "in_maps_list": True,
                "base": [0.0, 0.0, 0.0],
                "origin": [-40000, -40000],
                "resolution": 40,
                "alignment": 0.0087,
                "imgsize": [40, 30],
                "created_at": "2026-09-01T10:00:00Z",
            }
        ]
        self.g4_boundaries = [
            {
                "id": ZONE4_ID,
                "name": "Bedroom",
                "enabled": True,
                "color": "#5aa9ff",
                "vertices": [[0.1, 0.1], [0.5, 0.1], [0.5, 0.5], [0.1, 0.5]],
                "function": "cleaning",
                "type": "polygon",
            },
            {
                "id": NOGO4_ID,
                "name": "Cables",
                "enabled": True,
                "color": "#fb7185",
                "vertices": [[0.6, 0.6], [0.9, 0.6], [0.9, 0.9], [0.6, 0.9]],
                "function": "nogo",
                "type": "polygon",
            },
        ]
        self.g4_runs = [
            {
                "id": PLAN4_ID,
                "robot": GEN4_SERIAL,
                "floorplan": PLAN4_ID,
                "started_by": "schedule",
                "cleaning_complete": True,
                "battery_consumed": 25,
                "timing": {
                    "start": "2026-10-12T17:00:00Z",
                    "end": "2026-10-12T17:50:00Z",
                    "charging": 0,
                    "error": 0,
                    "pause": 0,
                },
                "runs": [
                    {"state": "done", "stats": {"area": 20.0, "pickup_count": 0}},
                    {"state": "done", "stats": {"area": 11.5, "pickup_count": 0}},
                ],
            }
        ]

    # ----------------------------------------------------------------- pushes

    def push_server(self, event: str, data: Any) -> None:
        frame = f"event: {event}\ndata: {json.dumps(data)}\n\n".encode()
        for queue in self.server_streams:
            queue.put_nowait(frame)

    def push_robot(self, serial: str, payload: dict[str, Any]) -> None:
        frame = f"data: {json.dumps(payload)}\n\n\n".encode()
        for queue in self.robot_streams.get(serial, []):
            queue.put_nowait(frame)

    def push_g3_state_event(self) -> None:
        """What the real server sends when a Gen3 robot reports its state."""
        self.push_robot(
            GEN3_SERIAL,
            {
                "serial": GEN3_SERIAL,
                "event": "77",
                "data": {
                    "eventId": "77",
                    "type": "state",
                    "data": {
                        k: self.g3_state[k]
                        for k in (
                            "state",
                            "action",
                            "alert",
                            "details",
                            "availableCommands",
                        )
                    },
                },
                "ts": 1.0,
            },
        )

    def push_g4_state_event(self) -> None:
        self.push_robot(
            GEN4_SERIAL,
            {
                "serial": GEN4_SERIAL,
                "type": "neato.gen4",
                "data": {
                    "type": "event",
                    "id": str(uuid.uuid4()),
                    "to": {"service": "peer.state"},
                    "body": self.g4_state,
                },
                "ts": 1.0,
            },
        )

    def disconnect(self, serial: str) -> None:
        self.robots[serial]["connected"] = False
        self.push_server("robots", self.robots)

    def connect(self, serial: str) -> None:
        self.robots[serial]["connected"] = True
        self.push_server("robots", self.robots)

    # --------------------------------------------------------------- commands

    def _g3(self, cmd: str, params: dict[str, Any] | None) -> tuple[int, Any]:
        base = {"version": 1, "reqId": "1", "result": "ok"}
        state = self.g3_state
        if cmd == "getRobotState":
            return 200, state
        if cmd == "getSchedule":
            return 200, {**base, "data": self.g3_schedule}
        if cmd == "setSchedule":
            self.g3_schedule["events"] = (params or {}).get("events", [])
            return 200, {**base, "data": {}}
        if cmd in ("enableSchedule", "disableSchedule"):
            self.g3_schedule["enabled"] = cmd == "enableSchedule"
            state["details"]["isScheduleEnabled"] = cmd == "enableSchedule"
            return 200, {**base, "data": {}}
        if cmd == "getPreferences":
            return 200, {**base, "data": self.g3_prefs}
        if cmd == "setPreferences":
            self.g3_prefs = dict(params or {})
            return 200, {**base, "data": {}}
        if cmd == "getMapBoundaries":
            return 200, {**base, "data": {"boundaries": self.g3_boundaries}}
        if cmd == "startCleaning":
            state.update(state=2, action=1)
            state["availableCommands"] = {
                "start": False,
                "stop": True,
                "pause": True,
                "resume": False,
                "goToBase": False,
            }
            state["details"]["isDocked"] = False
            self.push_g3_state_event()
            return 200, {**base, "data": {}}
        if cmd == "pauseCleaning":
            state.update(state=3, action=1)
            state["availableCommands"] = {
                "start": False,
                "stop": True,
                "pause": False,
                "resume": True,
                "goToBase": True,
            }
            self.push_g3_state_event()
            return 200, {**base, "data": {}}
        if cmd == "resumeCleaning":
            state.update(state=2, action=1)
            self.push_g3_state_event()
            return 200, {**base, "data": {}}
        if cmd == "stopCleaning":
            state.update(state=1, action=0)
            self.push_g3_state_event()
            return 200, {**base, "data": {}}
        if cmd == "sendToBase":
            state.update(state=2, action=4)
            self.push_g3_state_event()
            return 200, {**base, "data": {}}
        if cmd == "dismissCurrentAlert":
            state["alert"] = None
            self.push_g3_state_event()
            return 200, {**base, "data": {}}
        if cmd in ("findMe", "startPersistentMapExploration", "getLocalStats"):
            return 200, {**base, "data": {"stats": 1} if cmd == "getLocalStats" else {}}
        return 400, {**base, "result": "command_not_found"}

    def _g4(self, ability: str, body: dict[str, Any]) -> tuple[int, Any]:
        def ok(payload: Any, code: int = 200) -> tuple[int, Any]:
            return code, {
                "type": "response",
                "id": str(uuid.uuid4()),
                "code": code,
                "body": payload,
            }

        state = self.g4_state
        if ability == "state.show":
            return ok(state)
        if ability == "scheduling.show":
            return ok(self.g4_schedule)
        if ability == "scheduling.update":
            event = body["event"]
            events = self.g4_schedule["events"]
            if event.get("id"):
                for index, current in enumerate(events):
                    if current["id"] == event["id"]:
                        events[index] = event
            else:
                events.append({**event, "id": f"evt-{len(events) + 1}"})
            return ok(self.g4_schedule)
        if ability == "scheduling.delete":
            self.g4_schedule["events"] = [
                e for e in self.g4_schedule["events"] if e["id"] != body["id"]
            ]
            return ok(self.g4_schedule)
        if ability == "settings.cleaning_options":
            return ok(self.g4_cleaning_options)
        if ability == "settings.set_cleaning_options":
            self.g4_cleaning_options = {"force_floorplan": body["force_floorplan"]}
            return ok(self.g4_cleaning_options)
        if ability == "settings.robot_language":
            return ok(self.g4_language)
        if ability == "settings.set_robot_language":
            self.g4_language = {
                "language": body["language"],
                "available_languages": body.get(
                    "available_languages", self.g4_language["available_languages"]
                ),
            }
            return ok(self.g4_language)
        if ability == "cleaning.start":
            state.update(state="busy", action="cleaning")
            state["available_commands"] = {
                "start": False,
                "cancel": True,
                "pause": True,
                "resume": False,
                "return_to_base": False,
            }
            state["details"]["is_docked"] = False
            self.push_g4_state_event()
            return ok({})
        if ability == "cleaning.pause":
            state.update(state="paused", action="cleaning")
            state["available_commands"] = {
                "start": False,
                "cancel": True,
                "pause": False,
                "resume": True,
                "return_to_base": True,
            }
            self.push_g4_state_event()
            return ok({})
        if ability == "cleaning.resume":
            state.update(state="busy", action="cleaning")
            self.push_g4_state_event()
            return ok({})
        if ability == "cleaning.cancel":
            state.update(state="idle", action="invalid")
            self.push_g4_state_event()
            return ok({})
        if ability == "navigation.return_to_base":
            state.update(state="busy", action="docking")
            self.push_g4_state_event()
            return ok({})
        if ability == "utilities.find_me":
            return ok({})
        return ok({}, 404)

    # ------------------------------------------------------------------- app

    def make_app(self) -> web.Application:
        app = web.Application()
        app.router.add_get("/api/server", self.h_server)
        app.router.add_get("/api/robots", self.h_robots)
        app.router.add_get("/api/events", self.h_events)
        app.router.add_get("/api/robot/{serial}/connect", self.h_connect)
        app.router.add_post("/api/robot/{serial}/command", self.h_command)
        app.router.add_get("/api/robot/{serial}/maps", self.h_maps)
        app.router.add_get("/api/robot/{serial}/maps/{map_id}", self.h_map)
        app.router.add_get("/api/robot/{serial}/maps/{map_id}/boundaries", self.h_boundaries)
        app.router.add_post("/api/robot/{serial}/maps/{map_id}/boundaries", self.h_set_boundaries)
        app.router.add_post("/api/robot/{serial}/maps/{map_id}/use", self.h_post_ok)
        app.router.add_post("/api/robot/{serial}/maps/{map_id}/unuse", self.h_post_ok)
        app.router.add_post("/api/robot/{serial}/maps/{map_id}/promote", self.h_post_ok)
        app.router.add_post("/api/robot/{serial}/maps/{map_id}", self.h_update_map)
        app.router.add_delete("/api/robot/{serial}/maps/{map_id}", self.h_post_ok)
        app.router.add_get("/api/robot/{serial}/runs", self.h_runs)
        app.router.add_get("/api/robot/{serial}/run/{run_id}", self.h_run)
        app.router.add_post("/api/robot/{serial}", self.h_rename)
        return app

    def _json(self, data: Any, status: int = 200) -> web.Response:
        return web.Response(
            body=json.dumps(data).encode(), status=status, content_type="application/json"
        )

    def _ok(self) -> web.Response:
        # the real server answers bare "OK" with a JSON content type
        return web.Response(body=b"OK", status=200, content_type="application/json")

    def _guard(self) -> web.Response | None:
        if self.offline:
            return self._json({"error": "down"}, 503)
        return None

    async def h_server(self, request: web.Request) -> web.Response:
        if (resp := self._guard()) is not None:
            return resp
        return self._json(
            {
                "version": self.version,
                "gen4_port": 3443,
                "timezone": self.timezone,
                "utc_offset_minutes": self.utc_offset_minutes,
            }
        )

    async def h_robots(self, request: web.Request) -> web.Response:
        if (resp := self._guard()) is not None:
            return resp
        return self._json(self.robots)

    async def _sse(
        self, request: web.Request, queues: list[asyncio.Queue[bytes | None]], first: bytes | None
    ) -> web.StreamResponse:
        resp = web.StreamResponse(
            status=200,
            headers={"Content-Type": "text/event-stream", "Cache-Control": "no-cache"},
        )
        await resp.prepare(request)
        queue: asyncio.Queue[bytes | None] = asyncio.Queue()
        queues.append(queue)
        try:
            await resp.write(b": keepalive\n\n")
            if first:
                await resp.write(first)
            while True:
                frame = await queue.get()
                if frame is None:
                    break
                await resp.write(frame)
        except (ConnectionResetError, asyncio.CancelledError):
            pass
        finally:
            if queue in queues:
                queues.remove(queue)
        return resp

    async def h_events(self, request: web.Request) -> web.StreamResponse:
        first = f"event: robots\ndata: {json.dumps(self.robots)}\n\n".encode()
        return await self._sse(request, self.server_streams, first)

    async def h_connect(self, request: web.Request) -> web.StreamResponse:
        serial = request.match_info["serial"]
        if serial not in self.robots:
            return self._json({"error": "Robot not found"}, 404)
        return await self._sse(request, self.robot_streams.setdefault(serial, []), None)

    async def h_command(self, request: web.Request) -> web.Response:
        serial = request.match_info["serial"]
        payload = json.loads(await request.text())
        self.commands.append((serial, payload))
        if serial not in self.robots:
            return self._json({"error": "Robot not found"}, 404)
        if not self.robots[serial]["connected"]:
            return self._json({"error": "Robot not connected"}, 400)
        name = payload.get("cmd") or payload.get("ability")
        if name in self.fail_commands:
            status, body = self.fail_commands[name]
            return self._json(body, status)
        if "cmd" in payload:
            status, body = self._g3(payload["cmd"], payload.get("params"))
        else:
            rest = {k: v for k, v in payload.items() if k != "ability"}
            status, body = self._g4(payload["ability"], rest)
        return self._json(body, status)

    async def h_maps(self, request: web.Request) -> web.Response:
        serial = request.match_info["serial"]
        return self._json(self.g3_maps if "-" in serial else self.g4_maps)

    async def h_map(self, request: web.Request) -> web.Response:
        if request.match_info["map_id"] not in (MAP3_ID, PLAN4_ID):
            return self._json({"error": "Map not found"}, 404)
        return self._json(floor_map())

    async def h_boundaries(self, request: web.Request) -> web.Response:
        return self._json(self.g4_boundaries)

    async def h_set_boundaries(self, request: web.Request) -> web.Response:
        data = json.loads(await request.text())
        self.http_calls.append(("POST", request.path, data))
        self.g4_boundaries = data
        return self._ok()

    async def h_post_ok(self, request: web.Request) -> web.Response:
        self.http_calls.append((request.method, request.path, None))
        return self._ok()

    async def h_update_map(self, request: web.Request) -> web.Response:
        data = json.loads(await request.text())
        self.http_calls.append(("POST", request.path, data))
        return self._ok()

    async def h_runs(self, request: web.Request) -> web.Response:
        serial = request.match_info["serial"]
        return self._json(self.g3_runs if "-" in serial else self.g4_runs)

    async def h_run(self, request: web.Request) -> web.Response:
        return self._json(run_map())

    async def h_rename(self, request: web.Request) -> web.Response:
        serial = request.match_info["serial"]
        data = json.loads(await request.text())
        self.http_calls.append(("POST", request.path, data))
        self.robots[serial]["name"] = data["name"]
        self.push_server("robots", self.robots)
        return self._ok()

    def close_streams(self) -> None:
        for queue in self.server_streams:
            queue.put_nowait(None)
        for queues in self.robot_streams.values():
            for queue in queues:
                queue.put_nowait(None)
