"""Managed loopback launcher for the author's unmodified Laya HTTP application.

Only adds installed version/deployment facts to health; prediction is handled by
laya.serve, including its observable tournament metadata and token diagnostics.
"""
import json
import os
import sys
from importlib.metadata import version

DEFAULTS = {
    "LAYA_HOST": "127.0.0.1", "LAYA_PORT": "8765", "LAYA_DEVICE": "cpu",
    "LAYA_THREADS": "8", "LAYA_PRELOAD": "1", "LAYA_MODELS": "multilingual",
    "LAYA_DEFAULT_MODEL": "multilingual", "LAYA_AUTO_TASK": "0", "LAYA_MAX_LOADED": "1",
    "LAYA_REVISION": "7b928d828b7b0e022f929d9bd2e44165aa270148",
    "LAYA_TOURNAMENT_GROUP": "16", "LAYA_JEV_STRICT": "0",
    "LAYA_CPU_AMP": "", "LAYA_EXTRA_MODELS": "", "LAYA_MAX_TOKEN_BUDGET": "8192",
}
REQUEST_DEFAULTS = {"maxLen": 4096, "headMaxLen": 768}


def configure_runtime_environment(environment):
    """Validate first, then configure only this dedicated child process."""
    if environment.get("LAYA_API_KEY", "").strip():
        raise ValueError("LAYA_API_KEY: the local experiment service uses no key; remove it from this child-process configuration")
    for name, value in DEFAULTS.items():
        if name in environment and environment[name] != value:
            raise ValueError(name + ": conflicts with the fixed local experiment profile")
    environment.update(DEFAULTS)


def deployment_facts(environment, installed_version):
    return {
        "source": "edge-api-lab-managed-launcher", "version": installed_version,
        "tournamentGroup": int(environment["LAYA_TOURNAMENT_GROUP"]), "maxChoices": 255,
        **REQUEST_DEFAULTS, "budgetRole": "client-request-profile",
        "threads": int(environment["LAYA_THREADS"]),
        "defaultModel": environment["LAYA_DEFAULT_MODEL"],
        "modelRevision": environment["LAYA_REVISION"],
    }


try:
    configure_runtime_environment(os.environ)
except ValueError as error:
    print(str(error), file=sys.stderr)
    raise SystemExit(2)
if __name__ == "__main__" and "--check-config" in sys.argv:
    raise SystemExit(0)

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
    if "loaded" in payload:
        payload["deployment"] = deployment_facts(os.environ, version("laya"))
    return JSONResponse(payload)


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=int(os.environ["LAYA_PORT"]), log_level="info")
