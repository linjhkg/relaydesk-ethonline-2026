// Local-only recording utility. Explicit display picker; no audio or wallet access.
import http from 'node:http';
const page = `<!doctype html><html lang="zh"><meta charset="utf-8"><title>RelayDesk 录屏控制台</title>
<style>body{font:20px system-ui;max-width:800px;margin:60px auto}button{font:inherit;padding:16px;margin:10px}p{line-height:1.6}</style>
<h1>RelayDesk 录屏控制台</h1><p>仅录制你选择的演示标签页或窗口。不录麦克风，不读取钱包。请勿选择整个桌面。完成后下载 WebM，真人音轨另行合成。</p>
<button id="start">开始选择演示画面</button><button id="stop" disabled>停止并下载</button><p id="state">尚未开始</p><a id="download" hidden>下载录屏</a>
<script>
const start=document.getElementById('start'),stop=document.getElementById('stop'),state=document.getElementById('state'),download=document.getElementById('download');
let recorder,stream,chunks=[],started,timer;
start.onclick=async()=>{try{stream=await navigator.mediaDevices.getDisplayMedia({video:{frameRate:30},audio:false});
chunks=[];recorder=new MediaRecorder(stream,{mimeType:MediaRecorder.isTypeSupported('video/webm;codecs=vp9')?'video/webm;codecs=vp9':'video/webm',videoBitsPerSecond:6000000});
recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};
recorder.onstop=()=>{clearInterval(timer);stream.getTracks().forEach(t=>t.stop());const blob=new Blob(chunks,{type:recorder.mimeType});download.href=URL.createObjectURL(blob);download.download='relaydesk-screen-20260910.webm';download.hidden=false;download.click();state.textContent='录屏已完成，文件已准备下载；尚无真人讲解音轨。';start.disabled=false;stop.disabled=true;};
stream.getVideoTracks()[0].onended=()=>{if(recorder.state==='recording')recorder.stop()};
recorder.start(1000);started=Date.now();start.disabled=true;stop.disabled=false;timer=setInterval(()=>state.textContent='正在录制 '+Math.floor((Date.now()-started)/1000)+' 秒 · 无音轨',1000);
}catch(e){state.textContent='未开始：'+e.message}};
stop.onclick=()=>{if(recorder?.state==='recording')recorder.stop()};
</script></html>`;
http.createServer((req,res)=>{if(req.headers.host!=='127.0.0.1:4318'){res.writeHead(403).end();return}res.setHeader('Content-Type','text/html; charset=utf-8');res.setHeader('Cache-Control','no-store');res.end(page)}).listen(4318,'127.0.0.1',()=>console.log('Recorder: http://127.0.0.1:4318'));
