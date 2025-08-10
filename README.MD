# fastpong-game


fastpong/
├─ main.py
├─ requirements.txt
├─ templates/
│  ├─ game.html       # used for both /p1 and /p2 (player substituted)
├─ static/
│  ├─ client.js       # canvas + websocket client logic
│  └─ style.css  


python -m venv venv
source venv/bin/activate   # on Windows: venv\Scripts\activate
pip install -r requirements.txt



uvicorn main:app --host 0.0.0.0 --port 9898 --reload



Player 1 on device A: http://192.168.1.42:9898/p1

Player 2 on device B: http://192.168.1.42:9898/p2

Notes:

If testing locally on same machine, you can open /p1 and /p2 in two tabs.

If you cannot connect from phones, ensure your laptop firewall allows inbound TCP 9898 and both devices are on same network.

For public access across Internet you’d need port forwarding / public IP — not required for LAN.

Extending & improvements (ideas)
Send explicit hit events from server to play stronger sounds on collisions.

Add acceleration, spin, power-ups, or special colorful particle effects on collisions.

Add chat or spectator mode /spectate.


Add authentication or rooms so multiple matches can run.
