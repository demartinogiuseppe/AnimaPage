import sys, subprocess, numpy as np
for f in sys.argv[1:]:
    raw = subprocess.run(["ffmpeg","-v","error","-i",f,"-ac","1","-f","f32le","-"],capture_output=True).stdout
    x = np.frombuffer(raw, np.float32)
    d = np.abs(np.diff(x)); jump = abs(float(x[0]) - float(x[-1]))
    q = [np.sqrt((s**2).mean()) for s in np.array_split(x, 4)]
    print(f"{f:22s} rms quarters {' '.join('%.3f'%v for v in q)}  loopjump {jump:.3f} p99diff {np.percentile(d,99):.3f}")
