const RagSpider = (() => {
  const S = 2.6;
  const REACH = 42 * S;
  const STEP_TIME = 0.16;
  const LIFT = 7 * S;
  const LEGS = [
    {side: -1, angle: -0.55, len: 1.2, hip: 7}, {side: -1, angle: -1.2, len: 1.0, hip: 3},
    {side: -1, angle: -1.95, len: 0.95, hip: -1}, {side: -1, angle: -2.55, len: 1.15, hip: -5},
    {side: 1, angle: 0.55, len: 1.2, hip: 7}, {side: 1, angle: 1.2, len: 1.0, hip: 3},
    {side: 1, angle: 1.95, len: 0.95, hip: -1}, {side: 1, angle: 2.55, len: 1.15, hip: -5},
  ];
  const GROUP = [0, 1, 0, 1, 1, 0, 1, 0];
  const NEON = '#38e1ff', PINK = '#ff2bd6', SHELL = '#11141a';

  const smooth = t => t * t * (3 - 2 * t);

  class Spider {
    constructor(x, y) {
      Object.assign(this, {x, y, heading: -Math.PI / 2, vx: 0, vy: 0, phase: 0});
      this.legs = LEGS.map((_, i) => ({...this.rest(i), t: 1, fx: 0, fy: 0}));
    }

    get radius() { return 18 * S; }

    rest(i) {
      const leg = LEGS[i], a = this.heading + leg.angle, r = REACH * leg.len;
      return {x: this.x + Math.cos(a) * r + this.vx * 0.14, y: this.y + Math.sin(a) * r + this.vy * 0.14};
    }

    hip(i) {
      const leg = LEGS[i], c = Math.cos(this.heading), s = Math.sin(this.heading);
      const along = leg.hip * S * 0.55, across = leg.side * 5 * S;
      return {x: this.x + c * along - s * across, y: this.y + s * along + c * across};
    }

    walk(tx, ty, maxSpeed, dt) {
      const dx = tx - this.x, dy = ty - this.y, dist = Math.hypot(dx, dy);
      const speed = dist < 2 ? 0 : Math.min(maxSpeed, 30 + dist * 3);
      const wantX = dist ? (dx / dist) * speed : 0, wantY = dist ? (dy / dist) * speed : 0;
      const blend = Math.min(1, dt * 5);
      this.vx += (wantX - this.vx) * blend;
      this.vy += (wantY - this.vy) * blend;
      this.x += this.vx * dt;
      this.y += this.vy * dt;
      const moving = Math.hypot(this.vx, this.vy);
      if (moving > 15) {
        let turn = Math.atan2(this.vy, this.vx) - this.heading;
        turn = Math.atan2(Math.sin(turn), Math.cos(turn));
        this.heading += turn * Math.min(1, dt * 4);
      }
      this.phase += dt * (2 + moving / 40);
      return dist;
    }

    step(dt, onLand) {
      const stepping = [0, 1].map(g => this.legs.some((leg, i) => GROUP[i] === g && leg.t < 1));
      this.legs.forEach((leg, i) => {
        const target = this.rest(i);
        if (leg.t < 1) {
          leg.t = Math.min(1, leg.t + dt / STEP_TIME);
          const k = smooth(leg.t);
          leg.x = leg.fx + (target.x - leg.fx) * k;
          leg.y = leg.fy + (target.y - leg.fy) * k;
          leg.lift = Math.sin(Math.PI * leg.t);
          if (leg.t === 1) { leg.lift = 0; onLand(leg.x, leg.y); }
          return;
        }
        const gap = Math.hypot(target.x - leg.x, target.y - leg.y);
        if (gap > REACH * 1.6) { Object.assign(leg, target); return; }
        if (gap > REACH * 0.32 && !stepping[1 - GROUP[i]]) Object.assign(leg, {fx: leg.x, fy: leg.y, t: 0});
      });
    }

    drawLeg(ctx, i, ox, oy) {
      const leg = LEGS[i], hip = this.hip(i), lift = this.legs[i].lift || 0;
      const outward = this.heading + leg.angle;
      const fx = this.legs[i].x + Math.cos(outward) * lift * LIFT - ox, fy = this.legs[i].y + Math.sin(outward) * lift * LIFT - oy;
      const hx = hip.x - ox, hy = hip.y - oy;
      const femur = REACH * leg.len * 0.55, tibia = REACH * leg.len * 0.62;
      const d = Math.min(Math.hypot(fx - hx, fy - hy), femur + tibia - 1);
      const base = Math.atan2(fy - hy, fx - hx);
      const bend = Math.acos(Math.max(-1, Math.min(1, (femur * femur + d * d - tibia * tibia) / (2 * femur * d))));
      const kx = hx + Math.cos(base - leg.side * bend) * femur, ky = hy + Math.sin(base - leg.side * bend) * femur;
      const ax = kx + (fx - kx) * 0.68 + Math.cos(base) * 2 * S, ay = ky + (fy - ky) * 0.68 + Math.sin(base) * 2 * S;
      const segments = [[hx, hy, kx, ky, 2.4 * S], [kx, ky, ax, ay, 1.7 * S], [ax, ay, fx, fy, 1.1 * S]];
      ctx.lineCap = 'round';
      for (const [x1, y1, x2, y2, w] of segments) {
        ctx.strokeStyle = NEON; ctx.lineWidth = w + 2;
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
        ctx.strokeStyle = SHELL; ctx.lineWidth = w;
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      }
      ctx.fillStyle = NEON;
      ctx.beginPath(); ctx.arc(kx, ky, 1.5 * S, 0, 7); ctx.arc(ax, ay, 1.1 * S, 0, 7); ctx.fill();
      ctx.fillStyle = PINK;
      ctx.beginPath(); ctx.arc(fx, fy, (1.2 + lift) * S, 0, 7); ctx.fill();
    }

    drawPalps(ctx) {
      for (const side of [-1, 1]) {
        const wiggle = Math.sin(this.phase * 2 + side) * 0.25;
        const a = side * (0.35 + wiggle);
        const mx = 13 * S + Math.cos(a) * 5 * S, my = side * 3 * S + Math.sin(a) * 5 * S;
        ctx.strokeStyle = NEON; ctx.lineWidth = 2.2;
        ctx.beginPath(); ctx.moveTo(10 * S, side * 2.5 * S); ctx.lineTo(mx, my); ctx.lineTo(mx + 4 * S, my + side * 1.5 * S); ctx.stroke();
        ctx.fillStyle = PINK;
        ctx.beginPath(); ctx.arc(mx + 4 * S, my + side * 1.5 * S, 1.3 * S, 0, 7); ctx.fill();
      }
    }

    drawBody(ctx, ox, oy) {
      const bob = 1 + Math.sin(this.phase * 2) * 0.03;
      ctx.save();
      ctx.translate(this.x - ox, this.y - oy);
      ctx.rotate(this.heading);
      this.drawPalps(ctx);
      ctx.shadowColor = NEON; ctx.shadowBlur = 12;
      const abdomen = ctx.createRadialGradient(-16 * S, -3 * S, 2 * S, -14 * S, 0, 15 * S);
      abdomen.addColorStop(0, '#2b3240'); abdomen.addColorStop(1, '#06070a');
      ctx.fillStyle = abdomen; ctx.strokeStyle = NEON; ctx.lineWidth = 1.8;
      ctx.beginPath(); ctx.ellipse(-14 * S, 0, 14 * S * bob, 10.5 * S * bob, 0, 0, 7); ctx.fill(); ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = PINK; ctx.lineWidth = 2;
      for (let k = 0; k < 3; k++) {
        const cx = -8 * S - k * 5 * S, w = (4.5 - k) * S;
        ctx.beginPath(); ctx.moveTo(cx - 2 * S, -w); ctx.lineTo(cx, 0); ctx.lineTo(cx - 2 * S, w); ctx.stroke();
      }
      const chest = ctx.createRadialGradient(3 * S, -2 * S, 1 * S, 2 * S, 0, 9 * S);
      chest.addColorStop(0, '#323a4a'); chest.addColorStop(1, '#090b0f');
      ctx.fillStyle = chest; ctx.strokeStyle = NEON; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.ellipse(3 * S, 0, 8.5 * S, 7 * S, 0, 0, 7); ctx.fill(); ctx.stroke();
      ctx.fillStyle = PINK;
      for (const side of [-1, 1]) {
        ctx.beginPath(); ctx.arc(9 * S, side * 1.6 * S, 1.3 * S, 0, 7); ctx.fill();
      }
      ctx.fillStyle = NEON;
      for (const [ex, ey] of [[7.4, -3.4], [7.4, 3.4], [8.2, -0.6], [8.2, 0.6], [6.2, -4.6], [6.2, 4.6]]) {
        ctx.beginPath(); ctx.arc(ex * S, ey * S, 0.55 * S, 0, 7); ctx.fill();
      }
      ctx.restore();
    }

    draw(ctx, ox, oy) {
      for (let i = 0; i < LEGS.length; i++) this.drawLeg(ctx, i, ox, oy);
      this.drawBody(ctx, ox, oy);
    }
  }

  return Spider;
})();
