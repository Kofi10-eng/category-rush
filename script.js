const socket = io();
let room = null;
let myId = null;
let activeChallenge = null;
const $ = id => document.getElementById(id);
function toast(msg){const t=$('toast');t.textContent=msg;t.style.display='block';setTimeout(()=>t.style.display='none',2500)}
function val(id){return $(id).value.trim()}
function emitAnswers(){ const answers={}; document.querySelectorAll('.ans').forEach(i=>answers[i.dataset.cat]=i.value); socket.emit('answer:update', answers); }
$('create').onclick=()=>socket.emit('room:create', val('name')||'Host');
$('joinBtn').onclick=()=>socket.emit('room:join',{code:val('code'),name:val('name')||'Player'});
$('start').onclick=()=>socket.emit('round:start');
$('score').onclick=()=>socket.emit('round:score');
$('end').onclick=()=>socket.emit('game:end');
$('rush').onclick=()=>socket.emit('rush');
document.querySelectorAll('.ans').forEach(i=>i.addEventListener('input', emitAnswers));
$('voteCount').onclick=()=>{ if(activeChallenge){socket.emit('challenge:vote',{id:activeChallenge.id,vote:'count'}); $('challengeModal').classList.add('hidden'); }};
$('voteReject').onclick=()=>{ if(activeChallenge){socket.emit('challenge:vote',{id:activeChallenge.id,vote:'reject'}); $('challengeModal').classList.add('hidden'); }};
socket.on('connect',()=>myId=socket.id);
socket.on('error:msg',toast);
socket.on('room:created', code=>toast('Room created: '+code));
socket.on('rush:start', ({seconds})=>{ let n=seconds; $('rushCountdown').classList.remove('hidden'); $('rushCountdown').textContent=n; const iv=setInterval(()=>{n--; $('rushCountdown').textContent=n; if(n<=0){clearInterval(iv); $('rushCountdown').classList.add('hidden')}},1000); });
socket.on('challenge:popup', ch=>{ activeChallenge=ch; $('challengeText').innerHTML=`<b>${ch.challengerName}</b> challenged <b>${ch.playerName}</b><br>${ch.category.toUpperCase()}: <b>${ch.answer||'(blank)'}</b>`; const cannot = ch.challengerId===myId; $('voteCount').disabled=cannot; $('voteReject').disabled=cannot; $('voteNote').textContent = cannot ? 'You started this dispute, so you cannot vote.' : 'Vote now.'; $('challengeModal').classList.remove('hidden'); });
socket.on('room:update', r=>{ room=r; render(r); });
function render(r){
 $('join').classList.add('hidden'); $('game').classList.remove('hidden'); $('roomBadge').textContent='Room '+r.code; $('letter').textContent=r.letter||'?'; $('used').textContent='Used letters: '+(r.usedLetters.length?r.usedLetters.join(', '):'none');
 $('start').style.display = r.hostId===myId ? 'block':'none'; $('score').style.display = r.hostId===myId ? 'block':'none'; $('end').style.display = r.hostId===myId ? 'block':'none';
 $('leader').innerHTML=[...r.players].sort((a,b)=>b.score-a.score).map(p=>`<li><b>${escapeHtml(p.name)}</b> — ${p.score}</li>`).join('');
 $('results').innerHTML = r.results?.length ? r.results.map(pr=>`<div class="playerResult"><h3>${escapeHtml(pr.name)} +${pr.total}</h3>${pr.rows.map(row=>`<div class="answerRow"><b>${row.category}</b>: ${escapeHtml(row.answer||'—')}<br><span class="${row.ok?(row.typo?'typo':'ok'):'bad'}">${escapeHtml(row.reason)} · ${row.points} pts</span><button onclick="challenge('${pr.playerId}','${row.category}')">Challenge / vote</button></div>`).join('')}</div>`).join('') : '<p>No results yet.</p>';
 $('challenges').innerHTML = r.challenges?.length ? r.challenges.map(ch=>`<div class="challenge"><b>${escapeHtml(ch.challengerName)}</b> challenged <b>${escapeHtml(ch.playerName)}</b>: ${escapeHtml(ch.category)} = <b>${escapeHtml(ch.answer||'—')}</b><br>Count it (${ch.count.length}) · Reject (${ch.reject.length}) ${ch.challengerId===myId?'<br><small>You cannot vote on your own dispute.</small>':`<div class="row"><button onclick="vote('${ch.id}','count')">Count It</button><button class="danger" onclick="vote('${ch.id}','reject')">Reject</button></div>`}</div>`).join('') : '<p>No challenges.</p>';
 if(r.final) toast('Game ended. Final table shown.');
}
window.challenge=(playerId,category)=>socket.emit('challenge:create',{playerId,category});
window.vote=(id,vote)=>socket.emit('challenge:vote',{id,vote});
function escapeHtml(s){return String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}
