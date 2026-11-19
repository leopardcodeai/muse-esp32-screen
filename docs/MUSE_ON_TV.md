# Muse on your TV

Status 18 November 2026.

## What Meta showed

The official Muse Gadgets page lists **Muse on your TV** as a project idea: "A stick
that plugs into your TV's HDMI port so you can ask Muse to put things up on the big
screen." It is marked **Coming soon**. Unlike the other cards it has no Buy or Source
link, no price, no release date, no SoC or operating system, no BOM and no firmware.
The picture is a wireframe.

The open-source [`muse-gadget-sdk`](https://github.com/facebookincubator/muse-gadget-sdk)
contains no TV or HDMI device. Its ESP32 tree has no HDMI board, and its
[`skills/`](https://github.com/facebookincubator/muse-gadget-sdk/tree/main/skills) tree
has TV-control skills (Google Cast, Google TV Streamer, Apple TV 4K, Roku, Samsung
Tizen, LG webOS, Sony Bravia, Insignia Fire TV) but no TV-stick firmware. **Muse Home
Link** is a different device: a USB dongle that puts Muse on the home Wi-Fi; it has no
HDMI.

So the stick is announced as a concept, not buildable from the current SDK.

## What you can build today

| Goal | Hardware | What works | Limits |
|---|---|---|---|
| Muse on a TV with the Muse UI | Raspberry Pi 5 or 4, Raspberry Pi OS, Linux Device SDK, Chromium kiosk showing the Muse Web Screen | Muse gets the Linux gadget (commands, files, voice) and the TV shows the web twin | Not a stick; needs micro-HDMI and power; the web screen is 480 x 480 square, not 16:9 |
| The same in stick form | Raspberry Pi Zero 2 W with mini-HDMI | Linux SDK and voice; a browser kiosk is possible | 512 MB RAM and a weak CPU; not for a smooth web UI |
| The best stick form | x86 fanless TV stick or mini PC (for example MeLE PCG02, Intel N100) with Ubuntu or Debian | Linux SDK plus Chromium kiosk; much faster than a Pi Zero | Not officially tested; check Bluetooth LE |
| Muse controls the TV | Google TV Streamer or Chromecast with Google TV, Roku Streaming Stick, Apple TV 4K | Muse controls playback and apps through the TV skills | Requires Muse Home Link (United States, subscription, limited); no Muse UI on the TV |
| The cheapest today | Any Chromecast or Google TV device plus Chrome tab cast | Cast the Muse Web Screen tab from a Mac or PC to the TV | The computer must stay on; the square layout sits in the middle of the screen |
| A Samsung Galaxy Tab A11+ | Android 16 tablet, 11 inch, 6 or 8 GB RAM | Muse Web Screen in Chrome, Home Assistant dashboard, Smart View to a TV | No HDMI output, no Linux SDK, native Muse app not offered in Germany |

The [Linux Device SDK](https://github.com/facebookincubator/muse-gadget-sdk/blob/main/linux/README.md)
requires a Raspberry Pi 3B+, 4, 5 or Zero 2 W, or another Linux computer with Bluetooth
LE, Raspberry Pi OS Bullseye or later, Debian 11 or later, Ubuntu 22.04 or later,
Python 3.9 or later, and an SDK token. It gives Muse `system.run`, `file.read`,
`file.write`, `device.health` and realtime voice. It does not draw a TV UI. The
graphical part is this project's web app (`web/`, or the Home Assistant add-on), run in
a kiosk browser.

The TV-control skills live in the SDK's
[`skills/`](https://github.com/facebookincubator/muse-gadget-sdk/tree/main/skills) tree
and run through Muse Home Link. Home Link is a USB dongle included with an active Muse
subscription in the United States only, limit one per subscriber (18 November 2026).
Without it those skills do not reach the TV.

## A Samsung Galaxy Tab A11+ as the screen

The Galaxy Tab A11+ (SM-X230, Android 16, 11 inch 1920 x 1200, MediaTek
Dimensity 7300, 6 or 8 GB RAM) is a good browser screen and a poor TV stick:

- **Browser app:** the Muse Web Screen runs in Chrome, full screen or as a home-screen
  app. This is the supported path in Germany. The tablet can also show the Home
  Assistant dashboard and any other browser page.
- **Native Muse app:** the app needs Android 10 or later, and Android 16 meets that.
  But Muse is only offered in the United States, Canada, Japan, Singapore, Mexico and
  Australia (November 2026); Germany is not supported. A German account cannot
  officially install or use it.
- **Muse Gadgets Test:** the Android camera-streaming test app can be built from the
  SDK and may run on the tablet, but it is not a TV display.
- **TV output:** the USB-C port is USB 2.0 with no DisplayPort Alt Mode and no MHL. A
  USB-C to HDMI adapter does not work. DeX runs standalone on the tablet; Samsung's
  support pages list cable and wireless DeX for the A11+, but users report the wireless
  DeX menu is missing and Samsung confirms no wired video output. Smart View
  (Miracast) to a Samsung or Miracast-capable TV works and is the practical way to put
  the tablet's Muse Web Screen on a TV.
- **Not a Linux gadget, Home Link or ESP32 gadget:** Android does not run the Linux
  Device SDK, the tablet has no way to become a Home Link, and it cannot take the ESP32
  firmware.

An older Galaxy A11 phone is Android 10 or 11 and much slower. The browser app still
works, but the tablet is the better screen.

### AirPlay from a Mac to the tablet

Samsung tablets are not AirPlay receivers. Android has no built-in AirPlay target, so a
Mac does not list the tablet in Screen Mirroring until a receiver app runs on it. These
apps add one:

| App | Model | Notes |
|---|---|---|
| [ScreenDock](https://screendock.cressu.com/) | Open source (GPLv3), Google Play, free 10-minute sessions, about $10 once | UxPlay based, Mac/iPhone/iPad, mirror or extend, 4K, no ads |
| [jqssun AirPlay Server](https://github.com/jqssun/android-airplay-server) | Free, open source (GPLv3), F-Droid or GitHub | AirPlay 2, screen mirroring, music, picture-in-picture, PIN, USB-tethered secondary display |
| [AirScreen](https://play.google.com/store/apps/details?id=com.ionitech.airscreen) | Closed source, ads or subscription | Also Google Cast, Miracast and DLNA; more protocols, lower ratings |
| [AirPlay Touch](https://play.google.com/store/apps/details?id=com.airplaytouch) | Closed source, ads or in-app purchase | Touch on the tablet controls the Mac through a free Mac companion, macOS 15 or later |
| [Duet Display](https://www.duetdisplay.com/) | Paid plans | Not AirPlay; a real extended display with touch over USB or Wi-Fi |

What none of them can do: play DRM video (Netflix, Disney+, Apple TV+) on the mirrored
screen. The picture stays black; YouTube, Safari, photos, presentations and music work.
All of them need both devices on the same Wi-Fi or LAN; guest networks, client isolation
and VPNs often block discovery. Mirroring is not Apple-certified and may break with a
macOS update.

The tablet screen is occupied while it receives the Mac, so it cannot show the Muse Web
Screen at the same time, unless the receiver supports picture-in-picture or the tablet
uses split screen. To put the Mac on the TV while the tablet stays on Muse, use the TV's
own AirPlay 2 (Samsung 2019 and later) or an Apple TV, or run the receiver in DeX on the
TV on a tablet with DisplayPort output. One TV shows one source at a time.

### Muse on the tablet, YouTube on the TV

Yes, when YouTube is cast with its own Cast button. The YouTube app on the tablet sends
the video to a Chromecast or Google TV device, or to a Samsung TV's YouTube app, and the
tablet stays on the Muse Web Screen as the remote. The TV plays YouTube; the tablet
shows Muse; the two do not share a screen.

Smart View cannot do this. It mirrors the tablet, so the TV shows whatever the tablet
shows: Muse or YouTube, not both. Split screen would mirror both halves. For independent
content, use the Cast icon in YouTube, not Smart View.

Both devices must be on the same Wi-Fi or LAN. YouTube casting to a Samsung TV uses the
TV's YouTube app (DIAL); a Chromecast or Google TV uses Google Cast. A plain TV without
a smart app needs a Chromecast or Google TV stick first.

### Wi-Fi, HDMI and the Muse voice command

- **Wi-Fi to a tablet:** the Muse app's Wi-Fi setup is for Muse gadgets (ESP32 boards and
  Home Link), which pair over BLE. A tablet is a client, not a gadget; the app does not
  push a Wi-Fi password to it. Enter the network on the tablet, scan the phone's Wi-Fi QR
  code, or use a USB-C hub with Ethernet.
- **USB 3.2 is not video output:** the tablet needs DisplayPort Alt Mode. The full Galaxy
  Tab S9, S10 and S11 models have it and work with a USB-C to HDMI cable; the Tab S9 FE,
  S10 FE and Tab A11+ have USB 2.0 and no HDMI output. Check the exact model before
  buying a cable.
- **"Muse, play YouTube":** the Muse app on the tablet does not control the tablet's
  YouTube app or a TV. Meta's TV skills run through Home Link, which is United States
  only. Without Home Link, cast YouTube manually from its app or use Google Assistant.
  The Muse Web Screen itself only draws cards; it does not cast.

## Which HDMI dongle

- **Official Muse stick:** none on sale, no model, no BOM. Wait for Meta.
- **DIY Linux screen:** the "dongle" is the computer. A Pi 5 needs micro-HDMI to HDMI,
  a Pi Zero 2 W needs mini-HDMI to HDMI. For an actual HDMI-stick shape, an x86 N100 TV
  stick with Linux is the closest, but it is not official.
- **Muse controlling an existing TV:** a Google TV Streamer or Chromecast with Google TV
  is the best-supported Cast target; a Roku Streaming Stick works through ECP; an Apple
  TV 4K works through pyatv. A Fire TV Stick is not a safe recommendation, because the
  SDK documents Insignia Fire TVs, not the generic stick.
- **A plain HDMI dongle cannot run the Linux SDK.** Closed Cast, Roku and Fire TV sticks
  do not accept custom firmware in this SDK.

## Sources

- [Muse Gadgets](https://gadgets.muse.ai), the official card, "Coming soon"
- [muse-gadget-sdk](https://github.com/facebookincubator/muse-gadget-sdk), the README,
  `linux/` and `skills/`
- [Linux Device SDK](https://github.com/facebookincubator/muse-gadget-sdk/blob/main/linux/README.md)
- [Google Cast skill](https://github.com/facebookincubator/muse-gadget-sdk/blob/main/skills/gadget-google-cast/SKILL.md)
- [Roku skill](https://github.com/facebookincubator/muse-gadget-sdk/blob/main/skills/gadget-roku-tvs-and-players/SKILL.md)
- [Apple TV 4K skill](https://github.com/facebookincubator/muse-gadget-sdk/blob/main/skills/gadget-apple-tv-4k/SKILL.md)
- [Muse Home Link](https://gadgets.muse.ai/home-link), the US-only note
- [TechCrunch, 2 October 2026](https://techcrunch.com/2026/10/02/meta-wants-you-to-build-your-own-muse-gadget)
