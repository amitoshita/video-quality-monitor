from fastapi import FastAPI

app = FastAPI(title="Video Quality Monitor API")


@app.get("/healthz")
def healthz() -> dict[str, str]:
    return {"status": "ok"}
