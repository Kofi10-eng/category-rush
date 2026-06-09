const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
const bannedPlaceWords = ['street','road','avenue','lane','drive','close','court','way','mews','shop','store','mall','market','tesco','asda','sainsbury','mcdonald','restaurant','hotel','airport','terminal','stadium','station','building','house','school','church','mosque','temple','warehouse','postcode'];

function norm(s='') { return String(s).toLowerCase().trim().replace(/[^a-z0-9\s'-]/g,'').replace(/\s+/g,' '); }
function title(s='') { return norm(s).split(' ').map(w => w ? w[0].toUpperCase()+w.slice(1) : '').join(' '); }
function loadSet(file) {
  try { return new Set(fs.readFileSync(path.join(__dirname, 'data', file),'utf8').split(/\r?\n/).map(norm).filter(Boolean)); }
  catch { return new Set(); }
}
const DB = {
  name: loadSet('names.txt'), animal: loadSet('animals.txt'), object: loadSet('objects.txt'), place: loadSet('places.txt')
};
// Extra aliases that must work even if a database upload misses them.
['frankfurt','frankfurt am main','gabasawa','spain','ghana','germany','gaborone','gauteng','gujarat','greater accra','colchester','bexleyheath'].forEach(x=>DB.place.add(x));
['kite','kites','ink','nikon camera','cat food','kayak','kettle'].forEach(x=>DB.object.add(x));
['gerbil','gecko','giraffe','gazelle','gannet','gibbon'].forEach(x=>DB.animal.add(x));

function distance(a,b) {
  if (Math.abs(a.length-b.length) > 2) return 99;
  const dp = Array.from({length:a.length+1},(_,i)=>Array(b.length+1).fill(0));
  for(let i=0;i<=a.length;i++) dp[i][0]=i;
  for(let j=0;j<=b.length;j++) dp[0][j]=j;
  for(let i=1;i<=a.length;i++) for(let j=1;j<=b.length;j++) {
    dp[i][j]=Math.min(dp[i-1][j]+1, dp[i][j-1]+1, dp[i-1][j-1]+(a[i-1]===b[j-1]?0:1));
  }
  return dp[a.length][b.length];
}
function fuzzyFind(value, set) {
  if (!value || value.length < 3) return null;
  const max = value.length <= 5 ? 1 : 2;
  let best=null, bestD=99;
  const first=value[0];
  for (const item of set) {
    if (item[0] !== first) continue;
    const d = distance(value, item);
    if (d < bestD) { bestD=d; best=item; if (d===1) break; }
  }
  return bestD <= max ? best : null;
}
function singular(v) {
  if (v.endsWith('ies')) return v.slice(0,-3)+'y';
  if (v.endsWith('es')) return v.slice(0,-2);
  if (v.endsWith('s') && v.length > 3) return v.slice(0,-1);
  return v;
}
function validate(category, raw, letter) {
  const v = norm(raw);
  if (!v) return { ok:false, canonical:'', typo:false, reason:'Blank answer' };
  if (v[0] !== letter.toLowerCase()) return { ok:false, canonical:v, typo:false, reason:`Must start with ${letter}` };
  if (category === 'place' && bannedPlaceWords.some(w => v.includes(w))) return { ok:false, canonical:v, typo:false, reason:'Shops, streets, buildings and venues do not count as places' };
  const set = DB[category];
  if (set.has(v)) return { ok:true, canonical:v, typo:false, reason:'Valid answer' };
  if (category === 'object' && set.has(singular(v))) return { ok:true, canonical:singular(v), typo:false, reason:'Valid plural object' };
  const near = fuzzyFind(v,set);
  if (near) return { ok:true, canonical:near, typo:true, reason:`Spelling accepted as ${title(near)}` };
  // Place fallback: accept plausible geographic names rather than being overly strict.
  if (category === 'place' && /^[a-z][a-z' -]{2,}$/.test(v) && !bannedPlaceWords.some(w => v.includes(w))) {
    return { ok:true, canonical:v, typo:false, reason:'Accepted as plausible geographic place; challenge if wrong' };
  }
  return { ok:false, canonical:v, typo:false, reason: category==='object' ? 'Must be a proper physical object you can touch' : `Not a recognised ${category}` };
}

const rooms = new Map();
function makeRoomCode(){ let c; do { c = Math.random().toString(36).slice(2,6).toUpperCase(); } while(rooms.has(c)); return c; }
function publicRoom(room){ return { code:room.code, hostId:room.hostId, status:room.status, letter:room.letter, usedLetters:[...room.usedLetters], players:[...room.players.values()].map(p=>({id:p.id,name:p.name,score:p.score})), results:room.results, challenges:room.challenges, final:room.final }; }
function emitRoom(room){ io.to(room.code).emit('room:update', publicRoom(room)); }
function scoreRound(room){
  const submissions = [...room.players.values()].map(p=>({player:p, answers:p.answers||{}}));
  const validations = {};
  const counts = { name:{}, animal:{}, place:{}, object:{} };
  for (const {player,answers} of submissions) {
    validations[player.id]={};
    for (const cat of ['name','animal','place','object']) {
      const val = validate(cat, answers[cat]||'', room.letter);
      validations[player.id][cat]=val;
      if (val.ok) counts[cat][val.canonical]=(counts[cat][val.canonical]||0)+1;
    }
  }
  room.results=[];
  for (const {player,answers} of submissions) {
    const rows=[]; let total=0;
    for (const cat of ['name','animal','place','object']) {
      const val=validations[player.id][cat];
      let points=0;
      if (val.ok) {
        const base = counts[cat][val.canonical] > 1 ? 5 : 10;
        points = val.typo ? Math.max(0, base-1) : base;
      }
      total += points;
      rows.push({category:cat, answer:answers[cat]||'', canonical:val.canonical, ok:val.ok, typo:val.typo, reason:val.reason, points});
    }
    player.score += total;
    room.results.push({playerId:player.id, name:player.name, total, rows});
  }
}

io.on('connection', socket => {
  socket.on('room:create', name => {
    const code=makeRoomCode();
    const room={code, hostId:socket.id, status:'lobby', letter:null, usedLetters:new Set(), players:new Map(), results:[], challenges:[], final:false};
    room.players.set(socket.id,{id:socket.id,name:name||'Host',score:0,answers:{}});
    rooms.set(code, room); socket.join(code); socket.data.room=code; io.to(socket.id).emit('room:created', code); emitRoom(room);
  });
  socket.on('room:join', ({code,name}) => {
    code=String(code||'').toUpperCase(); const room=rooms.get(code); if(!room) return io.to(socket.id).emit('error:msg','Room not found');
    room.players.set(socket.id,{id:socket.id,name:name||'Player',score:0,answers:{}}); socket.join(code); socket.data.room=code; emitRoom(room);
  });
  socket.on('round:start', () => {
    const room=rooms.get(socket.data.room); if(!room || room.hostId!==socket.id) return;
    const pool=LETTERS.filter(l=>!room.usedLetters.has(l)); if(!pool.length) return io.to(socket.id).emit('error:msg','All letters used. End game or reset.');
    room.letter=pool[Math.floor(Math.random()*pool.length)]; room.usedLetters.add(room.letter); room.status='playing'; room.results=[]; room.challenges=[]; room.final=false;
    for (const p of room.players.values()) p.answers={}; emitRoom(room);
  });
  socket.on('answer:update', answers => { const room=rooms.get(socket.data.room); if(!room) return; const p=room.players.get(socket.id); if(!p) return; p.answers=Object.assign({}, p.answers, answers); emitRoom(room); });
  socket.on('rush', () => { const room=rooms.get(socket.data.room); if(!room || room.status!=='playing') return; room.status='rush'; emitRoom(room); io.to(room.code).emit('rush:start', {seconds:5}); setTimeout(()=>{ if(room.status==='rush'){ room.status='results'; scoreRound(room); emitRoom(room); }}, 5000); });
  socket.on('round:score', () => { const room=rooms.get(socket.data.room); if(!room || room.hostId!==socket.id) return; room.status='results'; scoreRound(room); emitRoom(room); });
  socket.on('challenge:create', ({playerId,category}) => { const room=rooms.get(socket.data.room); if(!room) return; const result=room.results.find(r=>r.playerId===playerId); if(!result) return; const row=result.rows.find(r=>r.category===category); if(!row) return; const challenger=room.players.get(socket.id); const ch={id:Date.now()+Math.random(), challengerId:socket.id, challengerName:challenger?.name||'Player', playerId, playerName:result.name, category, answer:row.answer, count:[], reject:[], open:true}; room.challenges.unshift(ch); emitRoom(room); io.to(room.code).emit('challenge:popup', ch); });
  socket.on('challenge:vote', ({id,vote}) => { const room=rooms.get(socket.data.room); if(!room) return; const ch=room.challenges.find(c=>String(c.id)===String(id)); if(!ch || !ch.open || ch.challengerId===socket.id) return; ch.count=ch.count.filter(x=>x!==socket.id); ch.reject=ch.reject.filter(x=>x!==socket.id); if(vote==='count') ch.count.push(socket.id); if(vote==='reject') ch.reject.push(socket.id); emitRoom(room); });
  socket.on('game:end', () => { const room=rooms.get(socket.data.room); if(!room || room.hostId!==socket.id) return; if(room.status==='playing'||room.status==='rush') scoreRound(room); room.status='ended'; room.final=true; emitRoom(room); });
  socket.on('disconnect', () => { const room=rooms.get(socket.data.room); if(!room) return; room.players.delete(socket.id); if(!room.players.size) rooms.delete(room.code); else { if(room.hostId===socket.id) room.hostId=room.players.keys().next().value; emitRoom(room); } });
});

server.listen(PORT, '0.0.0.0', () => console.log(`Category Rush running on port ${PORT}`));
