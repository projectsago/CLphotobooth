# Photobooth+

A retro photobooth that runs entirely in your browser. No sign-up, no server,
no build step, no upload — every photo is captured with `getUserMedia`, drawn
to a `<canvas>`, and stored locally in IndexedDB.

## Files

- `index.html` — page structure
- `style.css` — the whole visual design (curtain backdrop, filmstrip, shutter, etc.)
- `script.js` — camera access, filters, countdown/capture, strip compositing, IndexedDB storage, printing
- `gifenc.js` — a small dependency-free animated GIF encoder (fixed-palette + LZW), used by the GIF burst mode
- `icon.svg` — favicon / app icon (no external image needed)

## Running it

Just double-click `index.html` (or right-click → Open with → your browser).
That's it — no local server, no hosting, no install step. It works fully
offline because it's just static files on your disk with zero network calls.

The first time it loads, your browser will ask for camera permission — allow
it, and the live preview appears. If you accidentally block it, click the
padlock/camera icon in the address bar, allow the camera, then reload the
page.

## Features

- Live camera preview, mirrored like a real photobooth mirror, with the
  viewfinder box automatically matching your camera's real aspect ratio
  (no stretching or hidden cropping between preview and capture)
- Six filters (None, B&W, Sepia, Vintage, Vivid, Cool) applied live and baked
  into the exported photo
- **Countdown timer** — pick 3s, 5s, or 10s; applies to every shot in Single,
  4-up strip, and GIF burst modes
- Three capture modes:
  - **Single shot**
  - **4-up strip** — four photos, one countdown between each
  - **GIF burst** — a short (~1.4s, 12-frame) animated GIF, encoded entirely
    in-browser with no external library
- Four film-strip designs for 4-up strip mode:
  - **Classic** — cream paper, vertical strip, serif caption
  - **Noir** — black 35mm-style strip with sprocket holes down both edges
  - **Polaroid** — 2×2 grid of individually white-bordered instant-photo cards
  - **Custom** — upload your own design (PNG/JPG) and it's used as the strip
    background, with your four photos dropped into fixed slots on top. Click
    **"Download blank template"** first to get a guide PNG sized exactly to
    your camera's strip canvas, with the four photo windows marked — design
    around it in any image editor, then upload the finished file with
    **"Upload my design…"**. Your upload is remembered in this browser for
    next time (via `localStorage`).
- A "reel" of everything you've shot, persisted in IndexedDB — it's still
  there next time you open the file, even offline
- **Print** any shot, strip, or GIF straight from the preview, using your
  browser's normal print dialog (no server involved — it renders into a
  hidden iframe and calls `window.print()`)
- Download any shot as `.jpg` or any GIF as `.gif`
- Camera-switch button when more than one camera is available

## Notes

- Camera permission is required; if it's denied, the booth shows a
  plain-language error instead of a blank screen.
- Nothing is ever sent over the network — there are no `fetch`/`XHR` calls to
  any server in `script.js`.
- If you ever do host this on a real server later, it'll still work exactly
  the same way — no code changes needed.
