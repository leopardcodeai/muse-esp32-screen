// remotelog.js: the page's own log lines go to Home Assistant's logbook as well as the
// console, so a wall panel can be read from anywhere (owner, 19.11.2026: "muse web screen
// braucht auch logs").
//
// Each line becomes one logbook entry (logbook.log, domain muse_web, kept 10 days) under
// the panel's name. At most LIMIT_PER_MINUTE lines leave per minute, so a loop cannot
// flood the recorder; the number left out is reported with the next line that gets
// through. While HA is unreachable the lines wait (at most MAX_QUEUE). No DOM here, so
// the Node tests can drive it with a fake clock and a fake send.

export const LIMIT_PER_MINUTE = 40;
export const MAX_QUEUE = 200;

export class RemoteLog {
  constructor(opts = {}) {
    this.send = opts.send || (async () => {}); // (name, message) => Promise
    this.now = opts.now || (() => Date.now());
    this.name = opts.name || "Muse Web";
    this.queue = [];
    this.minuteStart = 0;
    this.sentThisMinute = 0;
    this.dropped = 0;
    this.busy = false;
  }

  line(text) {
    const now = this.now();
    if (now - this.minuteStart > 60000) {
      this.minuteStart = now;
      this.sentThisMinute = 0;
    }
    if (this.sentThisMinute >= LIMIT_PER_MINUTE) {
      this.dropped++;
      return false;
    }
    this.sentThisMinute++;
    const prefix = this.dropped > 0 ? `(${this.dropped} Zeilen ausgelassen) ` : "";
    this.dropped = 0;
    this.queue.push((prefix + String(text)).slice(0, 250));
    if (this.queue.length > MAX_QUEUE) this.queue.splice(0, this.queue.length - MAX_QUEUE);
    return true;
  }

  // Sends what waits, oldest first; stops at the first failure and keeps the rest.
  async flush(connected) {
    if (!connected || this.busy || this.queue.length === 0) return 0;
    this.busy = true;
    let sent = 0;
    try {
      while (this.queue.length) {
        await this.send(this.name, this.queue[0]);
        this.queue.shift();
        sent++;
      }
    } catch {
      // HA went away mid-flush: the rest goes out next time.
    } finally {
      this.busy = false;
    }
    return sent;
  }
}
