// map3d.js — ZUMI TAXI 3D 마을 지도 (three.js r149, three.min.js 필요)
// zumi_ble.html 의 전역 값을 읽음: st(로봇 상태), G, at, pos(노드 배치), pend, edit, pickMode('', 'start', 'dest'), draft{start, head, dest}
// 누르면 부름: onMapPin(n) 목적지 핀, onMapNode(n) 노드(출발 위치 고를 때), toggleRoad(a, b) 도로 공사
// 맵 구조(노드 번호, 구간)는 node_pathfinder.h 와 같음. 겉모습만 실제 마을처럼 꾸밈 (사람·차·구름은 장식)
(function () {
  const M3 = window.M3 = { ok: false };
  if (!window.THREE) return;
  const T = THREE;

  // ---- 크기 (월드 단위) ----
  const SP = 10;      // 노드 사이
  const RW = 3.2;     // 도로 폭
  const BL = SP - RW; // 블록 한 변

  // ---- 색 ----
  const C = {
    grass: 0x86b85a, walk: 0xdcd6c8, road: 0x3c4047, lane: 0xffd400, mark: 0xff2d2d,
    route: 0x3fa9ff, taxi: 0xffc81a, glass: 0x24323f, white: 0xffffff, cone: 0xff7a00, trunk: 0x8a5a34,
    leaf: [0x4f9a3c, 0x5fae45, 0x3f8a36],
    wall: [0xf4e6cf, 0xe9c9a8, 0xd8e3ea, 0xf2d0c4, 0xc9dcc0, 0xe7dcc0, 0xbfd0e0],
    roof: [0xc0533d, 0x5a6f8c, 0x7b4f3a, 0x3f6b5c, 0xa7473a, 0x56606b],
    shirt: [0xe85d5d, 0x4a90d9, 0x3fb68b, 0xf2b134, 0x9b6bd6, 0xf28fb1, 0xffffff, 0x2f3a4a],
    skin: [0xf1c9a5, 0xe0ac84, 0xc68a62, 0xf6d7bb],
    car: [0xd94b4b, 0x3f7fd1, 0xeeeeee, 0x4c5866, 0x5cb87a],
  };
  const matCache = {};
  const mat = (c, o) => { const k = c + (o ? JSON.stringify(o) : ''); return matCache[k] || (matCache[k] = new T.MeshLambertMaterial(Object.assign({ color: c }, o || {}))); };
  const box = (w, h, d, c, o) => { const m = new T.Mesh(new T.BoxGeometry(w, h, d), mat(c, o)); m.castShadow = m.receiveShadow = true; return m; };

  // 늘 같은 마을이 나오게 (seed 고정 난수)
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const pick = a => a[Math.floor(rnd() * a.length)];

  // ---- 렌더러 / 장면 ----
  const host = document.getElementById('three');
  let renderer;
  try { renderer = new T.WebGLRenderer({ antialias: true }); } catch (e) { return; }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFSoftShadowMap;
  host.appendChild(renderer.domElement);

  const scene = new T.Scene();
  scene.background = new T.Color(0xa9d6e8);
  scene.fog = new T.Fog(0xa9d6e8, 70, 150);
  const cam = new T.PerspectiveCamera(32, 1, 0.5, 400);

  scene.add(new T.HemisphereLight(0xffffff, 0x5f7f45, 0.62));
  const sun = new T.DirectionalLight(0xffffff, 0.62);
  sun.position.set(-25, 45, 20);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.bias = -0.0005;
  scene.add(sun);

  const world = new T.Group(); scene.add(world); // 땅·도로·건물 (G 바뀔 때만 다시)
  const life = new T.Group(); scene.add(life);   // 사람·차·구름
  const dyn = new T.Group(); scene.add(dyn);     // 경로·막힘
  const pins = new T.Group(); scene.add(pins);   // 목적지 핀
  const nodes = new T.Group(); scene.add(nodes); // 노드 고르기 표시
  const hits = new T.Group(); scene.add(hits);   // 도로 누르기 (도로 공사)

  // ---- 좌표 ----
  let G3 = 0;
  const wp = n => { const p = pos[n]; return p ? new T.Vector3((p.c - G3 / 2) * SP, 0, (p.r - G3 / 2) * SP) : new T.Vector3(); };
  const segs = () => { const s = []; for (let r = 0; r <= G3; r++) for (let c = 0; c <= G3; c++) { if (c < G3) s.push([at[r][c], at[r][c + 1]]); if (r < G3) s.push([at[r][c], at[r + 1][c]]); } return s; };
  const outDir = n => { const p = pos[n]; let x = 0, z = 0; if (p.r === 0) z = -1; if (p.r === G3) z = 1; if (p.c === 0) x = -1; if (p.c === G3) x = 1; return new T.Vector3(x, 0, z).normalize(); };
  const boxPos = () => wp(at[G3][G3]).lerp(wp(at[G3 - 1][G3]), 0.35); // 출발칸 (택시 승강장)

  // ---- 글자 그림 ----
  const texCache = {};
  function badgeTex(text, bg, fg, w = 128, h = 128, r = 30, font = 'bold 64px') {
    const k = [text, bg, fg, w, h, r, font].join('|'); if (texCache[k]) return texCache[k];
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const g = cv.getContext('2d');
    g.fillStyle = bg; g.strokeStyle = 'rgba(0,0,0,.25)'; g.lineWidth = 6;
    g.beginPath(); g.roundRect ? g.roundRect(4, 4, w - 8, h - 8, r) : g.rect(4, 4, w - 8, h - 8); g.fill(); g.stroke();
    g.fillStyle = fg; g.font = font + ' system-ui, "Malgun Gothic", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, w / 2, h / 2 + 3);
    const t = new T.CanvasTexture(cv); t.anisotropy = 4; return (texCache[k] = t);
  }
  function stripeTex() {
    const cv = document.createElement('canvas'); cv.width = 128; cv.height = 32;
    const g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 128, 32);
    g.fillStyle = '#ff6a00'; for (let x = -32; x < 160; x += 32) { g.beginPath(); g.moveTo(x, 32); g.lineTo(x + 16, 32); g.lineTo(x + 32, 0); g.lineTo(x + 16, 0); g.fill(); }
    return new T.CanvasTexture(cv);
  }
  const STRIPE = stripeTex();

  // ---- 소품 ----
  const sway = [];
  function tree(x, z, s = 1) {
    const g = new T.Group();
    const tr = new T.Mesh(new T.CylinderGeometry(0.12 * s, 0.16 * s, 0.6 * s, 6), mat(C.trunk)); tr.position.y = 0.3 * s; tr.castShadow = true; g.add(tr);
    const k = rnd() < 0.5;
    const lf = new T.Mesh(k ? new T.ConeGeometry(0.75 * s, 1.6 * s, 7) : new T.IcosahedronGeometry(0.75 * s, 0), mat(pick(C.leaf), { flatShading: true }));
    lf.position.y = k ? 1.3 * s : 1.15 * s; lf.castShadow = true; g.add(lf);
    g.userData.ph = rnd() * 6; sway.push(g);
    g.position.set(x, 0, z); return g;
  }
  function house(x, z, w, d, rot) {
    const g = new T.Group();
    const h = 1.0 + rnd() * 0.9;
    const wall = box(w, h, d, pick(C.wall)); wall.position.y = h / 2; g.add(wall);
    const roof = new T.Mesh(new T.ConeGeometry(Math.hypot(w, d) / 2 * 1.02, 0.9 + rnd() * 0.4, 4, 1), mat(pick(C.roof), { flatShading: true }));
    roof.rotation.y = Math.PI / 4; roof.scale.set(w / Math.hypot(w, d) * 1.41, 1, d / Math.hypot(w, d) * 1.41);
    roof.position.y = h + 0.45; roof.castShadow = true; g.add(roof);
    const door = box(0.32, 0.55, 0.05, 0x6b4a32); door.position.set(0, 0.28, d / 2 + 0.01); g.add(door);
    for (const sx of [-1, 1]) { const wi = box(0.3, 0.3, 0.05, 0x9fd0ea); wi.position.set(sx * w * 0.28, h * 0.6, d / 2 + 0.01); g.add(wi); }
    if (rnd() < 0.35) { const ch = box(0.22, 0.5, 0.22, 0x8a7d70); ch.position.set(w * 0.25, h + 0.6, -d * 0.15); g.add(ch); }
    g.position.set(x, 0, z); g.rotation.y = rot; return g;
  }
  function tower(x, z, w, d) {
    const g = new T.Group();
    const fl = 2 + Math.floor(rnd() * 3), h = fl * 0.9;
    const b = box(w, h, d, pick([0xe3e0d8, 0xcfd8e0, 0xe8d6c2])); b.position.y = h / 2; g.add(b);
    for (let i = 0; i < fl; i++) for (const s of [-1, 1]) {
      const wn = box(w * 0.86, 0.32, 0.04, 0x8fc3e0); wn.position.set(0, 0.5 + i * 0.9, s * (d / 2 + 0.01)); g.add(wn);
    }
    const top = box(w + 0.1, 0.12, d + 0.1, 0x9a9a9a); top.position.y = h + 0.06; g.add(top);
    const aw = box(w * 0.9, 0.06, 0.5, pick([0xd9534f, 0x3f7fd1, 0x3fb68b])); aw.position.set(0, 0.85, d / 2 + 0.25); g.add(aw); // 가게 차양
    g.position.set(x, 0, z); return g;
  }
  function cone(x, z) {
    const g = new T.Group();
    const b = box(0.6, 0.06, 0.6, 0x222222); b.position.y = 0.03; g.add(b);
    const c = new T.Mesh(new T.ConeGeometry(0.26, 0.75, 12), mat(C.cone)); c.position.y = 0.42; c.castShadow = true; g.add(c);
    const r = new T.Mesh(new T.CylinderGeometry(0.17, 0.2, 0.12, 12), mat(C.white)); r.position.y = 0.42; g.add(r);
    g.position.set(x, 0.12, z); g.scale.setScalar(1.45); return g;
  }
  function lamp(x, z) {
    const g = new T.Group();
    const p = new T.Mesh(new T.CylinderGeometry(0.05, 0.06, 1.8, 6), mat(0x3a3f47)); p.position.y = 0.9; g.add(p);
    const h = new T.Mesh(new T.SphereGeometry(0.16, 8, 6), new T.MeshBasicMaterial({ color: 0xfff3c4 })); h.position.y = 1.85; g.add(h);
    g.position.set(x, 0.1, z); return g;
  }
  function carModel(color, s = 1) {
    const g = new T.Group();
    const b = box(1.7, 0.5, 0.95, color); b.position.y = 0.45; g.add(b);
    const c = box(0.95, 0.42, 0.85, color); c.position.set(-0.1, 0.9, 0); g.add(c);
    for (const sz of [-1, 1]) { const w = box(0.8, 0.28, 0.02, C.glass); w.position.set(-0.1, 0.92, sz * 0.43); g.add(w); }
    const fw = box(0.02, 0.28, 0.75, C.glass); fw.position.set(0.38, 0.92, 0); g.add(fw);
    for (const sx of [-0.55, 0.55]) for (const sz of [-0.47, 0.47]) {
      const wh = new T.Mesh(new T.CylinderGeometry(0.22, 0.22, 0.16, 12), mat(0x1b1b1b)); wh.rotation.x = Math.PI / 2; wh.position.set(sx, 0.23, sz); g.add(wh);
    }
    g.scale.setScalar(s); return g;
  }
  function person() {
    const g = new T.Group();
    const legs = new T.Mesh(new T.CylinderGeometry(0.11, 0.1, 0.42, 6), mat(pick([0x2f3a4a, 0x4a4a4a, 0x355a8a]))); legs.position.y = 0.21; g.add(legs);
    const body = new T.Mesh(new T.CylinderGeometry(0.15, 0.13, 0.46, 8), mat(pick(C.shirt))); body.position.y = 0.64; body.castShadow = true; g.add(body);
    const head = new T.Mesh(new T.SphereGeometry(0.15, 10, 8), mat(pick(C.skin))); head.position.y = 1.02; head.castShadow = true; g.add(head);
    if (rnd() < 0.5) { const hat = new T.Mesh(new T.CylinderGeometry(0.16, 0.16, 0.08, 10), mat(pick(C.shirt))); hat.position.y = 1.15; g.add(hat); }
    g.scale.setScalar(1.25); return g;
  }
  function taxi() {
    const g = new T.Group(), car = new T.Group(); g.add(car);
    const body = box(2.0, 0.55, 1.1, C.taxi); body.position.y = 0.5; car.add(body);
    const cab = box(1.1, 0.48, 1.0, C.taxi); cab.position.set(-0.1, 0.99, 0); car.add(cab);
    for (const s of [-1, 1]) { const w = box(0.9, 0.34, 0.02, C.glass); w.position.set(-0.1, 1.0, s * 0.51); car.add(w); }
    const fw = box(0.02, 0.34, 0.86, C.glass); fw.position.set(0.46, 1.0, 0); car.add(fw);
    const rw = box(0.02, 0.34, 0.86, C.glass); rw.position.set(-0.66, 1.0, 0); car.add(rw);
    const tt = badgeTex('TAXI', '#ffffff', '#141414', 128, 64, 10, 'bold 40px');
    const sign = new T.Mesh(new T.BoxGeometry(0.5, 0.22, 0.32), [mat(C.white), mat(C.white), mat(C.white), mat(C.white), new T.MeshBasicMaterial({ map: tt }), new T.MeshBasicMaterial({ map: tt })]);
    sign.position.set(-0.1, 1.35, 0); sign.rotation.y = Math.PI / 2; car.add(sign);
    const chk = box(2.02, 0.12, 1.12, 0x222222); chk.position.y = 0.42; car.add(chk);
    for (const sx of [-0.62, 0.62]) for (const sz of [-0.55, 0.55]) {
      const wh = new T.Mesh(new T.CylinderGeometry(0.26, 0.26, 0.2, 14), mat(0x1b1b1b)); wh.rotation.x = Math.PI / 2; wh.position.set(sx, 0.27, sz); wh.castShadow = true; car.add(wh);
    }
    for (const sz of [-0.36, 0.36]) { const l = new T.Mesh(new T.BoxGeometry(0.04, 0.14, 0.22), new T.MeshBasicMaterial({ color: 0xfff6c8 })); l.position.set(1.01, 0.55, sz); car.add(l); }
    const ring = new T.Mesh(new T.RingGeometry(1.25, 1.5, 32), new T.MeshBasicMaterial({ color: C.taxi, transparent: true, opacity: 0.5, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.16; g.add(ring); g.userData.ring = ring;
    g.scale.setScalar(0.95);
    return g;
  }

  // ---- 움직이는 것들 (장식) ----
  let walkers = [], cars = [], clouds = [];
  const loop = (cx, cz, hx, hz, y) => ({ cx, cz, hx, hz, y, L: 4 * (hx + hz) }); // 사각형 둘레 길
  function onLoop(l, u) { // u → [x, z, 방향]
    u = ((u % l.L) + l.L) % l.L; const a = 2 * l.hx, b = 2 * l.hz;
    if (u < a) return [l.cx - l.hx + u, l.cz - l.hz, 0];
    u -= a; if (u < b) return [l.cx + l.hx, l.cz - l.hz + u, -Math.PI / 2];
    u -= b; if (u < a) return [l.cx + l.hx - u, l.cz + l.hz, Math.PI];
    u -= a; return [l.cx - l.hx, l.cz + l.hz - u, Math.PI / 2];
  }
  function buildLife(E) {
    life.clear(); walkers = []; cars = []; clouds = [];
    const loops = [];
    for (let r = 0; r < G3; r++) for (let c = 0; c < G3; c++) { const cx = (c + 0.5 - G3 / 2) * SP, cz = (r + 0.5 - G3 / 2) * SP; loops.push(loop(cx, cz, BL / 2 - 0.3, BL / 2 - 0.3, 0.2)); }
    const ring = E / 2 + RW / 2 + 0.45; loops.push(loop(0, 0, ring, ring, 0.1));
    loops.forEach(l => {
      const n = l.hx > E / 2 ? 7 : 2;
      for (let i = 0; i < n; i++) {
        const p = person(); life.add(p);
        walkers.push({ o: p, l, u: rnd() * l.L, v: (0.55 + rnd() * 0.5) * (rnd() < 0.5 ? -1 : 1), ph: rnd() * 6, pause: 0 });
      }
    });
    // 바깥 큰길 + 지나가는 차
    const R2 = E / 2 + RW / 2 + 7.2, w = 2.8;
    const st = new T.Mesh(new T.RingGeometry((R2 - w / 2) * 1.4142, (R2 + w / 2) * 1.4142, 4, 1), mat(0x575b62));
    st.rotation.set(-Math.PI / 2, 0, Math.PI / 4); st.position.y = 0.03; st.receiveShadow = true; life.add(st);
    for (let k = 0; k < 4; k++) for (let t = -R2 + 1; t < R2 - 1; t += 1.6) {
      const d = box(0.7, 0.02, 0.1, 0xf0f0f0); d.castShadow = false;
      const s = [[t, -R2, 0], [R2, t, 1], [-t, R2, 0], [-R2, -t, 1]][k]; d.position.set(s[0], 0.05, s[1]); if (s[2]) d.rotation.y = Math.PI / 2; life.add(d);
    }
    const lr = loop(0, 0, R2 + 0.65, R2 + 0.65, 0.03), lr2 = loop(0, 0, R2 - 0.65, R2 - 0.65, 0.03);
    for (let i = 0; i < 4; i++) { const c = carModel(C.car[i % C.car.length], 0.9); life.add(c); cars.push({ o: c, l: i % 2 ? lr2 : lr, u: rnd() * lr.L, v: (i % 2 ? -1 : 1) * (2.6 + rnd()) }); }
    // 구름
    for (let i = 0; i < 5; i++) {
      const g = new T.Group();
      for (let j = 0; j < 4; j++) { const b = new T.Mesh(new T.IcosahedronGeometry(1.2 + rnd() * 1.2, 0), mat(0xffffff, { flatShading: true })); b.position.set(j * 1.6 - 2.4, rnd() * 0.6, rnd() * 1.2); g.add(b); }
      g.position.set((rnd() - 0.5) * 120, 17 + rnd() * 5, (rnd() - 0.5) * 90); life.add(g); clouds.push({ o: g, v: 0.6 + rnd() * 0.6 });
    }
    // 가로등 (바깥 인도)
    for (let k = -1; k <= 1; k += 2) for (let t = -E / 2 + SP / 2; t < E / 2; t += SP) { life.add(lamp(t, k * (ring + 0.55))); life.add(lamp(k * (ring + 0.55), t)); }
  }

  // ---- 마을 만들기 (G 바뀔 때) ----
  let robot, robotT = null, robotYaw = 0, robotYawT = 0, pinObjs = {}, nodeObjs = {}, hitObjs = [], ghost;
  function build() {
    G3 = G; seed = 7; sway.length = 0;
    world.clear(); pins.clear(); hits.clear(); dyn.clear(); nodes.clear(); pinObjs = {}; nodeObjs = {}; hitObjs = [];
    const E = G3 * SP;

    const ground = new T.Mesh(new T.PlaneGeometry(400, 400), mat(C.grass)); ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; world.add(ground);
    const ow = E + RW + 1.6;
    const walk = box(ow, 0.1, ow, C.walk); walk.position.y = 0.05; walk.castShadow = false; world.add(walk);

    // 도로 + 노란 차선 + 흰 점선
    for (const [a, b] of segs()) {
      const A = wp(a), B = wp(b), mid = A.clone().add(B).multiplyScalar(0.5), hz = Math.abs(A.z - B.z) < 0.01;
      const r = box(hz ? SP : RW, 0.12, hz ? RW : SP, C.road); r.position.set(mid.x, 0.06, mid.z); r.castShadow = false; world.add(r);
      for (const s of [-1, 1]) {
        const ln = box(hz ? SP - RW : 0.16, 0.125, hz ? 0.16 : SP - RW, C.lane); ln.castShadow = false;
        ln.position.set(mid.x + (hz ? 0 : s * (RW / 2 - 0.16)), 0.065, mid.z + (hz ? s * (RW / 2 - 0.16) : 0)); world.add(ln);
      }
      for (let t = -SP / 2 + RW / 2 + 0.6; t < SP / 2 - RW / 2 - 0.4; t += 1.3) {
        const d = box(hz ? 0.6 : 0.08, 0.125, hz ? 0.08 : 0.6, 0xe9e9e9); d.castShadow = false;
        d.position.set(mid.x + (hz ? t + 0.3 : 0), 0.065, mid.z + (hz ? 0 : t + 0.3)); world.add(d);
      }
      const h = new T.Mesh(new T.BoxGeometry(hz ? SP - RW : RW, 0.3, hz ? RW : SP - RW), new T.MeshBasicMaterial({ color: C.lane, transparent: true, opacity: 0.3, depthWrite: false }));
      h.position.set(mid.x, 0.2, mid.z); h.userData = { a, b }; h.visible = false; hits.add(h); hitObjs.push(h);
    }
    // 노드: 교차로 + 빨간 + 마커 + 고르기 표시
    for (const n in pos) {
      const P = wp(+n);
      const x = box(RW, 0.12, RW, C.road); x.position.set(P.x, 0.06, P.z); x.castShadow = false; world.add(x);
      for (const [w, d] of [[1.7, 0.4], [0.4, 1.7]]) { const m = box(w, 0.13, d, C.mark); m.castShadow = false; m.position.set(P.x, 0.066, P.z); world.add(m); }
      const g = new T.Group(); g.position.set(P.x, 0, P.z); g.userData.n = +n;
      const ring = new T.Mesh(new T.RingGeometry(1.25, 1.6, 32), new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2; ring.position.y = 0.2; g.add(ring);
      const lb = new T.Sprite(new T.SpriteMaterial({ map: badgeTex(n + '번', '#ffffff', '#141414', 160, 80, 24, 'bold 44px') })); lb.scale.set(2.0, 1.0, 1); lb.position.y = 1.6; g.add(lb);
      const hit = new T.Mesh(new T.CylinderGeometry(1.8, 1.8, 3, 10), new T.MeshBasicMaterial({ visible: false })); hit.position.y = 1; g.add(hit);
      g.userData.ring = ring; g.visible = false; nodes.add(g); nodeObjs[n] = g;
    }
    // 블록: 인도 + 잔디 + 집·나무
    for (let r = 0; r < G3; r++) for (let c = 0; c < G3; c++) {
      const cx = (c + 0.5 - G3 / 2) * SP, cz = (r + 0.5 - G3 / 2) * SP;
      const sw = box(BL, 0.2, BL, C.walk); sw.position.set(cx, 0.1, cz); sw.castShadow = false; world.add(sw);
      const gr = box(BL - 0.9, 0.24, BL - 0.9, C.grass); gr.position.set(cx, 0.12, cz); gr.castShadow = false; world.add(gr);
      const lot = (BL - 1.6) / 2;
      if (rnd() < 0.25) { const tw = tower(cx, cz, BL - 2.6, BL - 2.6); tw.position.y = 0.24; world.add(tw); continue; }
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        const x = cx + sx * lot / 2, z = cz + sz * lot / 2;
        if (rnd() < 0.72) { const hs = house(x, z, 1.5 + rnd() * 0.6, 1.4 + rnd() * 0.5, sz > 0 ? 0 : Math.PI); hs.position.y = 0.24; world.add(hs); }
        else { const t1 = tree(x - 0.5, z, 0.9); t1.position.y = 0.24; world.add(t1); const t2 = tree(x + 0.6, z + 0.4, 0.7); t2.position.y = 0.24; world.add(t2); }
      }
    }
    // 출발칸 = 택시 승강장
    { const p = boxPos();
      const l = box(RW - 0.5, 0.13, 0.22, C.white); l.castShadow = false; l.position.set(p.x, 0.07, p.z); world.add(l);
      const s = new T.Sprite(new T.SpriteMaterial({ map: badgeTex('택시 승강장', '#ffffff', '#141414', 256, 72, 30, 'bold 38px') }));
      s.scale.set(3.2, 0.9, 1); s.position.set(p.x + RW / 2 + 2.0, 0.9, p.z); world.add(s); }

    // 목적지 정류장 + 핀 (바깥 노드)
    const taken = [];
    for (let n = 1; n <= 4 * G3; n++) {
      const P = wp(n), d = outDir(n), q = P.clone().add(d.clone().multiplyScalar(RW / 2 + 2.4));
      taken.push(q);
      const pad = new T.Mesh(new T.CylinderGeometry(1.4, 1.4, 0.16, 28), mat(0xf3eee2)); pad.position.set(q.x, 0.08, q.z); pad.receiveShadow = true; world.add(pad);
      const ring = new T.Mesh(new T.TorusGeometry(1.2, 0.08, 6, 28), mat(0x3a404b)); ring.rotation.x = Math.PI / 2; ring.position.set(q.x, 0.17, q.z); world.add(ring);
      const g = new T.Group(); g.position.copy(q); g.userData.n = n;
      const pole = new T.Mesh(new T.CylinderGeometry(0.06, 0.06, 2.2, 6), mat(0x2b2f36)); pole.position.y = 1.2; g.add(pole);
      const tip = new T.Mesh(new T.ConeGeometry(0.3, 0.5, 12), new T.MeshBasicMaterial({ color: 0x3fa9ff })); tip.rotation.x = Math.PI; tip.position.y = 2.45; g.add(tip);
      const sp = new T.Sprite(new T.SpriteMaterial({ map: badgeTex(String(n), '#1d2026', '#f2f3f5'), transparent: true })); sp.scale.set(2.4, 2.4, 1); sp.position.y = 3.8; g.add(sp);
      const hit = new T.Mesh(new T.CylinderGeometry(1.5, 1.5, 5, 10), new T.MeshBasicMaterial({ visible: false })); hit.position.y = 2.2; g.add(hit);
      g.userData.sp = sp; g.userData.tip = tip; g.userData.state = '?'; pins.add(g); pinObjs[n] = g;
    }
    // 바깥 마을 (큰길·정류장 피해서)
    const lim = E / 2 + RW / 2 + 1.2, R2 = E / 2 + RW / 2 + 7.2;
    for (let i = 0; i < 110; i++) {
      const x = (rnd() - 0.5) * (E + 44), z = (rnd() - 0.5) * (E + 44), m = Math.max(Math.abs(x), Math.abs(z));
      if (m < lim + 0.8 || Math.abs(m - R2) < 2.6) continue;
      if (taken.some(q => Math.hypot(q.x - x, q.z - z) < 3.4)) continue;
      if (rnd() < 0.65) world.add(tree(x, z, 0.8 + rnd() * 0.5));
      else world.add(house(x, z, 1.6 + rnd() * 0.6, 1.5 + rnd() * 0.4, Math.floor(rnd() * 4) * Math.PI / 2));
    }
    buildLife(E);
    if (robot) scene.remove(robot);
    robot = taxi(); scene.add(robot); robotT = null;
    if (ghost) scene.remove(ghost);
    ghost = taxi();
    ghost.traverse(o => { if (o.material && !Array.isArray(o.material)) { o.material = o.material.clone(); o.material.transparent = true; o.material.opacity = 0.45; } o.castShadow = false; });
    ghost.visible = false; scene.add(ghost);
    const sc = sun.shadow.camera; const ext = E / 2 + 14; sc.left = -ext; sc.right = ext; sc.top = ext; sc.bottom = -ext; sc.near = 1; sc.far = 120; sc.updateProjectionMatrix();
    fit(); key = '';
  }

  // ---- 카메라 ----
  const HOME = { yaw: -0.42, pitch: 0.98, zoom: 1 };
  let yaw = HOME.yaw, pitch = HOME.pitch, zoom = HOME.zoom, title = false;
  M3.padTop = 0; M3.padBottom = 0; // 위·아래를 덮는 화면 높이 (px) → 지도 가운데를 보이는 칸 가운데로
  function fit() {
    const w = host.clientWidth || 400, h = host.clientHeight || w;
    renderer.setSize(w, h, false); cam.aspect = w / h;
    const vis = Math.max(160, h - M3.padTop - M3.padBottom), shift = (M3.padTop - M3.padBottom) / 2;
    cam.setViewOffset(w, h, 0, -shift, w, h); cam.updateProjectionMatrix();
    const E = (G3 * SP / 2 + 6.5) * 2.35, k = title ? 0.8 : 1.0; // 바깥 정류장 핀까지 (돌려 봐도 들어오게)
    const dist = E / (2 * Math.tan(cam.fov * Math.PI / 360)) * k * (h / vis) / Math.min(1, cam.aspect * h / vis) * zoom;
    cam.position.set(Math.sin(yaw) * Math.cos(pitch) * dist, Math.sin(pitch) * dist, Math.cos(yaw) * Math.cos(pitch) * dist);
    cam.lookAt(0, 0, 0.6);
    scene.fog.near = dist * 1.05; scene.fog.far = dist * 2.4; // 멀어져도 지도는 안 흐리게
  }
  window.addEventListener('resize', fit);
  new ResizeObserver(fit).observe(host);

  // 끌어서 돌리기, 휠·두 손가락 확대, 짧게 누르면 선택, 두 번 누르면 처음 시점
  const ptrs = new Map(); let moved = 0, pinch0 = 0, zoom0 = 1;
  const cv = renderer.domElement; cv.style.touchAction = 'none';
  cv.addEventListener('pointerdown', e => { cv.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY }); moved = 0;
    if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch0 = Math.hypot(a.x - b.x, a.y - b.y); zoom0 = zoom; } });
  cv.addEventListener('pointermove', e => { const p = ptrs.get(e.pointerId); if (!p || title) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY; moved += Math.abs(dx) + Math.abs(dy);
    if (ptrs.size === 1 && moved > 6) { yaw -= dx * 0.008; pitch = Math.min(1.35, Math.max(0.55, pitch + dy * 0.006)); fit(); }
    else if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y); if (pinch0) { zoom = Math.min(1.6, Math.max(0.5, zoom0 * pinch0 / d)); fit(); } } });
  const up = e => { const was = ptrs.size; ptrs.delete(e.pointerId); if (was === 1 && moved <= 6 && !title) tap(e); if (ptrs.size < 2) pinch0 = 0; };
  cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', e => ptrs.delete(e.pointerId));
  cv.addEventListener('wheel', e => { if (title) return; e.preventDefault(); zoom = Math.min(1.6, Math.max(0.5, zoom * (e.deltaY > 0 ? 1.08 : 0.93))); fit(); }, { passive: false });
  cv.addEventListener('dblclick', () => { if (title) return; yaw = HOME.yaw; pitch = HOME.pitch; zoom = HOME.zoom; fit(); });

  const ray = new T.Raycaster(), v2 = new T.Vector2();
  const owner = o => { while (o && !o.userData.n) o = o.parent; return o; };
  function tap(e) {
    const r = cv.getBoundingClientRect(); v2.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(v2, cam);
    if (edit) { const h = ray.intersectObjects(hitObjs, false)[0]; if (h) toggleRoad(h.object.userData.a, h.object.userData.b); return; }
    if (pickMode === 'start') { const h = ray.intersectObjects(nodes.children, true)[0]; const o = h && owner(h.object); if (o && window.onMapNode) onMapNode(o.userData.n); return; }
    const h = ray.intersectObjects(pins.children, true)[0]; const o = h && owner(h.object);
    if (o && window.onMapPin) onMapPin(o.userData.n);
  }

  // ---- 상태 반영 ----
  let key = '';
  function routeMesh(pts) {
    const g = new T.Group(), m = new T.MeshBasicMaterial({ color: C.route, transparent: true, opacity: 0.9, depthWrite: false });
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i], b = pts[i + 1], L = a.distanceTo(b); if (L < 0.01) continue;
      const s = new T.Mesh(new T.BoxGeometry(L, 0.04, 0.55), m); s.position.copy(a).add(b).multiplyScalar(0.5); s.position.y = 0.2;
      s.rotation.y = -Math.atan2(b.z - a.z, b.x - a.x); g.add(s);
      const j = new T.Mesh(new T.CylinderGeometry(0.275, 0.275, 0.04, 16), m); j.position.set(b.x, 0.2, b.z); g.add(j);
    }
    g.userData.pts = pts; return g;
  }
  // 장애물 종류: work 공사, cone 라바콘, person 보행자, car 주미(차), cam 카메라가 본 장애물
  function barrier(A, B, type) {
    const g = new T.Group(), mid = A.clone().add(B).multiplyScalar(0.5), hz = Math.abs(A.z - B.z) < 0.01;
    g.position.copy(mid); g.rotation.y = hz ? Math.PI / 2 : 0;
    if (type === 'cone') { // 라바콘 줄
      for (const x of [-1.0, 0, 1.0]) g.add(cone(x, 0));
    } else if (type === 'person') { // 길 건너는 사람 + 횡단보도
      for (let x = -RW / 2 + 0.45; x < RW / 2 - 0.3; x += 0.6) { const z = box(0.32, 0.13, 1.5, 0xf2f2f2); z.castShadow = false; z.position.set(x, 0.066, 0); g.add(z); }
      const p1 = person(); p1.position.set(-0.4, 0.13, 0.2); p1.rotation.y = 0; g.add(p1); p1.userData.walk = 1;
      const p2 = person(); p2.position.set(0.7, 0.13, -0.3); p2.rotation.y = Math.PI; g.add(p2); p2.userData.walk = -1;
    } else if (type === 'car') { // 서 있는 다른 차 (주미)
      const c = carModel(0x3f7fd1, 0.95); c.rotation.y = Math.PI / 2; c.position.set(0.5, 0.12, 0); g.add(c);
      const l = new T.Mesh(new T.SphereGeometry(0.13, 8, 6), new T.MeshBasicMaterial({ color: 0xffa000 })); l.position.set(0.5, 1.25, 0); g.add(l); g.userData.blink = l;
    } else if (type !== 'cam') { // 도로 공사: 줄무늬 바리케이드 + 콘
      for (const s of [-1, 1]) { const p = box(0.14, 1.3, 0.14, 0x444444); p.position.set(s * (RW / 2 - 0.35), 0.75, 0); g.add(p); }
      for (const y of [0.75, 1.25]) { const b = new T.Mesh(new T.BoxGeometry(RW - 0.4, 0.38, 0.1), [mat(C.white), mat(C.white), mat(C.white), mat(C.white), new T.MeshLambertMaterial({ map: STRIPE }), new T.MeshLambertMaterial({ map: STRIPE })]); b.position.y = y; b.castShadow = true; g.add(b); }
      g.add(cone(-0.9, 1.1)); g.add(cone(0.9, -1.1));
    } else { // 카메라가 본 장애물: 콘 + 빨간 경고등
      g.add(cone(-0.7, 0.3)); g.add(cone(0.1, -0.2)); g.add(cone(0.8, 0.4));
      const l = new T.Mesh(new T.SphereGeometry(0.2, 12, 8), new T.MeshBasicMaterial({ color: 0xff3b30 })); l.position.set(0.1, 1.05, -0.2); g.add(l); g.userData.blink = l;
    }
    return g;
  }
  function robotPos() {
    if (!st || !pos[st.next]) return null;
    const B = wp(st.next);
    if (!st.prev || st.status === 2) return B;
    return wp(st.prev).lerp(B, st.prog / 100);
  }
  const YAW = [Math.PI / 2, 0, -Math.PI / 2, Math.PI]; // N E S W
  const HD = { N: 0, E: 1, S: 2, W: 3 };
  const doneRide = () => st && st.status === 2 && st.route.length <= 1;
  function update() {
    if (G !== G3) build();
    const dr = (typeof draft !== 'undefined' ? draft : {});
    // 목적지 핀: 호출 고르는 중이면 고른 곳, 아니면 지금 가는 곳
    for (const n in pinObjs) {
      const g = pinObjs[n], sel = (pend === +n) || (pickMode ? dr.dest === +n : (st && st.dest === +n && !doneRide()));
      const s = sel ? 'sel' : '', dim = edit || pickMode === 'start' || (st && st.run && !sel);
      if (g.userData.state !== s) { g.userData.state = s;
        g.userData.sp.material.map = s ? badgeTex(n, '#FFD400', '#141414') : badgeTex(n, '#1d2026', '#f2f3f5'); g.userData.sp.material.needsUpdate = true;
        g.userData.tip.material.color.set(s ? 0xFFD400 : 0x3fa9ff); }
      g.userData.sp.material.opacity = dim ? 0.35 : 1;
    }
    for (const n in nodeObjs) { const g = nodeObjs[n]; g.visible = pickMode === 'start'; g.userData.ring.material.color.set(dr.start === +n ? 0xFFD400 : 0xffffff); }
    hitObjs.forEach(h => h.visible = !!edit);
    // 택시: 경로 주행 중이면 그 자리, 아니면 승강장
    const rp = robotPos(), has = !!(st && st.dest && rp);
    const p = has ? rp : boxPos();
    if (!robotT) robot.position.copy(p);
    robotT = p; robotYawT = has ? (YAW[st.hd] || 0) : YAW[0];
    // 호출 고르는 중: 고른 출발 위치에 반투명 택시
    let gp = null, gy = 0;
    if (pickMode && dr.start === 0 && has) { gp = boxPos(); gy = YAW[0]; }
    else if (pickMode && typeof dr.start === 'number' && dr.start > 0 && pos[dr.start]) { gp = wp(dr.start); gy = YAW[HD[dr.head] || 0]; }
    ghost.visible = !!gp; if (gp) { ghost.position.copy(gp); ghost.rotation.y = gy; }
    // 경로·막힘
    const types = (typeof obsTypes !== 'undefined' ? obsTypes : {});
    const k = JSON.stringify([st && st.route, st && st.blk, st && st.ublk, st && st.status, has && st.dest, types]);
    if (k !== key) {
      key = k; dyn.clear();
      if (has && st.route.length && st.status !== 3 && !doneRide()) { const r = routeMesh([rp.clone()].concat(st.route.map(wp))); r.userData.route = true; dyn.add(r); }
      const uk = new Set((st && st.ublk || []).map(([a, b]) => a + '-' + b));
      (st && st.blk || []).forEach(([a, b]) => { const kk = a + '-' + b, nk = Math.min(a, b) + '-' + Math.max(a, b), ty = uk.has(kk) ? (types[nk] || 'work') : 'cam'; const o = barrier(wp(a), wp(b), ty); o.userData.obs = { a, b, ty }; dyn.add(o); });
    } else if (has) {
      const r = dyn.children.find(o => o.userData.route);
      if (r) { dyn.remove(r); const nr = routeMesh([rp.clone()].concat(st.route.map(wp))); nr.userData.route = true; dyn.add(nr); }
    }
    makeAnchors(has, rp);
  }

  // ---- 말풍선 (HTML 글자를 3D 위치 위에 띄움) ----
  const layer = document.getElementById('bubbles');
  const OBS_NAME = { work: '도로 공사 중', cone: '라바콘', person: '보행자', car: '멈춘 차', cam: '장애물 발견' };
  const bub = {}; let anchors = [];
  function taxiText(has) {
    if (!st) return '대기 중';
    if (st.run) return ((typeof nowText !== 'undefined' && nowText) || '운행 중');
    if (doneRide()) return '도착했어요';
    if (st.status === 3) return '갈 길이 없어요';
    if (st.status === 4) return '위치를 잃었어요';
    if (has) return '출발 준비';
    return '대기 중';
  }
  function makeAnchors(has, rp) {
    const L = [], dr = (typeof draft !== 'undefined' ? draft : {});
    // 출발: 호출 고르는 중이면 고른 자리, 운행 중이면 탔던 자리 (택시와 같은 자리면 택시 말풍선에 붙임)
    let sp = null, sTxt = '';
    if (pickMode) {
      if (dr.start === 0) { sp = boxPos(); sTxt = '택시 승강장'; }
      else if (typeof dr.start === 'number' && dr.start > 0 && pos[dr.start]) { sp = wp(dr.start); sTxt = dr.start + '번'; }
      else if (dr.start === 'A') { sp = robot.position.clone(); sTxt = '현재 위치'; }
    } else if (has && !doneRide() && (typeof rideStart !== 'undefined' && rideStart)) {
      const r = (typeof rideStart !== 'undefined' && rideStart); sp = r.n ? wp(r.n) : boxPos(); sTxt = r.n ? r.n + '번' : '택시 승강장';
    }
    const near = sp && sp.distanceTo(robotT || robot.position) < 3.5; // 택시와 가까우면 출발 말풍선은 안 띄움 (겹침)
    L.push({ k: 'taxi', obj: robot, h: 2.4, t: '주미 택시', s: near && pickMode ? '여기서 출발' : taxiText(has), c: 'taxi' });
    if (sp && !near) L.push({ k: 'start', p: sp, h: 1.3, t: '출발', s: sTxt, c: 'start' });
    // 목적지
    const dn = pickMode ? dr.dest : (st && st.dest && !doneRide() ? st.dest : 0);
    if (dn && pinObjs[dn]) L.push({ k: 'dest', p: pinObjs[dn].position, h: 5.5, t: '목적지', s: dn + '번 정류장', c: 'dest' });
    // 장애물
    dyn.children.forEach(o => { const ob = o.userData.obs; if (ob) L.push({ k: 'o' + ob.a + '-' + ob.b, p: o.position, h: 2.3, t: OBS_NAME[ob.ty] || '장애물', c: ob.ty === 'cam' ? 'cam' : 'obs' }); });
    anchors = L;
  }
  const pv = new T.Vector3();
  function drawBubbles() {
    if (!layer) return;
    const seen = {}, w = host.clientWidth, h = host.clientHeight;
    if (!title) anchors.forEach(a => {
      pv.copy(a.obj ? a.obj.position : a.p); pv.y += a.h; pv.project(cam);
      if (pv.z > 1 || Math.abs(pv.x) > 1.2 || Math.abs(pv.y) > 1.2) return;
      let e = bub[a.k]; if (!e) { e = bub[a.k] = document.createElement('div'); layer.appendChild(e); }
      const html = '<b>' + a.t + '</b>' + (a.s ? '<small>' + a.s + '</small>' : '');
      if (e._h !== html) { e.innerHTML = html; e._h = html; }
      if (e._c !== a.c) { e.className = 'bub ' + a.c; e._c = a.c; }
      const half = (e.offsetWidth || 80) / 2 + 6, sx = Math.min(w - half, Math.max(half, (pv.x * 0.5 + 0.5) * w)); // 화면 밖으로 안 나가게
      e.style.transform = 'translate(' + sx.toFixed(1) + 'px,' + ((-pv.y * 0.5 + 0.5) * h).toFixed(1) + 'px) translate(-50%,-100%)';
      seen[a.k] = 1;
    });
    for (const k in bub) if (!seen[k]) { bub[k].remove(); delete bub[k]; }
  }

  // ---- 그리기 ----
  const clock = new T.Clock(); let last = 0; const dots = [];
  for (let i = 0; i < 6; i++) { const d = new T.Mesh(new T.SphereGeometry(0.2, 10, 8), new T.MeshBasicMaterial({ color: 0xe8f6ff })); d.visible = false; scene.add(d); dots.push(d); }
  function frame() {
    requestAnimationFrame(frame);
    if (!host.offsetParent) return; // 안 보이면 쉼
    const t = clock.getElapsedTime(), dt = Math.min(0.05, t - last); last = t;
    if (title) { yaw += dt * 0.07; fit(); }
    if (robot && robotT) {
      robot.position.lerp(robotT, 0.12);
      let d = robotYawT - robotYaw; d = Math.atan2(Math.sin(d), Math.cos(d)); robotYaw += d * 0.15; robot.rotation.y = robotYaw;
      const r = robot.userData.ring, s = 1 + 0.12 * Math.sin(t * 4); r.scale.set(s, s, s); r.material.opacity = 0.35 + 0.2 * Math.sin(t * 4);
    }
    walkers.forEach(w => { // 사람: 인도 둘레를 걷다가 가끔 멈춤
      if (w.pause > 0) w.pause -= dt; else { w.u += w.v * dt; if (Math.random() < dt * 0.06) w.pause = 1 + Math.random() * 2.5; }
      const [x, z, a] = onLoop(w.l, w.u); w.o.position.set(x, w.l.y + (w.pause > 0 ? 0 : Math.abs(Math.sin(t * 9 + w.ph)) * 0.06), z);
      w.o.rotation.y = a + (w.v < 0 ? Math.PI : 0);
    });
    cars.forEach(c => { c.u += c.v * dt; const [x, z, a] = onLoop(c.l, c.u); c.o.position.set(x, c.l.y, z); c.o.rotation.y = a + (c.v < 0 ? Math.PI : 0); });
    clouds.forEach(c => { c.o.position.x += c.v * dt; if (c.o.position.x > 70) c.o.position.x = -70; });
    sway.forEach(g => { g.rotation.z = Math.sin(t * 1.3 + g.userData.ph) * 0.025; });
    const rt = dyn.children.find(o => o.userData.route), pts = rt && rt.userData.pts; // 경로 위 움직이는 점
    let total = 0; const L = [];
    if (pts) for (let j = 0; j + 1 < pts.length; j++) { const l = pts[j].distanceTo(pts[j + 1]); L.push(l); total += l; }
    dots.forEach((d, i) => {
      if (!pts || total < 0.1) { d.visible = false; return; }
      let u = ((t * 3.2 + i * total / dots.length) % total), j = 0; while (j < L.length - 1 && u > L[j]) { u -= L[j]; j++; }
      d.position.copy(pts[j]).lerp(pts[j + 1], L[j] ? u / L[j] : 0); d.position.y = 0.3; d.visible = true;
    });
    dyn.children.forEach(o => {
      if (o.userData.blink) o.userData.blink.visible = (t * 2 % 1) < 0.6;
      o.children.forEach(c => { if (c.userData.walk) c.position.x = c.userData.walk * (Math.sin(t * 0.7) * 0.9); });
    });
    drawBubbles();
    for (const n in pinObjs) { const g = pinObjs[n]; g.userData.sp.position.y = 3.8 + (g.userData.state ? 0.25 * Math.sin(t * 5) : 0); }
    for (const n in nodeObjs) { const g = nodeObjs[n]; if (g.visible) g.userData.ring.scale.setScalar(1 + 0.08 * Math.sin(t * 5)); }
    if (ghost && ghost.visible) ghost.position.y = 0.05 * Math.sin(t * 4);
    renderer.render(scene, cam);
  }

  M3.ok = true;
  M3.update = () => { try { update(); } catch (e) { console.error(e); } };
  M3.fit = fit;
  M3.setTitle = v => { title = !!v; if (title) { pitch = 0.78; zoom = 0.9; } else { yaw = HOME.yaw; pitch = HOME.pitch; zoom = HOME.zoom; } fit(); };
  M3.home = () => { yaw = HOME.yaw; pitch = HOME.pitch; zoom = HOME.zoom; fit(); };
  build(); frame();
})();
