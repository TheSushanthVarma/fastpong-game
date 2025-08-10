// static/client.js
(() => {
    const canvas = document.getElementById("game");
    const ctx = canvas.getContext("2d");
    const statusEl = document.getElementById("status");
    const startBtn = document.getElementById("startBtn");
    const msgEl = document.getElementById("message");
    const scoreEl = document.getElementById("score");
  
    const WIDTH = canvas.width;
    const HEIGHT = canvas.height;
    const PADDLE_WIDTH = 14;
    const PADDLE_HEIGHT = 100;
    const BALL_SIZE = 14;
  
    let ws;
    let connected = false;
    let running = false;
    let ready = false;
    let otherReady = false;
  
    const state = {
      ball: { x: WIDTH/2, y: HEIGHT/2 },
      p1: { y: HEIGHT/2 - PADDLE_HEIGHT/2 },
      p2: { y: HEIGHT/2 - PADDLE_HEIGHT/2 },
      score: { p1:0, p2:0 }
    };
  
    function connect() {
      const loc = window.location;
      const host = loc.hostname || "localhost";
      const url = `${loc.protocol === "https:" ? "wss" : "ws"}://${host}:9898/ws?player=${PLAYER}`;
      ws = new WebSocket(url);
  
      ws.addEventListener("open", () => {
        connected = true;
        statusEl.textContent = "Connected";
        statusEl.style.color = "#9ef6b7";
      });
  
      ws.addEventListener("message", ev => {
        const d = JSON.parse(ev.data);
        if (d.type === "state") {
          state.ball = d.ball;
          state.p1.y = d.p1.y;
          state.p2.y = d.p2.y;
          state.score = d.score;
          running = d.running;
          ready = d.ready[PLAYER];
          otherReady = d.ready[PLAYER === "p1" ? "p2" : "p1"];
          updateUI();
          if (d.running) msgEl.textContent = "";
        } else if (d.type === "waiting") {
          msgEl.textContent = d.msg;
        } else if (d.type === "countdown") {
          runCountdown(d.n);
        } else if (d.type === "started") {
          msgEl.textContent = "";
          running = true;
        } else if (d.type === "info") {
          // tiny ephemeral message
          //console.log("info", d.msg);
        }
      });
  
      ws.addEventListener("close", () => {
        connected = false;
        statusEl.textContent = "Disconnected";
        statusEl.style.color = "#ff7a7a";
        setTimeout(connect, 1000);
      });
    }
  
    // send paddle pos to server (server authoritative)
    function sendMove(y) {
      if (!connected) return;
      ws.send(JSON.stringify({type:"move", y: y}));
    }
    function sendStart() {
      if (!connected) return;
      ws.send(JSON.stringify({type:"start"}));
    }
  
    // simple UI updates
    function updateUI(){
      scoreEl.textContent = `${state.score.p1} — ${state.score.p2}`;
      if (ready && otherReady) {
        msgEl.textContent = "Both ready — starting soon...";
      } else if (ready && !otherReady) {
        msgEl.textContent = "Waiting for other player...";
      } else {
        // not ready
      }
    }
  
    // input: mouse/touch move to move your paddle
    let dragging = false;
    function localYFromEvent(e){
      const rect = canvas.getBoundingClientRect();
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      const y = clientY - rect.top - PADDLE_HEIGHT/2;
      return Math.max(0, Math.min(HEIGHT - PADDLE_HEIGHT, y));
    }
    canvas.addEventListener("mousedown", e => { dragging = true; });
    window.addEventListener("mouseup", e => { dragging = false; });
    canvas.addEventListener("mousemove", e => {
      if (!dragging) return;
      const y = localYFromEvent(e);
      sendMove(y);
    });
    canvas.addEventListener("touchstart", e => { dragging = true; e.preventDefault(); }, {passive:false});
    window.addEventListener("touchend", e => { dragging = false; });
    canvas.addEventListener("touchmove", e => {
      if (!dragging) return;
      const y = localYFromEvent(e);
      sendMove(y);
      e.preventDefault();
    }, {passive:false});
  
    // keyboard support: up/down arrows (for desktop)
    window.addEventListener("keydown", e => {
      if (!connected) return;
      const step = 14;
      if (PLAYER === "p1") {
        let y = state.p1.y;
        if (e.key === "ArrowUp") y -= step;
        if (e.key === "ArrowDown") y += step;
        y = Math.max(0, Math.min(HEIGHT - PADDLE_HEIGHT, y));
        sendMove(y);
      } else {
        let y = state.p2.y;
        if (e.key === "ArrowUp") y -= step;
        if (e.key === "ArrowDown") y += step;
        y = Math.max(0, Math.min(HEIGHT - PADDLE_HEIGHT, y));
        sendMove(y);
      }
    });
  
    // start button
    startBtn.addEventListener("click", () => {
      sendStart();
      startBtn.disabled = true;
      startBtn.textContent = "Waiting...";
    });
  
    // drawing
    function draw() {
      // bg
      ctx.clearRect(0,0,WIDTH,HEIGHT);
      // soft gradient bg
      const g = ctx.createLinearGradient(0,0,WIDTH,HEIGHT);
      g.addColorStop(0, "#071024");
      g.addColorStop(1, "#081B2D");
      ctx.fillStyle = g;
      ctx.fillRect(0,0,WIDTH,HEIGHT);
  
      // middle dashed line
      ctx.strokeStyle = "rgba(255,255,255,0.06)";
      ctx.lineWidth = 2;
      ctx.setLineDash([10, 14]);
      ctx.beginPath();
      ctx.moveTo(WIDTH/2, 0);
      ctx.lineTo(WIDTH/2, HEIGHT);
      ctx.stroke();
      ctx.setLineDash([]);
  
      // paddles with glow
      // p1
      drawPaddle(0 + 2, state.p1.y, "p1");
      // p2
      drawPaddle(WIDTH - PADDLE_WIDTH - 2, state.p2.y, "p2");
  
      // ball with colorful trail
      drawBall(state.ball.x, state.ball.y);
  
      requestAnimationFrame(draw);
    }
  
    function drawPaddle(x,y, who){
      // gradient depending on who
      const grad = ctx.createLinearGradient(x, y, x + PADDLE_WIDTH, y + PADDLE_HEIGHT);
      if (who === "p1"){
        grad.addColorStop(0, "#00d4ff");
        grad.addColorStop(1, "#7a4bff");
      } else {
        grad.addColorStop(0, "#ff8a00");
        grad.addColorStop(1, "#ff3ca6");
      }
      // glow
      ctx.fillStyle = grad;
      roundRect(ctx, x-6, y-6, PADDLE_WIDTH+12, PADDLE_HEIGHT+12, 18);
      ctx.filter = "blur(6px)";
      ctx.globalAlpha = 0.18;
      ctx.fill();
      ctx.filter = "none";
      ctx.globalAlpha = 1;
  
      // main paddle
      ctx.fillStyle = grad;
      roundRect(ctx, x, y, PADDLE_WIDTH, PADDLE_HEIGHT, 8);
      ctx.fill();
    }
  
    function drawBall(x,y){
      // colorful core
      const g = ctx.createRadialGradient(x+BALL_SIZE/2, y+BALL_SIZE/2, 2, x+BALL_SIZE/2, y+BALL_SIZE/2, BALL_SIZE);
      g.addColorStop(0, "#fff");
      g.addColorStop(0.25, "#fff07f");
      g.addColorStop(0.5, "#ff6b6b");
      g.addColorStop(1, "#c34cff");
      ctx.fillStyle = g;
      roundRect(ctx, x, y, BALL_SIZE, BALL_SIZE, BALL_SIZE/2);
      ctx.fill();
  
      // subtle shadow
      ctx.fillStyle = "rgba(0,0,0,0.12)";
      ctx.fillRect(x, y + BALL_SIZE - 2, BALL_SIZE, 2);
    }
  
    function roundRect(ctx, x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    }
  
    // countdown visuals
    function runCountdown(n){
      msgEl.textContent = "";
      let i = n;
      const cd = () => {
        if (i <= 0) {
          msgEl.textContent = "";
          startBtn.disabled = false;
          startBtn.textContent = "Click to Start";
          return;
        }
        msgEl.textContent = i;
        i--;
        setTimeout(cd, 1000);
      };
      cd();
    }
  
    // small tone feedback using WebAudio
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    function beep(freq=440, dur=0.06, vol=0.1){
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = "sine";
      o.frequency.value = freq;
      g.gain.value = vol;
      o.connect(g);
      g.connect(audioCtx.destination);
      o.start();
      o.stop(audioCtx.currentTime + dur);
    }
  
    // for hit sound when server reports running state change or ball hits paddle (we don't receive explicit hit events now).
    // We will play a soft periodic 'tick' while running
    let lastBallX = state.ball.x;
    function soundWatcher(){
      try {
        if (running && Math.abs(state.ball.x - lastBallX) > 2) {
          // play on notable x change (approx collision)
          // pick freq by distance to center
          const centerDist = Math.abs(state.ball.x - WIDTH/2);
          const freq = 400 + (centerDist / (WIDTH/2)) * 800;
          beep(freq, 0.05, 0.08);
        }
        lastBallX = state.ball.x;
      } catch (e) {}
      setTimeout(soundWatcher, 120);
    }
  
    // initial connect & draw
    connect();
    requestAnimationFrame(draw);
    soundWatcher();
  
    // ping server periodically to keep WS alive if needed
    setInterval(() => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({type:"ping"}));
      }
    }, 5000);
  
  })();
  