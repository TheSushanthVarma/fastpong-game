# main.py
import asyncio
import json
import time
from typing import Dict, Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

app = FastAPI()
templates = Jinja2Templates(directory="templates")
app.mount("/static", StaticFiles(directory="static"), name="static")

# Game constants
FPS = 60
WIDTH = 900
HEIGHT = 500
PADDLE_WIDTH = 14
PADDLE_HEIGHT = 100
BALL_SIZE = 14
PADDLE_SPEED = 7
BALL_SPEED = 6
WIN_SCORE = 7

# Server state
class PlayerConn:
    def __init__(self):
        self.ws: Optional[WebSocket] = None
        self.ready = False
        self.connected = False
        self.y = HEIGHT // 2 - PADDLE_HEIGHT // 2  # paddle center y

players: Dict[str, PlayerConn] = {
    "p1": PlayerConn(),
    "p2": PlayerConn(),
}

game_running = False
start_clicked = {"p1": False, "p2": False}
# authoritative state
ball = {"x": WIDTH // 2 - BALL_SIZE // 2, "y": HEIGHT // 2 - BALL_SIZE // 2,
        "vx": BALL_SPEED, "vy": 0}
score = {"p1": 0, "p2": 0}
_last_tick = 0
broadcast_task: Optional[asyncio.Task] = None
lock = asyncio.Lock()


@app.get("/p1")
async def p1(request: Request):
    return templates.TemplateResponse("game.html", {"request": request, "player": "p1", "width": WIDTH, "height": HEIGHT})


@app.get("/p2")
async def p2(request: Request):
    return templates.TemplateResponse("game.html", {"request": request, "player": "p2", "width": WIDTH, "height": HEIGHT})


async def broadcast_state():
    global _last_tick, ball, game_running
    dt = 1.0 / FPS
    _last_tick = time.time()
    while True:
        t0 = time.time()
        async with lock:
            if game_running:
                # simple physics step
                ball["x"] += ball["vx"]
                ball["y"] += ball["vy"]

                # gravity/limit vy
                if ball["y"] < 0:
                    ball["y"] = 0
                    ball["vy"] = -ball["vy"]
                if ball["y"] > HEIGHT - BALL_SIZE:
                    ball["y"] = HEIGHT - BALL_SIZE
                    ball["vy"] = -ball["vy"]

                # paddle collision
                # p1 paddle is left side
                p1 = players["p1"]
                p2 = players["p2"]

                # collision with p1
                if (ball["x"] <= PADDLE_WIDTH and
                        p1.connected and
                        ball["y"] + BALL_SIZE >= p1.y and ball["y"] <= p1.y + PADDLE_HEIGHT):
                    ball["x"] = PADDLE_WIDTH
                    ball["vx"] = abs(ball["vx"]) + 0.2  # speed up a bit
                    # reflect vertical velocity based on where it hit
                    center_diff = (ball["y"] + BALL_SIZE / 2) - (p1.y + PADDLE_HEIGHT / 2)
                    ball["vy"] = center_diff * 0.08

                # collision with p2 (right)
                if (ball["x"] + BALL_SIZE >= WIDTH - PADDLE_WIDTH and
                        p2.connected and
                        ball["y"] + BALL_SIZE >= p2.y and ball["y"] <= p2.y + PADDLE_HEIGHT):
                    ball["x"] = WIDTH - PADDLE_WIDTH - BALL_SIZE
                    ball["vx"] = -abs(ball["vx"]) - 0.2
                    center_diff = (ball["y"] + BALL_SIZE / 2) - (p2.y + PADDLE_HEIGHT / 2)
                    ball["vy"] = center_diff * 0.08

                # scoring
                if ball["x"] < -BALL_SIZE:
                    score["p2"] += 1
                    reset_ball(direction=1)
                    game_running = False
                    start_clicked["p1"] = start_clicked["p2"] = False
                if ball["x"] > WIDTH + BALL_SIZE:
                    score["p1"] += 1
                    reset_ball(direction=-1)
                    game_running = False
                    start_clicked["p1"] = start_clicked["p2"] = False

            # package update
            state = {
                "type": "state",
                "ball": {"x": ball["x"], "y": ball["y"]},
                "p1": {"y": players["p1"].y},
                "p2": {"y": players["p2"].y},
                "score": score,
                "running": game_running,
                "ready": {"p1": start_clicked["p1"], "p2": start_clicked["p2"]},
            }

        # broadcast to connected clients
        conns = []
        for k in ("p1", "p2"):
            w = players[k].ws
            if w is not None:
                conns.append(w)

        for ws in conns:
            try:
                await ws.send_text(json.dumps(state))
            except Exception:
                pass

        # maintain FPS
        t1 = time.time()
        elapsed = t1 - t0
        sleep_for = max(0, dt - elapsed)
        await asyncio.sleep(sleep_for)


def reset_ball(direction=1):
    # direction: 1 -> to right, -1 -> to left
    import random
    ball["x"] = WIDTH // 2 - BALL_SIZE // 2
    ball["y"] = HEIGHT // 2 - BALL_SIZE // 2
    ball["vx"] = BALL_SPEED * direction
    ball["vy"] = (random.random() - 0.5) * 4


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()
    # expect query param player=p1 or p2
    qs = ws.query_params
    player = qs.get("player")
    if player not in ("p1", "p2"):
        await ws.send_text(json.dumps({"type": "error", "msg": "invalid player"}))
        await ws.close()
        return

    pconn = players[player]
    pconn.ws = ws
    pconn.connected = True
    pconn.ready = False
    start_clicked[player] = False
    print(f"{player} connected")

    # start broadcast task if not started
    global broadcast_task
    if broadcast_task is None:
        broadcast_task = asyncio.create_task(broadcast_state())

    try:
        # inform both players of current connection status
        await notify_all({"type": "info", "msg": f"{player} joined"})
        while True:
            data_str = await ws.receive_text()
            try:
                data = json.loads(data_str)
            except:
                continue

            typ = data.get("type")
            if typ == "move":
                # update paddle positions (server authoritative)
                # data: {type:move, y: <newY>}
                y = float(data.get("y", 0))
                # clamp
                y = max(0, min(HEIGHT - PADDLE_HEIGHT, y))
                async with lock:
                    pconn.y = y
            elif typ == "start":
                # player clicked start
                start_clicked[player] = True
                # if both clicked start and both connected, begin countdown and run
                if start_clicked["p1"] and start_clicked["p2"] and players["p1"].connected and players["p2"].connected:
                    # reset scores or continue? here we continue. if you want to reset, uncomment:
                    # score["p1"] = score["p2"] = 0
                    await notify_all({"type": "countdown", "n": 3})
                    # small delay for countdown visuals
                    await asyncio.sleep(3.2)
                    async with lock:
                        reset_ball(direction=1 if time.time() % 2 < 1 else -1)
                        global game_running
                        game_running = True
                    await notify_all({"type": "started"})
                else:
                    # tell the starter to wait
                    await ws.send_text(json.dumps({"type": "waiting", "msg": "Waiting for other player..."}))

            elif typ == "ping":
                await ws.send_text(json.dumps({"type": "pong"}))
            # other message types can be added: pause, resume, chat, etc.

    except WebSocketDisconnect:
        print(f"{player} disconnected")
    finally:
        # cleanup
        pconn.ws = None
        pconn.connected = False
        pconn.ready = False
        start_clicked[player] = False
        await notify_all({"type": "info", "msg": f"{player} left"})


async def notify_all(message: dict):
    text = json.dumps(message)
    for k in ("p1", "p2"):
        w = players[k].ws
        if w is not None:
            try:
                await w.send_text(text)
            except Exception:
                pass


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=9898, reload=True)
