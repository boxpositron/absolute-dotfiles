---
name: sound-design
description: Creates original notification sounds, UI sounds, short sound effects and MIDI offline with the sfx recipe renderer, so the audio contains no third-party material and works on macOS and Linux. Use when asked to make, tweak or wire up a ding, chime, alert, notification or effect sound, including omo's own notification sounds.
---

# Sound design with sfx

`sfx` (`~/.local/bin/sfx`, a uv script in the dotfiles) renders sounds from a TOML recipe. Everything is synthesised from sine partials and seeded noise, and the same recipe renders to byte-identical files on every run and machine. `sfx --help` lists the options.

## Rules

- Synthesise only. Never use samples, SoundFonts, sound libraries, online generators or AI audio models: the point is audio with no third-party material that renders without a network.
- You cannot hear. Read the numbers `sfx` prints, then ask the user to audition the file before calling a sound done, and never change a sound they approved without them listening again.
- Keep the recipe next to the rendered files and commit both. The recipe is the source.

## Workflow

1. Write or edit a recipe file (format below).
2. Run `sfx recipes.toml [OUT_DIR] [--only NAME ...]`. Files go next to the recipe unless OUT_DIR is given. The first run lets uv install numpy and mido once.
3. Check each report line: length, loudness and peak, e.g. `omo-done: 2.22s, -26.0 LUFS, peak -15.8 dBFS`. A note saying the peak ceiling held it back means the sound is quieter than the target; lower `bright` or spread the notes out.
4. Ask the user to listen with `omo-sound path/to/NAME.wav` (afplay on macOS; pw-play, paplay, aplay or ffplay on Linux), then iterate on the notes and tone.

## Recipe format

```toml
loudness = -26.0          # target LUFS for every sound (default -26, the level of the macOS Glass alert)
extras = ["mp3", "mid"]   # optional: MP3 needs ffmpeg; MIDI exports the notes only
program = 11              # General MIDI program for the .mid files (default 11, vibraphone)

[sound.example-chime]
about = "what it is for"
notes = [[0.00, "G5", 0.75, -0.15], [0.11, "E6", 1.00, 0.15]]  # [start s, note, velocity 0..1, pan -1..1]
tone = { bright = 0.6, decay = 1.3 }
room = { rt60 = 0.7, wet = 0.22 }
whoosh = { start = 0.0, duration = 0.38, from_hz = 300, to_hz = 5000, gain = 0.6, pan = 0.0 }
loudness = -24.0          # optional per-sound override
```

- **notes**: a note is a name (`E6`, `C#5`, `Bb4`; C4 is middle C, 60) or a MIDI number. Each one is a struck-bar ding.
- **tone**: `bright` sets how much of the metallic strike comes through (0.35 is muted, 1.0 neutral, 1.25 sparkly). `decay` scales the ring time; at 1.0 a note rings out in about two seconds.
- **room**: a small synthetic room. `rt60` is its decay time (0.05 to 5 s) and `wet` its level; set `wet = 0` for a dry sound.
- **whoosh**: band-passed noise sweeping from `from_hz` to `to_hz` (20 to 8000), for air, swishes and sent effects. A sound needs notes, a whoosh, or both.

Unknown keys and bad notes stop the render with an error naming the table and key.

## Designing notification sounds

- Keep the audible part under a second, with two or three notes. A rising contour reads as positive or as a call for attention; a falling one reads as a problem. Brighter tones feel more urgent.
- Tell events apart by contour and timbre, not just pitch: for example a rising arpeggio for done, a brighter rising pair for a question, and a muted falling pair for an error.
- Keep notes between about C5 and C7. Higher gets shrill and lower gets muddy on laptop speakers.
- Give a set of sounds one loudness and let their shape carry the meaning.

## Formats

- **WAV** (always written, 48 kHz 16-bit stereo): desktop playback and native notifications. macOS plays a custom notification sound only from inside the app bundle.
- **MP3** (`extras = ["mp3"]`): browsers. Browsers refuse to play audio until the user has interacted with the page, and web push notifications cannot carry a custom sound at all.
- **MIDI** (`extras = ["mid"]`): the same notes for a DAW. A whoosh has no MIDI form.

## omo's own sounds

`~/dotfiles/.config/omo/sounds/recipes.toml` renders `omo-done`, `omo-input` and `omo-error`. `omo-notify` (local hooks) and `omo-remote` (events from flowstate-remote) play them through `omo-sound NAME`. To change one, edit the recipe, run `sfx recipes.toml` in that directory, and the next event uses the new sound. Keep the three names, because the scripts map events to them.
