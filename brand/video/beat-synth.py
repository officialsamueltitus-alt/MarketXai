# Original 100 BPM beat for the MarketX ads (no samples, no copyright): pad + pluck in the intro, riser, bass drop at DROP,
# kick / clap / hats / sub bass until END, then the pad tail. Writes mono float32 stems (*.raw, 44.1 kHz) into the current folder;
# Mix the stems with ffmpeg (pan to stereo, highpass/lowpass per stem, light echo on the pad and pluck, sidechain the pad to the bass).
import numpy as np
SR=44100; BPM=100; B=60/BPM; BAR=4*B; DUR=56.0; N=int(DUR*SR)
rng=np.random.default_rng(7)
def buf(): return np.zeros(N)
def add(dst,sig,t,gain=1.0):
    sig=sig.copy(); f=min(len(sig)//4,int(.012*SR))
    if f>1: sig[-f:]*=np.linspace(1,0,f); sig[:16]*=np.linspace(0,1,16)
    i=int(t*SR); j=min(N,i+len(sig))
    if i<N: dst[i:j]+=sig[:j-i]*gain
tt=lambda d: np.arange(int(d*SR))/SR
def env(d,a=.005,r=None):
    x=tt(d); e=np.minimum(1,x/a)
    if r: e*=np.exp(-x/r)
    return e
DROP=4.8; END=51.4
def mtof(m): return 440*2**((m-69)/12)
# progression per bar: Am F C G (root midi, chord tones)
PROG=[(45,[57,60,64]),(41,[53,57,60]),(48,[60,64,67]),(43,[55,59,62])]
kick,snare,hat,bass,pad,pluck,fx=[buf() for _ in range(7)]
def kick_s():
    x=tt(.45); f=48+110*np.exp(-x/.035); ph=2*np.pi*np.cumsum(f)/SR
    return np.sin(ph)*np.exp(-x/.16)+.25*np.sin(ph*2)*np.exp(-x/.02)
def snare_s():
    x=tt(.3); n=rng.standard_normal(len(x)); n=np.convolve(n,[1,-.85],'same')
    return .6*n*np.exp(-x/.07)+.5*np.sin(2*np.pi*190*x)*np.exp(-x/.05)
def clap_s():
    x=tt(.25); n=rng.standard_normal(len(x)); e=np.zeros(len(x))
    for o in (0,.011,.022): e+=(x>=o)*np.exp(-np.maximum(0,x-o)/(.012 if o<.02 else .09))
    return np.convolve(n,[1,-.95],'same')*e*.5
def hat_s(op=False):
    x=tt(.25 if op else .06); n=rng.standard_normal(len(x)); n=np.diff(np.diff(n,prepend=0),prepend=0)
    return n*np.exp(-x/(.08 if op else .018))*.35
K,S,C,H,HO=kick_s(),snare_s(),clap_s(),hat_s(),hat_s(True)
nb=int(DUR/BAR)+1
for b in range(nb):
    t0=b*BAR
    root,ch=PROG[b%4]
    # pad (all the way, softer in the intro)
    if t0<DUR:
        x=tt(BAR+.4); s=np.zeros(len(x))
        for m in ch+[ch[0]+12]:
            f=mtof(m)
            for dt in (-.08,.0,.08):
                s+=((x*f*2**(dt/12))%1*2-1)*.06
        add(pad,s*np.minimum(1,x/.25)*np.minimum(1,(BAR+.4-x)/.4),t0,.8 if t0>=DROP else .55)
    # pluck arpeggio 16ths after the drop (and in the intro softly)
    if t0<END:
        seq=[0,1,2,1,3,2,1,2]
        for k in range(8):
            m=(ch+[ch[0]+12])[seq[k]]+12; x=tt(.35); f=mtof(m)
            s=(np.sin(2*np.pi*f*x)+.3*np.sin(4*np.pi*f*x))*np.exp(-x/.12)
            add(pluck,s,t0+k*B/2,.16 if t0>=DROP else .09)
    if DROP<=t0<END:
        # kick: 1, the "and" of 2, 3
        for p in (0,1.5,2): add(kick,K,t0+p*B,1)
        if b%2==1: add(kick,K,t0+3.5*B,.7)
        for p in (1,3): add(snare,S,t0+p*B,.55); add(snare,C,t0+p*B,.7)
        for k in range(8):
            sw=.03*B if k%2 else 0
            add(hat,H,t0+k*B/2+sw,.8 if k%2 else .5)
        add(hat,HO,t0+3.5*B,.5)
        # sub bass: root on the kicks, octave lift on the last 8th
        for p,ln,mm in ((0,1.2,0),(1.5,.45,0),(2,1.2,0),(3.5,.45,12)):
            x=tt(ln*B); f=mtof(root-12+mm)
            s=np.sin(2*np.pi*f*x)+.2*np.sin(4*np.pi*f*x)
            add(bass,s*np.minimum(1,x/.01)*np.minimum(1,(ln*B-x)/.03),t0+p*B,.55)
# riser into the drop + impact
x=tt(3.6); f=200*2**(x/3.6*3); n=rng.standard_normal(len(x))
r=(np.sin(2*np.pi*np.cumsum(f)/SR)*.15+np.convolve(n,np.ones(6)/6,'same')*.25)*(x/3.6)**2
add(fx,r,DROP-3.6,1)
x=tt(2.5); add(fx,(np.sin(2*np.pi*42*x)*1.2+rng.standard_normal(len(x))*.3*np.exp(-x/.05))*np.exp(-x/.7),DROP,1)
# ending: final hit + long pad tail already there
add(fx,(np.sin(2*np.pi*42*tt(3))*np.exp(-tt(3)/.9)),END,1)
for n_,a in (('kick',kick),('snare',snare),('hat',hat),('bass',bass),('pad',pad),('pluck',pluck),('fx',fx)):
    a.astype(np.float32).tofile(n_+'.raw')
print('ok')
