import sys, torch, soundfile as sf
from transformers import AutoProcessor, Wav2Vec2ForCTC
mid="facebook/wav2vec2-xlsr-53-espeak-cv-ft"
proc=AutoProcessor.from_pretrained(mid); model=Wav2Vec2ForCTC.from_pretrained(mid).eval()
tok=proc.tokenizer; v=tok.get_vocab(); N,NJ=v['n'],v['ɲ']; nj2=v.get('nʲ')
a,sr=sf.read(sys.argv[1],dtype="float32")
def probe(s,e,lab):
    x=a[int(s*sr):int(e*sr)]
    with torch.no_grad(): P=model(proc(x,sampling_rate=sr,return_tensors="pt").input_values).logits[0].softmax(-1)
    ids=P.argmax(-1).tolist(); res=[]
    for i,t in enumerate(ids):
        if t in (N,NJ) or (nj2 and t==nj2):
            nxt=next((tok.convert_ids_to_tokens(u) for u in ids[i+1:] if u not in (t,tok.pad_token_id)),'')
            res.append(f"{tok.convert_ids_to_tokens(t)}@{s+i*0.02:.2f}(→{nxt}) P[n]={P[i,N]:.2f} P[ɲ]={P[i,NJ]:.2f}"+(f" P[nʲ]={P[i,nj2]:.2f}" if nj2 else ''))
    print(f"== {lab}"); [print('   ',r) for r in res]
probe(0.0,4.4,"строка 1 (дальн?х ≈1.34; печальных ≈2.54)")
probe(60.9,63.3,"финал (дальн?х ≈62.40)")
probe(11.9,15.8,"калибровка: ненужный, небо")
probe(42.1,43.8,"калибровка: родное (тв.)")
probe(38.6,40.5,"калибровка: синее")
