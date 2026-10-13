"""Managed loopback launcher for the author's unmodified Laya HTTP application.

Only adds installed version/deployment facts to health; prediction is handled by
laya.serve, including its observable tournament metadata and token diagnostics.
"""
import json
import os
from importlib.metadata import version

DEFAULTS = {
    "LAYA_HOST": "127.0.0.1", "LAYA_PORT": "8765", "LAYA_DEVICE": "cpu",
    "LAYA_THREADS": "8", "LAYA_PRELOAD": "1", "LAYA_MODELS": "multilingual",
    "LAYA_DEFAULT_MODEL": "multilingual", "LAYA_AUTO_TASK": "0", "LAYA_MAX_LOADED": "1",
    "LAYA_REVISION": "7b928d828b7b0e022f929d9bd2e44165aa270148",
    "LAYA_TOURNAMENT_GROUP": "16", "LAYA_JEV_STRICT": "0",
}
for name, value in DEFAULTS.items():
    os.environ.setdefault(name, value)
if os.environ["LAYA_HOST"] != "127.0.0.1":
    raise ValueError("The lab Laya service must bind to 127.0.0.1")

from laya.serve import create_app  # noqa: E402
from starlette.responses import JSONResponse  # noqa: E402
import uvicorn  # noqa: E402

app = create_app()


@app.middleware("http")
async def deployment_health(request, call_next):
    response = await call_next(request)
    if request.method != "GET" or request.url.path != "/health" or response.status_code != 200:
        return response
    body = b"".join([chunk async for chunk in response.body_iterator])
    payload = json.loads(body)
    # Preserve the author's liveness-only response if somebody enabled auth.
    if "loaded" in payload:
        group = int(os.environ["LAYA_TOURNAMENT_GROUP"])
        payload["deployment"] = {
            "source": "edge-api-lab-managed-launcher", "version": version("laya"),
            "tournamentGroup": group, "maxChoices": 255 if group else 100,
            "maxLen": 4096, "headMaxLen": 768, "threads": int(os.environ["LAYA_THREADS"]),
            "defaultModel": os.environ["LAYA_DEFAULT_MODEL"],
        }
    return JSONResponse(payload)


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=int(os.environ["LAYA_PORT"]), log_level="info")
