import sys, subprocess, numpy as np
for f in sys.argv[1:]:
    raw = subprocess.run(["ffmpeg","-v","error","-i",f,"-ac","1","-ar","32000","-f","f32le","-"],capture_output=True).stdout
    x = np.frombuffer(raw, np.float32)
    n=len(x); seg=[x[:n//2], x[n//2:]]
    fr=[]
    for s in seg:
        if len(s)<64: fr.append(0); continue
        S=np.abs(np.fft.rfft(s*np.hanning(len(s)))); fr.append(int(np.argmax(S)*32000/len(s)))
    print(f.split('/')[-1], "dur %.2f peak %.2f rms %.3f f1 %d f2 %d"%(n/32000, np.abs(x).max(), np.sqrt((x**2).mean()), fr[0], fr[1]))
