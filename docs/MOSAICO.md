# Muse on the ESP-Mosaico: install from the terminal

Status 18 November 2026: the app builds (`muse_mosaico-system-update.irisfw`, 2.63 MB),
and `./sim.sh --frame` renders the 480 x 480 ready screen. No board is connected, so
`iris system-update` still stops at `No available ESP-Iris USB device was found`. This is
the terminal path only: no HACS, no app store, no Espressif Studio server. The app source
is `~/Coding/esp/apps/muse`; the layout is `docs/SQUARE_LAYOUT.md` of the Muse repository.

## What you need

- an ESP-Mosaico CoreBoard, V1.0 or V1.2. Read the version on the silkscreen; Espressif
  has a separate user guide for each.
- a USB-C **data** cable (not a charge-only cable).
- the workspace at `~/Coding/esp/workspace` and the app at `~/Coding/esp/apps/muse`.
- a Home Assistant long-lived token named `Mosaico` (step 3).

## 1. Build without the board

```bash
cd ~/Coding/esp/workspace
python3 mosaico.py doctor
python3 mosaico.py iris system-update --project ../apps/muse
```

The build ends with `muse_mosaico-system-update.irisfw` and a SHA-256 per partition.
Without a connected board the command then stops at the gateway with
`No available ESP-Iris USB device was found`; that is the expected result before the
board arrives, not a build failure.

The app's `sdkconfig.defaults` already carried the Mosaico template's memory settings:
XIP, BSS and stacks in PSRAM, 250 MHz PSRAM, 320 MHz CPU and
`CONFIG_COMPILER_OPTIMIZATION_PERF`. On 18 November 2026 it gained
`CONFIG_LWIP_DHCP_DOES_NOT_CHECK_OFFERED_IP=y`, which skips the two ARP probes and boots
about a second sooner. Meta's Wi-Fi-in-flash and smaller-buffer profile was measured but
left out: the S31 has about 350 KB of SRAM free in this build, and the trade-off buys
only about 8 KB of IRAM at the cost of Wi-Fi throughput. Wi-Fi IRAM and hardware AES stay
on for the same reason.

## 2. First install over USB

Connect the board with the data cable. On a blank or unknown device, run the recovery
first, then the system update:

```bash
cd ~/Coding/esp/workspace
python3 mosaico.py recover
python3 mosaico.py iris list --project ../apps/muse
python3 mosaico.py iris system-update --project ../apps/muse
```

`recover` writes Espressif's base firmware and is the way back if ESP-Iris is not
reachable. `iris list` must show one device with its MAC and `ONLINE` before the update.
If the list is empty, the board is not in ESP-Iris USB mode: check the cable, the port,
and whether Vibe Mode is running. `iris system-update` writes the partition table, the
app and the UI bundle; `iris app-update` is only for code changes with the same
partitions and resources.

## 3. The Home Assistant token, once

Create a long-lived token in Home Assistant: profile, Security, Long-lived access
tokens, "Create token", name it `Mosaico`. Copy it once; Home Assistant never shows it
again. Store it in the macOS keychain, never in a file or a command line:

```bash
~/.config/private/keychain-add.sh MOSAICO_HA_TOKEN
```

Then write the URL, token and box name into the board's NVS partition:

```bash
cd ~/Coding/esp/apps/muse
/bin/zsh -lc 'python3 tools/provision.py --port /dev/cu.usbmodem1101 --dry-run'
/bin/zsh -lc 'python3 tools/provision.py --port /dev/cu.usbmodem1101'
```

The defaults are `--url ws://homeassistant.local:8123/api/websocket` and
`--box muse_esp32boxs3_screen`; pass the Home Assistant LAN address with `--url` if
`.local` does not resolve on the board. The board lives in the house. The token comes from `MOSAICO_HA_TOKEN` in the login shell, not from
`HOMEASSISTANT_TOKEN` (that is the owner's admin token). Wi-Fi is not in this image: the
app takes the network entered in Vibe Mode (partition `sysmeta`).

## 4. Vibe Mode

After the first boot the board starts Muse. Hold the top bar for 3 seconds to close it
and return to Vibe Mode; the bar fills orange while you hold. In Vibe Mode, "Save
Current Build" keeps Muse as a local Idea with an id such as `d1a2b3`. Open Muse last if
you want it to start after a normal restart.

## 5. Checks after the first boot

- In Home Assistant, call `script.muse_screen_show_text` with a title and a
  message. The board must show it through the `muse_web` event.
- Call `script.muse_screen_ask`; the question appears with two buttons. A tap
  sends `muse_mosaico_answer` back; the common answer entity gets
  `<answer>: <question>`.
- `python3 tools/muse_feed.py demo` in the simulator shows every card without the board.
- The app's own checks: battery label, Wi-Fi glyph, vibration on a doorbell, and the
  3-second close gesture.

## What not to use

- **HACS** is not needed. The app is an ESP-IDF/GSP application, not a Home Assistant
  integration.
- **No app store and no Espressif Studio server.** `mosaico.py` builds and installs from
  this workspace.
- **No port forwarding for the web screen.** The browser reaches Home Assistant through
  Tailscale (see `docs/MAC_APP.md` in the Muse repository).
