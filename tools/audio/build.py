# Builds fixtures/public/audio/*.ogg from the downloaded CC0 sources.
# usage: python build.py <download-root> <out-dir>
import os, subprocess, sys
import numpy as np

SRC, OUT = sys.argv[1], sys.argv[2]
SR = 32000
rng = np.random.default_rng(7)
os.makedirs(OUT, exist_ok=True)


def P(*parts):
    return os.path.join(SRC, *parts)


def load(path, sr=SR, ch=1):
    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", path, "-ac", str(ch), "-ar", str(sr), "-f", "f32le", "-"],
        capture_output=True, check=True,
    ).stdout
    x = np.frombuffer(raw, np.float32).astype(np.float64)
    return x.reshape(-1, ch).T  # (ch, n)


def seg(x, a, b=None, sr=SR):
    return x[:, int(a * sr): None if b is None else int(b * sr)]


def fade(x, fin=0.0, fout=0.0, sr=SR):
    x = x.copy()
    n = x.shape[1]
    if fin > 0:
        k = min(n, int(fin * sr)); x[:, :k] *= np.linspace(0, 1, k)
    if fout > 0:
        k = min(n, int(fout * sr)); x[:, n - k:] *= np.linspace(1, 0, k)
    return x


def loopify(x, xf, sr=SR):
    """Seamless loop: the last xf seconds are crossfaded (equal power) into the first xf seconds."""
    k = int(xf * sr)
    n = x.shape[1]
    head, body, tail = x[:, :k], x[:, k:n - k], x[:, n - k:]
    t = np.linspace(0, np.pi / 2, k)
    mix = tail * np.cos(t) + head * np.sin(t)
    return np.concatenate([body, mix], axis=1)


def place(length, items, ch=1, wrap=False, sr=SR):
    """items: (clip, start_s, gain). wrap=True folds overflow to the start (seamless loop by construction)."""
    n = int(length * sr)
    out = np.zeros((ch, n))
    for clip, t, g in items:
        s = int(t * sr) % n if wrap else int(t * sr)
        c = clip * g
        m = c.shape[1]
        if wrap:
            idx = (np.arange(m) + s) % n
            for j in range(ch):
                np.add.at(out[j], idx, c[j if c.shape[0] > 1 else 0])
        else:
            e = min(n, s + m)
            if e > s:
                out[:, s:e] += c[:, : e - s]
    return out


def lowpass(x, fc, sr=SR):
    a = np.exp(-2 * np.pi * fc / sr)
    y = np.zeros_like(x)
    for j in range(x.shape[0]):
        acc = 0.0
        row, out = x[j], y[j]
        # vectorised enough for our sizes via lfilter-like recursion in chunks
        from itertools import accumulate  # noqa: F401
        for i in range(row.shape[0]):
            acc = (1 - a) * row[i] + a * acc
            out[i] = acc
    return y


def brown(seconds, sr=SR, fc=400):
    w = rng.standard_normal(int(seconds * sr))
    # cheap smoothing: cumulative sum with leak, then normalise
    y = np.zeros_like(w)
    acc = 0.0
    leak = 1 - 2 * np.pi * fc / sr / 8
    for i in range(w.shape[0]):
        acc = acc * leak + w[i] * 0.02
        y[i] = acc
    y -= y.mean()
    return (y / (np.abs(y).max() + 1e-9))[None, :]


def norm_rms(x, db):
    r = np.sqrt((x ** 2).mean()) + 1e-12
    y = x * (10 ** (db / 20) / r)
    pk = np.abs(y).max()
    return y * (0.97 / pk) if pk > 0.97 else y


def norm_peak(x, db=-1.0):
    pk = np.abs(x).max() + 1e-12
    return x * (10 ** (db / 20) / pk)


def save(name, x, sr=SR, q="2"):
    x = np.clip(x, -1, 1).astype(np.float32)
    ch = x.shape[0]
    data = x.T.copy().tobytes()
    path = os.path.join(OUT, name + ".ogg")
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-f", "f32le", "-ar", str(sr), "-ac", str(ch), "-i", "-",
         "-c:a", "libvorbis", "-q:a", q, path],
        input=data, check=True,
    )
    print(f"{name:16s} {x.shape[1] / sr:6.2f}s ch{ch} {os.path.getsize(path) / 1024:7.1f} KiB")


K_IF = P("k-interface-sounds", "x", "Audio")
K_IM = P("k-impact-sounds", "x", "Audio")
K_RPG = P("k-rpg-audio", "x", "Audio")
K_SF = P("k-sci-fi-sounds", "x", "Audio")
S100 = P("oga-100sfx", "x")
S100B = None
for root, _, files in os.walk(P("oga-100sfx2", "x")):
    if any(f.startswith("sfx100v2_") for f in files):
        S100B = root
CREA = None
for root, _, files in os.walk(P("oga-creature", "x")):
    if "barking_01.ogg" in files:
        CREA = root
SWISH = None
for root, _, files in os.walk(P("oga-swishes", "x")):
    if "swish-8.wav" in files and not root.endswith("__MACOSX"):
        SWISH = root
SFXL = P("oga-sfxloops", "x")

AMB_DB, SFX_DB, MUS_DB = -20.0, -1.0, -18.0

# ---------------- Ambience (loops, mono) ----------------
waves = [load(P("oga-beach-ocean-waves", f"wave_0{i}.flac")) for i in (1, 2, 3, 4)]
bed = brown(15, fc=300) * 0.18
sea = place(15, [(bed, 0, 1.0)] + [(w, t, g) for w, t, g in zip(
    [waves[0], waves[2], waves[1], waves[3], waves[0]], [0.2, 3.6, 6.4, 9.0, 12.4], [1, 0.8, 0.9, 1, 0.7])], wrap=True)
save("sea", norm_rms(sea, AMB_DB))

save("wind", norm_rms(loopify(seg(load(P("oga-wind1", "wind1.wav")), 2, 26), 2.0), AMB_DB))
save("rain", norm_rms(load(P("oga-rain-loopable", "x", "1.ogg")), AMB_DB))
save("storm", norm_rms(loopify(seg(load(P("oga-rainthunder", "rain-thunder.ogg")), 0, 32), 2.0), AMB_DB))
save("forest", norm_rms(loopify(load(P("oga-birds", "birds-isaiah658_0.ogg")), 1.5), AMB_DB))
save("river", norm_rms(loopify(seg(load(P("oga-park", "park_ambience_river.wav")), 60, 84), 2.0), AMB_DB))
save("fire", norm_rms(loopify(seg(load(P("oga-fireplace", "fire.wav")), 1, 17), 1.0), AMB_DB))
save("night", norm_rms(loopify(load(P("oga-crickets", "crickets_1.mp3")), 1.0), AMB_DB))
crowd = load(P("oga-crowd", "crowd_shouting_0.ogg"))
save("crowd", norm_rms(loopify(crowd, 1.5), AMB_DB))
save("city", norm_rms(loopify(seg(load(P("oga-traffic", "gatve_Varniu_2.ogg")), 0, 30), 2.0), AMB_DB))

metal = [load(os.path.join(K_IM, f"impactMetal_{k}_00{i}.ogg")) for k in ("heavy", "medium") for i in range(5)]
plate = [load(os.path.join(K_IM, f"impactPlate_heavy_00{i}.ogg")) for i in range(5)]
sword = load(P("oga-melee", "x", "melee sounds", "sword sound.wav"))
hits = metal + plate + [sword]
items = [(lowpass(seg(crowd, 4, 20), 2500), 0, 0.9)]
t = 0.1
while t < 16:
    items.append((hits[rng.integers(len(hits))], t, rng.uniform(0.25, 0.6)))
    t += rng.uniform(0.25, 0.8)
save("battle", norm_rms(place(16, items, wrap=True), AMB_DB))

steps = [load(os.path.join(K_IM, f"footstep_grass_00{i}.ogg")) for i in range(5)]
belts = [load(os.path.join(K_RPG, f)) for f in ("beltHandle1.ogg", "beltHandle2.ogg", "clothBelt.ogg")]
items = []
for soldier in range(14):
    off = rng.uniform(-0.04, 0.04)
    g = rng.uniform(0.3, 0.7)
    for beat in range(8):
        items.append((steps[rng.integers(5)], beat * 0.55 + off + (0.275 if soldier % 2 else 0) * 0, g))
    for beat in range(0, 8, 2):
        items.append((belts[rng.integers(3)], beat * 0.55 + off + 0.1, g * 0.35))
save("marching", norm_rms(place(4.4, items, wrap=True), AMB_DB))

save("horses", norm_rms(loopify(load(P("oga-horse", "Trot.ogg")), 1.0), AMB_DB))
save("rumble", norm_rms(loopify(load(P("oga-rumble", "rumble.wav")), 2.0), AMB_DB))
buzz = load(P("oga-buzz", "buzz_0.ogg"))
save("electric-hum", norm_rms(loopify(np.concatenate([buzz] * 4, axis=1), 0.3), AMB_DB - 2))
save("machine", norm_rms(loopify(load(os.path.join(S100B, "sfx100v2_loop_machine_02.ogg")), 0.5), AMB_DB))
save("bubbling", norm_rms(loopify(load(os.path.join(SFXL, "water_boiling.ogg")), 0.5), AMB_DB))
hb = load(P("oga-heartbeat", "heartbeat_slow_0.wav"))
save("heartbeat", norm_rms(place(1.8, [(hb, 0, 1)], wrap=True), AMB_DB))
br = load(P("oga-breathing", "breathing_tired.wav"))
save("breathing", norm_rms(loopify(br, 0.25), AMB_DB))
save("drone", norm_rms(loopify(load(os.path.join(K_SF, "spaceEngineLow_000.ogg")), 0.8), AMB_DB - 2))

# ---------------- SFX (one-shots, mono) ----------------
def sfx(name, x, fout=0.0):
    save(name, norm_peak(fade(x, 0.0, fout)))

sfx("whoosh", load(os.path.join(SWISH, "swish-8.wav")))
sfx("whoosh-soft", fade(seg(load(P("oga-whoosh", "woosh.ogg")), 1.0, 2.4), 0.35, 0.6))
sfx("pop", load(os.path.join(S100, "plop_01.ogg")))
sfx("click", load(os.path.join(K_IF, "click_002.ogg")))
sfx("chime", load(os.path.join(K_IF, "glass_001.ogg")))
sfx("bell", load(os.path.join(S100, "bell_01.ogg")))
sfx("gong", load(os.path.join(S100, "gong_01.ogg")))
sfx("correct", load(os.path.join(K_IF, "confirmation_001.ogg")))
sfx("wrong", load(os.path.join(K_IF, "error_006.ogg")))
sfx("tick", load(os.path.join(K_IF, "tick_002.ogg")))
sfx("sword-clash", place(0.9, [(sword, 0, 1.0), (metal[1], 0.015, 0.8)]), 0.2)
sfx("shield-hit", place(0.8, [(plate[0], 0, 1.0), (load(os.path.join(K_IM, "impactWood_heavy_000.ogg")), 0.005, 0.7)]), 0.2)
sw = [load(os.path.join(SWISH, f"swish-{i}.wav")) for i in range(1, 14)]
thunk = [load(os.path.join(K_IM, f"impactWood_light_00{i}.ogg")) for i in range(5)]
items = [(sw[rng.integers(13)], rng.uniform(0, 0.6), rng.uniform(0.4, 1.0)) for _ in range(12)]
items += [(thunk[rng.integers(5)], rng.uniform(0.9, 1.5), rng.uniform(0.3, 0.6)) for _ in range(6)]
sfx("arrows", place(1.9, items), 0.2)
sfx("war-horn", seg(load(P("oga-horn", "theircoming_0.ogg")), 0, 6), 1.5)
items = [(lowpass(seg(crowd, 10, 13.5), 3000), 0, 0.8)]
items += [(hits[rng.integers(len(hits))], rng.uniform(0, 2.6), rng.uniform(0.4, 1.0)) for _ in range(9)]
sfx("battle-clash", place(3.5, items), 0.8)
sfx("explosion", load(os.path.join(K_SF, "lowFrequency_explosion_000.ogg")), 0.3)
rum = load(P("oga-rumble", "rumble.wav"))
erupt = place(8, [
    (load(os.path.join(K_SF, "lowFrequency_explosion_000.ogg")), 0, 1.0),
    (load(os.path.join(K_SF, "explosionCrunch_000.ogg")), 0.05, 0.6),
    (load(os.path.join(K_SF, "lowFrequency_explosion_001.ogg")), 1.4, 0.7),
    (fade(seg(rum, 2, 10), 0.3, 4.0), 0.2, 0.9),
])
sfx("eruption", erupt, 1.0)
sfx("thunder", load(os.path.join(S100B, "sfx100v2_thunder_01.ogg")), 0.5)
spark = load(P("oga-spark", "spark.wav"))
sfx("spark", spark)
cs = load(P("oga-spark", "continuousspark.wav"))
sfx("short-circuit", place(1.2, [(cs, 0, 1), (spark, 0.15, 0.9), (cs, 0.3, 0.8),
                                 (load(os.path.join(K_IF, "glitch_002.ogg")), 0.35, 0.7),
                                 (load(os.path.join(S100, "switch_01.ogg")), 0.8, 0.8)]), 0.15)
sfx("switch", load(P("oga-breaker", "x", "switch on.wav")))
sfx("glass-break", place(1.2, [(load(os.path.join(K_IM, "impactGlass_heavy_000.ogg")), 0, 1.0),
                               (load(os.path.join(S100, "glass_04.ogg")), 0.03, 0.8)]), 0.3)
sfx("metal-clank", load(os.path.join(S100, "metal_04.ogg")))
sfx("wood-hit", load(os.path.join(K_IM, "impactWood_medium_000.ogg")))
sfx("door-creak", load(os.path.join(K_RPG, "creak1.ogg")))
sfx("dog-bark", load(os.path.join(CREA, "barking_01.ogg")))
sfx("sheep", load(P("oga-sheep", "sheep_baa_0.ogg")))
sfx("seagull", load(P("oga-seagull", "Seagull_Ambient_1.wav")), 0.3)
sfx("splash", load(os.path.join(S100, "splash_01.ogg")))
sfx("page-turn", load(os.path.join(K_RPG, "bookFlip1.ogg")))
sfx("coins", load(os.path.join(K_RPG, "handleCoins.ogg")))
sfx("applause", fade(seg(load(P("oga-applause", "applause-clapping-church-crowd-immersive.wav")), 3, 9), 0.4, 2.0))
fs = [load(os.path.join(K_IM, f"footstep_concrete_00{i}.ogg")) for i in range(5)]
sfx("footsteps", place(2.4, [(fs[i % 5], i * 0.5, 0.9) for i in range(5)]))

# ---------------- Music (stereo, 44.1 kHz) ----------------
def music(name, path, a=None, b=None, xf=0.0):
    x = load(path, sr=44100, ch=2)
    if a is not None:
        x = seg(x, a, b, sr=44100)
    if xf:
        x = loopify(x, xf, sr=44100)
    save(name, norm_rms(x, MUS_DB), sr=44100, q="1")

music("music-calm", P("oga-m-snowfall", "Snowfall_Looped_ver._0.ogg"))
music("music-history", P("oga-m-bardsloop", "loop.wav"))
music("music-epic", P("oga-m-battleA", "battleThemeA.mp3"), 0, 64, 2.0)
music("music-playful", P("oga-m-march", "x", "Children's March Theme.wav"))
music("music-mysterious", P("oga-m-song18", "song18_0.mp3"))
music("music-curious", P("oga-m-wherewasi", "WereWasI_0.ogg"))
