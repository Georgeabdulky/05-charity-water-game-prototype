/* ============================================================
   GAME CODE
   ============================================================ */

// ---- Grab the elements we need ----
const area      = document.getElementById('area');
const can       = document.getElementById('can');
const scoreEl   = document.getElementById('score');
const wellsEl   = document.getElementById('wells');
const meterFill = document.getElementById('meterFill');
const meterTxt  = document.getElementById('meterTxt');
const livesEl   = document.getElementById('lives');
const toast     = document.getElementById('toast');
const banner    = document.getElementById('banner');
const flash     = document.getElementById('flash');
const startScreen = document.getElementById('startScreen');
const endScreen   = document.getElementById('endScreen');
const confettiCanvas = document.getElementById('confetti');
const cctx = confettiCanvas.getContext('2d');

// ---- Game settings (tweak these to change difficulty!) ----
const WELL_GOAL   = 25;   // clean drops needed to fund one well
const WELLS_TO_WIN = 3;   // fund this many wells to win
const START_LIVES = 3;

// ---- Game state ----
let score, lives, wellMeter, wellsFunded;
let items = [];           // all falling drops/cans currently on screen
let canX = 0;             // center x of the catcher (in pixels)
let running = false, paused = false;
let spawnTimer = 0, spawnGap = 900;   // ms between spawns
let lastTime = 0;
let muted = false;

// ---- Audio: tiny beeps made in code (no sound files needed) ----
let audioCtx = null;
function beep(freq, dur, type='sine', vol=0.08){
  if(muted || !audioCtx) return;
  const o = audioCtx.createOscillator(), g = audioCtx.createGain();
  o.type = type; o.frequency.value = freq;
  o.connect(g); g.connect(audioCtx.destination);
  g.gain.setValueAtTime(vol, audioCtx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + dur);
  o.start(); o.stop(audioCtx.currentTime + dur);
}

// ---- Helpers to read the play area size ----
const W = () => area.clientWidth;
const H = () => area.clientHeight;
function canW(){ return can.offsetWidth; }
function canH(){ return can.offsetHeight; }
function canTop(){ return H() - canH() - H()*0.12; }   // catcher's top edge (sits on the hills)

// ---- Draw the hearts for lives ----
function drawLives(){
  livesEl.innerHTML = '';
  for(let i=0;i<START_LIVES;i++){
    const svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
    svg.setAttribute('class','heart' + (i>=lives ? ' lost':''));
    svg.setAttribute('viewBox','0 0 24 24');
    svg.innerHTML = '<path d="M12 21s-7-4.6-9.3-9.1C1 8.6 3 5 6.4 5 8.6 5 10 6.6 12 9c2-2.4 3.4-4 5.6-4C21 5 23 8.6 21.3 11.9 19 16.4 12 21 12 21z" fill="#E64C3C"/>';
    livesEl.appendChild(svg);
  }
}

// ---- Update the HUD numbers ----
function updateHUD(){
  scoreEl.textContent = score;
  wellsEl.textContent = wellsFunded;
  meterTxt.textContent = wellMeter + ' / ' + WELL_GOAL;
  meterFill.style.width = (wellMeter / WELL_GOAL * 100) + '%';
}

// ---- Feedback: toast, floating text, splash, flash ----
let toastTimer;
function showToast(msg){
  toast.textContent = msg; toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=>toast.classList.remove('show'), 850);
}
function floatText(x, y, text, color){
  const f = document.createElement('div');
  f.className = 'float'; f.textContent = text; f.style.color = color;
  f.style.left = x + 'px'; f.style.top = y + 'px';
  area.appendChild(f);
  setTimeout(()=>f.remove(), 800);
}
function splash(x, y){
  const s = document.createElement('div');
  s.className = 'splash'; s.style.left = (x-17) + 'px'; s.style.top = (y-17) + 'px';
  area.appendChild(s);
  setTimeout(()=>s.remove(), 400);
}
function redFlash(){ flash.classList.remove('show'); void flash.offsetWidth; flash.classList.add('show'); }

// Real-time score feedback: the number pops and changes color
function pulseScore(dir){
  scoreEl.classList.remove('up','down'); void scoreEl.offsetWidth;
  scoreEl.classList.add(dir);
  setTimeout(()=>scoreEl.classList.remove(dir), 250);
}

// ---- Confetti celebration (canvas) for winning ----
let confetti = [], confettiOn = false;
function launchConfetti(){
  if(window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  confettiCanvas.width = area.clientWidth;
  confettiCanvas.height = area.clientHeight;
  const colors = ['#FFC907','#2E9DF7','#003366','#ffffff','#69a52f'];
  confetti = [];
  for(let i=0;i<150;i++){
    confetti.push({
      x: Math.random()*confettiCanvas.width,
      y: -20 - Math.random()*confettiCanvas.height,
      r: 4 + Math.random()*7,
      c: colors[Math.floor(Math.random()*colors.length)],
      vx: -1.5 + Math.random()*3, vy: 2 + Math.random()*3.5,
      rot: Math.random()*6.28, vr: -0.2 + Math.random()*0.4
    });
  }
  if(!confettiOn){ confettiOn = true; requestAnimationFrame(confettiLoop); }
  setTimeout(()=>{ confettiOn = false; }, 3000);
}
function confettiLoop(){
  cctx.clearRect(0,0,confettiCanvas.width,confettiCanvas.height);
  confetti.forEach(p=>{
    p.x += p.vx; p.y += p.vy; p.rot += p.vr;
    cctx.save(); cctx.translate(p.x,p.y); cctx.rotate(p.rot);
    cctx.fillStyle = p.c; cctx.fillRect(-p.r/2, -p.r/2, p.r, p.r*0.6); cctx.restore();
  });
  if(confettiOn) requestAnimationFrame(confettiLoop);
  else cctx.clearRect(0,0,confettiCanvas.width,confettiCanvas.height);
}

let bannerTimer;
function showBanner(msg){
  banner.textContent = msg; banner.classList.add('show');
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(()=>banner.classList.remove('show'), 1400);
}

// ---- Spawn a new falling item ----
function spawn(){
  // Pick a type: 70% clean, 22% bad, 8% bonus
  const r = Math.random();
  let type = r < 0.70 ? 'clean' : (r < 0.92 ? 'bad' : 'bonus');

  const el = document.createElement('div');
  el.className = 'item ' + type;
  el.innerHTML = (type === 'bonus') ? '<div class="can-mini"></div>' : '<div class="drop-shape"></div>';
  area.appendChild(el);

  const w = el.offsetWidth || 28, h = el.offsetHeight || 28;
  const x = Math.random() * (W() - w - 20) + 10;
  // Fall speed gets a little faster as you fund more wells
  const speed = (0.12 + Math.random() * 0.07) * (1 + wellsFunded * 0.15); // px per ms

  const it = { el, x, y: -h, w, h, vy: speed, type };
  // Click / tap an item to collect it directly
  el.addEventListener('pointerdown', e=>{
    e.stopPropagation();
    if(!running || paused) return;
    handleCatch(it);
  });
  items.push(it);
  el.style.transform = `translate(${x}px, ${-h}px)`;
}

// Safely collect an item once (whether by click or by the catcher)
function handleCatch(it){
  const idx = items.indexOf(it);
  if(idx === -1) return;          // already collected this one
  items.splice(idx, 1);
  it.el.remove();
  collect(it);
}

// ---- Handle a caught item ----
function collect(item){
  const cx = item.x + item.w/2, cy = item.y + item.h/2;
  if(item.type === 'clean'){
    score += 10; wellMeter++;
    floatText(item.x, item.y, '+10', '#1C7BD4'); splash(cx, cy); beep(660,0.12);
    pulseScore('up'); showToast('Nice catch! +10');
  } else if(item.type === 'bonus'){
    score += 25; wellMeter += 3;
    floatText(item.x, item.y, '+25', '#E6B400'); splash(cx, cy);
    beep(620,0.1); setTimeout(()=>beep(880,0.12),90);
    pulseScore('up'); showToast('Bonus can! +25');
  } else { // muddy drop = obstacle that REDUCES the score (LevelUp challenge)
    score = Math.max(0, score - 5); lives--; drawLives(); redFlash();
    floatText(item.x, item.y, '−5', '#E64C3C'); pulseScore('down');
    beep(150,0.22,'square',0.12); showToast('Spill! −5 points');
  }
  // bobbing animation on the can
  can.style.setProperty('--cx', (canX - canW()/2) + 'px');
  can.classList.remove('catch'); void can.offsetWidth; can.classList.add('catch');

  // Did we just fund a well?
  if(wellMeter >= WELL_GOAL){
    wellMeter -= WELL_GOAL;
    wellsFunded++;
    advanceVillage();
    showBanner('💧 You funded a well!');
    beep(523,0.12); setTimeout(()=>beep(659,0.12),110); setTimeout(()=>beep(784,0.16),220);
  }
  updateHUD();

  // Win / lose checks
  if(wellsFunded >= WELLS_TO_WIN) return endGame(true);
  if(lives <= 0) return endGame(false);
}

// ---- Make the village greener + reveal props ----
function advanceVillage(){
  const stage = Math.min(wellsFunded, 3);
  area.dataset.stage = stage;
  if(stage >= 1) document.querySelector('.well').classList.add('show');
  if(stage >= 1) document.querySelector('.hut').classList.add('show');
  if(stage >= 2) document.querySelector('.tree').classList.add('show');
}

// ============================================================
//  THE MAIN GAME LOOP
// ============================================================
function loop(now){
  if(!running){ return; }
  requestAnimationFrame(loop);
  const dt = Math.min(now - lastTime, 50); // ms since last frame (capped)
  lastTime = now;
  if(paused) return;

  // Spawn new items on a timer that speeds up with your score
  spawnTimer += dt;
  spawnGap = Math.max(380, 900 - score * 1.2);
  if(spawnTimer >= spawnGap){ spawnTimer = 0; spawn(); }

  const top = canTop();
  const left = canX - canW()/2, right = canX + canW()/2;

  // Move every item down and check for catches / misses
  for(let i = items.length - 1; i >= 0; i--){
    const it = items[i];
    it.y += it.vy * dt;
    it.el.style.transform = `translate(${it.x}px, ${it.y}px)` + (it.type==='bonus' ? '' : '');

    const itLeft = it.x, itRight = it.x + it.w, itBottom = it.y + it.h;

    // Caught by the can?
    if(itBottom >= top && it.y <= top + canH() && itRight >= left && itLeft <= right){
      handleCatch(it);
      continue;
    }
    // Fell past the bottom?
    if(it.y > H()){ it.el.remove(); items.splice(i,1); }
  }
}

// ---- Move the catcher ----
function setCanX(px){
  canX = Math.max(canW()/2, Math.min(W() - canW()/2, px));
  can.style.transform = `translateX(${canX - canW()/2}px)`;
}

// Mouse + touch: the can follows your pointer across the play area
area.addEventListener('pointermove', e=>{
  if(!running || paused) return;
  const rect = area.getBoundingClientRect();
  setCanX(e.clientX - rect.left);
});
// Keyboard: arrow keys nudge the can
window.addEventListener('keydown', e=>{
  if(!running || paused) return;
  if(e.key === 'ArrowLeft')  setCanX(canX - W()*0.06);
  if(e.key === 'ArrowRight') setCanX(canX + W()*0.06);
});

// ============================================================
//  START / RESET / END
// ============================================================
function startGame(){
  // set up a fresh game
  score = 0; lives = START_LIVES; wellMeter = 0; wellsFunded = 0;
  items.forEach(it=>it.el.remove()); items = [];
  area.dataset.stage = 0;
  document.querySelectorAll('.prop').forEach(p=>p.classList.remove('show'));
  drawLives(); updateHUD();
  setCanX(W()/2);

  startScreen.classList.add('hidden');
  endScreen.classList.add('hidden');

  // unlock audio on this user click
  if(!audioCtx){ try{ audioCtx = new (window.AudioContext||window.webkitAudioContext)(); }catch(e){} }

  running = true; paused = false;
  spawnTimer = 0; lastTime = performance.now();
  requestAnimationFrame(loop);
}

function endGame(won){
  running = false;
  items.forEach(it=>it.el.remove()); items = [];
  document.getElementById('endTitle').textContent = won ? 'You did it!' : 'Out of lives';
  document.getElementById('endMsg').textContent = won
    ? 'You funded clean water for the whole village. Every drop counted!'
    : 'The village still needs clean water. Give it another go!';
  document.getElementById('finalScore').textContent = score;
  document.getElementById('finalWells').textContent = wellsFunded;
  endScreen.classList.remove('hidden');
  if(won) launchConfetti();
}

// ---- Buttons ----
document.getElementById('startBtn').addEventListener('click', startGame);
document.getElementById('againBtn').addEventListener('click', startGame);
document.getElementById('resetBtn').addEventListener('click', startGame);
document.getElementById('muteBtn').addEventListener('click', e=>{
  muted = !muted; e.target.style.opacity = muted ? .4 : 1;
});
document.getElementById('pauseBtn').addEventListener('click', ()=>{
  if(!running) return;
  paused = !paused;
  showBanner(paused ? 'Paused' : 'Go!');
  if(!paused){ lastTime = performance.now(); }
});

// Keep the catcher in bounds if the window is resized
window.addEventListener('resize', ()=>{ if(running) setCanX(canX); });

// Draw initial hearts on the start screen
drawLives();