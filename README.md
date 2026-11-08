# Live Video Quality Monitor

Work in progress: the full README (live URL, local setup, architecture, deploy) comes with the deploy step. The sections below are already final.

## Thresholds

A second is **Poor** if any rule matches. When several match, the first one in this order is the reason (the spec's priority). A value exactly at a threshold is OK.

| Reason | Poor when | Value | Setting (env var) |
|---|---|---|---|
| No face | no face detected in any processed frame of the second | — | — |
| Too dark | `brightness < MIN_BRIGHTNESS` | 60 | `MIN_BRIGHTNESS` |
| Too bright | `brightness > MAX_BRIGHTNESS` | 200 | `MAX_BRIGHTNESS` |
| Hold still | `motion > MAX_MOTION` | **2.0** | `MAX_MOTION` |
| Low FPS | `fps < MIN_FPS` | 15 | `MIN_FPS` |

The backend reads the values from its environment and serves them at `GET /config`; the browser uses exactly those, so there is one source of truth.

**Why motion is 2.0 and not the suggested 20.** Calibrated on a real laptop camera:

| Situation | Measured motion |
|---|---|
| Sitting still (sensor noise) | ≈ 0.8 |
| Moving the head fast | ≈ 3.6 |
| Hand waved close to the camera | > 20 |

Motion is defined by the spec as the mean absolute luma difference over the **whole frame**. A head that moves covers only part of the frame and the background stays still, so the mean stays small. With 20, only something filling most of the frame (a hand right at the lens) would ever trigger "Hold still". 2.0 is about 2.5× the still-noise level and below normal head movement. The formula itself is unchanged.

## Hidden tab (background throttling)

Browsers stop delivering video frames to a page that isn't visible. "Not visible" means more than another tab:

- another tab is in front in the same window;
- the browser window is **minimised**;
- on macOS, the window is **fully covered by another window** (for example a terminal). Chrome detects that the window is occluded and treats the page as hidden, even though its tab is still the active one.

Verified with a real laptop camera: in a 60 s session with Chrome in front and nothing covering it, FPS stayed steady with no 0-FPS seconds; switching to other windows produced the 0-FPS stretches described below.

While the page is hidden:

- No frames are processed, so each hidden second is stored honestly as `fps: 0` with `brightness` and `motion` as `null`. Nothing is interpolated or invented. The charts show a gap, and the session keeps one sample per second, so `t` stays contiguous and "duration = t of the last sample" still holds.
- The live screen shows "Paused while this tab is hidden".
- The second in which the tab was hidden, and the one in which it came back, contain only a few frames, so they show as **Poor: low FPS**.
- A fully hidden second has no frames, so no face could be detected in it. By the spec's priority it is stored as **Poor: no face**. You don't see that live (the page isn't drawn while hidden), but it is what the charts' verdict strip and the history show.
- When the tab becomes visible again, motion is not diffed against the stale pre-hidden frame (that would report movement that never happened). It restarts from the next pair of frames.
