"""Run the fake Vacuula server on a port (used by the Jest integration tests).

Needs `pip install aiohttp`. It imitates the real Vacuula server's HTTP/SSE API.
"""
import asyncio
import os
import sys

from aiohttp import web

sys.path.insert(0, os.path.dirname(__file__))
from fake_vacuula import FakeVacuula  # noqa: E402


async def main(port: int) -> None:
    fake = FakeVacuula()
    runner = web.AppRunner(fake.make_app())
    await runner.setup()
    await web.TCPSite(runner, "127.0.0.1", port).start()
    print("READY", flush=True)
    await asyncio.Event().wait()


asyncio.run(main(int(sys.argv[1])))
