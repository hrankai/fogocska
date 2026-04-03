// --- FIREBASE CONFIGURATION ---
const firebaseConfig = {
    databaseURL: "https://catch-19bbe-default-rtdb.firebaseio.com/" 
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const db = firebase.database();

const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
function playRadarPing() {
    if(audioCtx.state === 'suspended') audioCtx.resume();
    const osc = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(800, audioCtx.currentTime);
    gainNode.gain.setValueAtTime(0.3, audioCtx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.5);
    osc.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.5);
}

function playCatchSound() {
    if(audioCtx.state === 'suspended') audioCtx.resume();
    const osc = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(200, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(40, audioCtx.currentTime + 1);
    gainNode.gain.setValueAtTime(1, audioCtx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 1);
    osc.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 1);
}

// Sync global user stats
db.ref('users').on('value', (snap) => {
    state.userStats = snap.val() || {};
    if (state.map && typeof updateMarkers === 'function') {
        updateMarkers();
    }
});

// --- GAME STATE ---
const state = {
    userId: null,
    user: null,
    players: {}, 
    markers: {}, 
    map: null,
    radarMap: null,
    radarMarkers: {},
    myMarker: null,
    watchId: null,
    isCaught: false,
    gameId: null,
    gameBounds: null, // L.latLngBounds
    tempBounds: [], // Clicked points for creation
    tempRect: null, // Visual rectangle
    createMap: null,
    tempRectCreate: null,
    userStats: {},
    firstTrackDone: false
};

// --- INITIALIZE MAP ---
function initMap(lat, lon) {
    if (state.map) return;
    state.map = L.map('map', {
        zoomControl: false,
        attributionControl: false
    }).setView([lat, lon], 18);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(state.map);

    // Initialize Radar
    initRadar(lat, lon);
}

function initRadar(lat, lon) {
    if (state.radarMap) return;
    state.radarMap = L.map('radar-map', {
        zoomControl: false,
        attributionControl: false,
        dragging: false,
        touchZoom: false,
        scrollWheelZoom: false,
        doubleClickZoom: false,
        boxZoom: false
    }).setView([lat, lon], 16); // Fixed zoom for radar

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(state.radarMap);
}

function updateRadar(lat, lon) {
    if (!state.radarMap) return;
    state.radarMap.setView([lat, lon], 16);
}

// --- GPS LOGIC ---
let updateInterval = null;
function startTracking() {
    if (!navigator.geolocation) return;

    state.watchId = navigator.geolocation.watchPosition(
        (pos) => {
            const { latitude, longitude } = pos.coords;
            updateMyPosition(latitude, longitude);
        },
        (err) => console.error(err),
        { enableHighAccuracy: true }
    );
    
    if (!updateInterval) {
        updateInterval = setInterval(() => {
            if (state.map && state.userId) updateMarkers();
        }, 1000);
    }
}

let lastUpdateTime = 0;

function updateMyPosition(lat, lon) {
    // 1. Update local state
    if (state.user) {
        state.user.lat = lat;
        state.user.lon = lon;
    }

    // 2. Update Map view locally
    if (state.map) {
        if (!state.firstTrackDone) {
            state.firstTrackDone = true;
            state.map.setView([lat, lon], 18);
        }
        
        if (!state.myMarker) {
            const icon = createIcon(state.user.role, true);
            state.myMarker = L.marker([lat, lon], { icon }).addTo(state.map);
        } else {
            state.myMarker.setLatLng([lat, lon]);
        }
    }

    // 3. Sync to Firebase (throttled to every 2 seconds)
    const now = Date.now();
    if (state.userId && state.gameId && (now - lastUpdateTime > 2000)) {
        lastUpdateTime = now;
        db.ref(`games/${state.gameId}/players/${state.userId}`).update({
            lat: lat,
            lon: lon,
            lastSeen: now
        });
    }

    // 4. Update Radar
    updateRadar(lat, lon);

    // 5. Check Boundary
    checkBoundary(lat, lon);
}

function checkBoundary(lat, lon) {
    if (!state.gameBounds) return;
    const isInside = state.gameBounds.contains([lat, lon]);
    const overlay = document.getElementById('boundary-overlay');
    if (isInside) {
        overlay.classList.add('hidden');
    } else {
        overlay.classList.remove('hidden');
    }
}

function createIcon(role, isMe) {
    const color = role === 'chaser' ? '#ff0055' : '#00f2ff';
    const size = isMe ? 24 : 18;
    return L.divIcon({
        className: 'custom-marker',
        html: `<div style="background: ${color}; width: ${size}px; height: ${size}px; border-radius: 50%; border: 3px solid white; box-shadow: 0 0 10px ${color};"></div>`
    });
}

// --- MULTIPLAYER SYNC ---
function syncPlayers() {
    if (!state.gameId) return;
    const playersRef = db.ref(`games/${state.gameId}/players`);
    
    playersRef.on('value', (snapshot) => {
        const data = snapshot.val() || {};
        state.players = data;
        updateMarkers();
        checkProximity();
        
        const count = Object.keys(data).length;
        document.getElementById('player-count').innerText = `${count} Játékos online`;
    });
}

// --- UI EVENT LISTENERS ---
function setupEventListeners() {
    // Logout
    document.getElementById('logout-btn').addEventListener('click', handleLogout);

    // Locate Me
    document.getElementById('locate-me').addEventListener('click', () => {
        if (state.user && state.user.lat) {
            state.map.setView([state.user.lat, state.user.lon], 18);
        }
    });

    // Restart (after catch)
    document.getElementById('restart-btn').addEventListener('click', resetGame);

    const robotBtn = document.getElementById('spawn-robot');
    if (robotBtn) {
        robotBtn.addEventListener('click', toggleRobot);
    }
}

function toggleSessionMode(mode) {
    const joinBtn = document.getElementById('mode-join');
    const createBtn = document.getElementById('mode-create');
    const joinSec = document.getElementById('join-section');
    const createSec = document.getElementById('create-section');

    if (mode === 'join') {
        joinBtn.classList.add('active');
        createBtn.classList.remove('active');
        joinSec.classList.remove('hidden');
        createSec.classList.add('hidden');
    } else {
        joinBtn.classList.remove('active');
        createBtn.classList.add('active');
        joinSec.classList.add('hidden');
        createSec.classList.remove('hidden');
        
        // Enable boundary drawing mode if map exists
        if (!state.createMap) {
            getInitialLocation().then(pos => {
                state.createMap = L.map('mini-map', {
                    zoomControl: true,
                    attributionControl: false
                }).setView([pos.lat, pos.lon], 16);
                
                L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(state.createMap);
                
                // Show my physical position on the creation map
                const myMiniIcon = L.divIcon({
                    className: 'custom-marker',
                    html: `<div style="background: #00f2ff; width: 16px; height: 16px; border-radius: 50%; border: 2px solid white; box-shadow: 0 0 10px #00f2ff;"></div>`
                });
                L.marker([pos.lat, pos.lon], { icon: myMiniIcon }).addTo(state.createMap).bindPopup("Te itt vagy!");
                
                setTimeout(() => {
                    state.createMap.invalidateSize();
                }, 200);

                setupCreateBoundaryDrawing();
            });
        } else {
            setTimeout(() => {
                state.createMap.invalidateSize();
            }, 200);
        }
    }
}

function listAvailableGames() {
    db.ref('games').on('value', (snapshot) => {
        const games = snapshot.val() || {};
        const list = document.getElementById('game-list');
        if (list) list.innerHTML = '<option value="">Válassz egy szobát...</option>';
        
        const now = Date.now();
        
        for (let id in games) {
            const g = games[id];
            
            // Garbage Collection: Delete game if no players are inside AND it is older than 15 seconds
            if (!g.players && (now - (g.createdAt || 0) > 15000)) {
                db.ref(`games/${id}`).remove();
                continue;
            }
            
            if (list) {
                const opt = document.createElement('option');
                opt.value = id;
                opt.innerText = games[id].name || id;
                list.appendChild(opt);
            }
        }
    });
}

function setupCreateBoundaryDrawing() {
    state.tempRectCreate = null;
    state.createMap.on('click', (e) => {
        if (state.tempBounds.length >= 2) {
            state.tempBounds = [];
            if (state.tempRectCreate) state.createMap.removeLayer(state.tempRectCreate);
        }
        
        state.tempBounds.push([e.latlng.lat, e.latlng.lng]);
        
        if (state.tempBounds.length === 2) {
            state.gameBounds = L.latLngBounds(state.tempBounds);
            state.tempRectCreate = L.rectangle(state.gameBounds, { color: "#00f2ff", weight: 2, fillOpacity: 0.2 }).addTo(state.createMap);
        }
    });
}

function handleLogout() {
    if (state.userId && state.gameId) {
        db.ref(`games/${state.gameId}/players/${state.userId}`).remove();
    }
    if (state.watchId) {
        navigator.geolocation.clearWatch(state.watchId);
    }
    
    // Reset state
    state.userId = null;
    state.user = null;
    state.isCaught = false;
    state.gameId = null;
    state.gameBounds = null;
    if (state.tempRect) {
        state.map.removeLayer(state.tempRect);
        state.tempRect = null;
    }
    if (state.tempRectCreate && state.createMap) {
        state.createMap.removeLayer(state.tempRectCreate);
        state.tempRectCreate = null;
    }
    state.tempBounds = [];
    
    if (state.myMarker) {
        state.map.removeLayer(state.myMarker);
        state.myMarker = null;
    }
    
    // UI reset
    document.getElementById('game-view').classList.add('hidden');
    document.getElementById('auth-view').classList.remove('hidden');
    document.getElementById('game-overlay').classList.add('hidden');
    document.getElementById('boundary-overlay').classList.add('hidden');
    
    const submitBtn = document.querySelector('#login-form button');
    submitBtn.innerText = "Belépés a Játékba";
    submitBtn.disabled = false;

    stopRobot();
}

function resetGame() {
    console.log("Resetting game...");
    state.isCaught = false;
    document.getElementById('game-overlay').classList.add('hidden');
    
    // Add a small delay to ensure the UI update is visible before any Firebase trigger
    setTimeout(() => {
        if (state.userId && state.gameId) {
            db.ref(`games/${state.gameId}/players/${state.userId}`).update({ status: 'active' });
        }
        stopRobot();
        startGracePeriod();
    }, 100);
}

function updateMarkers() {
    if (!state.user || !state.user.lat) return;
    
    let newlyScannedChaser = false;
    const now = Date.now();
    
    // Cleanup disconnected players (not seen for > 30s)
    for (let id in state.markers) {
        if (!state.players[id] || (now - state.players[id].lastSeen > 30000)) {
            state.map.removeLayer(state.markers[id]);
            delete state.markers[id];
        }
    }

    for (let id in state.players) {
        if (id === state.userId) continue;

        const p = state.players[id];
        if (!p.lat || !p.lon) continue;
        
        let statsText = "";
        if (state.userStats && state.userStats[p.name] && state.userStats[p.name].catches !== undefined) {
            statsText = ` (Elkapások: ${state.userStats[p.name].catches})`;
        }
        const popupText = p.name + statsText;

        const dist = getDistance(state.user.lat, state.user.lon, p.lat, p.lon);
        let isVisibleOnMap = true;
        
        // 1. Chasers only flash on the map for 3s every 15s
        if (p.role === 'chaser') {
            const cycleTime = now % 15000;
            if (cycleTime > 3000) {
                isVisibleOnMap = false;
            }
        }
        
        // 2. Runners are invisible if distance > 10m
        if (p.role === 'runner') {
            if (dist > 10) {
                isVisibleOnMap = false;
            }
        }

        if (isVisibleOnMap) {
            if (!state.markers[id]) {
                const icon = createIcon(p.role, false);
                state.markers[id] = L.marker([p.lat, p.lon], { icon }).addTo(state.map).bindPopup(popupText);
            } else {
                state.markers[id].setLatLng([p.lat, p.lon]);
                state.markers[id].setPopupContent(popupText);
            }
        } else {
            if (state.markers[id]) {
                state.map.removeLayer(state.markers[id]);
                delete state.markers[id];
            }
        }
        
        // Radar logic
        if (state.radarMap) {
            const shouldShowRadar = dist > 50 && dist < 500;
            if (shouldShowRadar) {
                if (!state.radarMarkers[id]) {
                    const iconColor = p.role === 'chaser' ? '#ff0055' : '#00f2ff';
                    const icon = L.divIcon({
                        className: 'radar-dot',
                        html: `<div style="background: ${iconColor}; width: 8px; height: 8px; border-radius: 50%; box-shadow: 0 0 10px ${iconColor};"></div>`
                    });
                    state.radarMarkers[id] = L.marker([p.lat, p.lon], { icon }).addTo(state.radarMap);
                    
                    if (p.role === 'chaser' && state.user.role === 'runner') {
                        newlyScannedChaser = true;
                    }
                } else {
                    state.radarMarkers[id].setLatLng([p.lat, p.lon]);
                }
            } else {
                if (state.radarMarkers[id]) {
                    state.radarMap.removeLayer(state.radarMarkers[id]);
                    delete state.radarMarkers[id];
                }
            }
        }
    }
    
    if (newlyScannedChaser) {
        playRadarPing();
    }
}

// --- PWA INSTALL LOGIC ---
let deferredPrompt;
window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    const installBtn = document.getElementById('install-btn');
    if (installBtn) installBtn.classList.remove('hidden');
});

const installBtn = document.getElementById('install-btn');
if (installBtn) {
    installBtn.addEventListener('click', async () => {
        if (deferredPrompt) {
            deferredPrompt.prompt();
            const { outcome } = await deferredPrompt.userChoice;
            console.log(`PWA install prompt answer: ${outcome}`);
            deferredPrompt = null;
        } else {
            alert("Ide kattintva magától szokott települni, de a te rendszered ezt most blokkolja (talán mert egy gépen / nem megfelelő linken nyitottad meg, vagy már telepítve van a telefonodon)!\n\nMEGOLDÁS TELEFONON: Nyisd meg a Böngésződ jobb felső/alsó menüjét, és válaszd a 'Hozzáadás a kezdőképernyőhöz' (Add to Home screen) opciót! Ezzel kipattintja appként!");
        }
    });
}
let gameStartTime = 0;

function checkProximity() {
    const now = Date.now();
    const graceElapsed = Math.floor((now - gameStartTime) / 1000);
    
    // Debug updates
    document.getElementById('debug-id').innerText = state.userId ? state.userId.substr(-4) : '-';
    document.getElementById('debug-grace').innerText = 5 - graceElapsed > 0 ? 5 - graceElapsed : 0;

    if (!state.userId || !state.players[state.userId] || state.isCaught) return;
    if (now - gameStartTime < 5000) return; 

    const me = state.players[state.userId];
    if (me.role !== 'runner') return;
    if (!me.lat || !me.lon) return;

    let nearestDist = 9999;

    for (let id in state.players) {
        if (id === state.userId) continue;

        const p = state.players[id];
        if (p.role === 'chaser' && p.lat && p.lon && (now - p.lastSeen < 30000)) {
            const dist = getDistance(me.lat, me.lon, p.lat, p.lon);
            if (dist < nearestDist) nearestDist = dist;

            if (me.lat === 0 || me.lon === 0 || p.lat === 0 || p.lon === 0) continue;

            // GPS szórás kompenzálása: 4 méter a gyakorlatban az "egymás mellett állást" jelenti
            if (dist <= 4) { 
                triggerCatch(id);
                break;
            }
        }
    }
    document.getElementById('debug-nearest').innerText = nearestDist === 9999 ? '∞' : nearestDist.toFixed(1);
}

function getDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3;
    const φ1 = lat1 * Math.PI/180;
    const φ2 = lat2 * Math.PI/180;
    const Δφ = (lat2-lat1) * Math.PI/180;
    const Δλ = (lon2-lon1) * Math.PI/180;
    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ/2) * Math.sin(Δλ/2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function triggerCatch(chaserId) {
    state.isCaught = true;
    document.getElementById('game-overlay').classList.remove('hidden');
    playCatchSound();

    if (state.userId && state.gameId) {
        db.ref(`games/${state.gameId}/players/${state.userId}`).update({ status: 'caught' });
    }
    
    // Save catches dynamically to the overall user profile if chaser found
    if (chaserId && state.players[chaserId] && state.players[chaserId].name) {
        const chaserName = state.players[chaserId].name;
        db.ref(`users/${chaserName}/catches`).set(firebase.database.ServerValue.increment(1));
    }
    
    stopRobot();
}

// --- VIRTUAL ROBOT LOGIC ---
let robotId = null;
let robotInterval = null;

function toggleRobot() {
    if (robotId) {
        stopRobot();
    } else {
        spawnRobot();
    }
}

function spawnRobot() {
    if (!state.user || !state.user.lat) return;
    
    robotId = 'robot_' + Math.random().toString(36).substr(2, 5);
    const btn = document.getElementById('spawn-robot');
    if (btn) btn.innerText = "Robot Törlése";

    // Spawn ~25m away (approx 0.0002 degrees)
    let rLat = state.user.lat + 0.0002;
    let rLon = state.user.lon + 0.0002;

    const robotData = {
        name: "🤖 Teszt Robot",
        role: "chaser",
        lat: rLat,
        lon: rLon,
        lastSeen: Date.now(),
        status: 'active'
    };

    db.ref(`games/${state.gameId}/players/${robotId}`).set(robotData);

    robotInterval = setInterval(() => {
        if (!state.user || state.isCaught) {
            stopRobot();
            return;
        }

        // Move 2m closer every second
        // 1m is roughly 0.000009 degrees
        const step = 0.000015; 
        const dLat = state.user.lat - rLat;
        const dLon = state.user.lon - rLon;
        const dist = Math.sqrt(dLat*dLat + dLon*dLon);

        if (dist > step) {
            rLat += (dLat / dist) * step;
            rLon += (dLon / dist) * step;
        }

        db.ref(`games/${state.gameId}/players/${robotId}`).update({
            lat: rLat,
            lon: rLon,
            lastSeen: Date.now()
        });
    }, 1000);
}

function stopRobot() {
    if (robotId && state.gameId) {
        db.ref(`games/${state.gameId}/players/${robotId}`).remove();
        robotId = null;
    }
    if (robotInterval) {
        clearInterval(robotInterval);
        robotInterval = null;
    }
    const btn = document.getElementById('spawn-robot');
    if (btn) btn.innerText = "Robot Indítása";
}

// --- AUTH ---
document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = e.target.querySelector('button[type="submit"]');
    submitBtn.innerText = "GPS adatok lekérése...";
    submitBtn.disabled = true;

    try {
        const pos = await getInitialLocation();
        const role = document.querySelector('input[name="role"]:checked').value;
        const name = document.getElementById('username').value;
        
        // Game Session Selection
        const mode = document.getElementById('mode-create').classList.contains('active') ? 'create' : 'join';
        if (mode === 'join') {
            state.gameId = document.getElementById('game-list').value;
            if (!state.gameId) throw new Error("Válassz egy szobát!");
            
            // Get bounds from firebase
            const gSnap = await db.ref(`games/${state.gameId}`).once('value');
            const gData = gSnap.val();
            if (gData && gData.bounds) {
                state.gameBounds = L.latLngBounds([[gData.bounds.n, gData.bounds.e], [gData.bounds.s, gData.bounds.w]]);
            }
        } else {
            const gameName = document.getElementById('new-game-name').value;
            if (!gameName) throw new Error("Adj meg egy nevet a szobának!");
            if (!state.gameBounds) throw new Error("Jelöld ki a határokat a térképen!");
            if (!state.gameBounds.contains([pos.lat, pos.lon])) throw new Error("Hiba: A kijelölt pályának tartalmaznia kell a jelenlegi pozíciódat, különben kapásból elkapnak!");
            
            state.gameId = 'game_' + Math.random().toString(36).substr(2, 5);
            const boundsObj = {
                n: state.gameBounds.getNorth(),
                s: state.gameBounds.getSouth(),
                e: state.gameBounds.getEast(),
                w: state.gameBounds.getWest()
            };
            await db.ref(`games/${state.gameId}`).set({
                name: gameName,
                bounds: boundsObj,
                createdAt: Date.now()
            });
        }

        state.userId = 'user_' + Math.random().toString(36).substr(2, 9);
        state.user = { name, role, lat: pos.lat, lon: pos.lon, lastSeen: Date.now() };
        gameStartTime = Date.now();

        // Save to Firebase
        await db.ref(`games/${state.gameId}/players/${state.userId}`).set(state.user);

        // UI Update
        document.getElementById('display-name').innerText = name;
        document.getElementById('display-role').innerText = role === 'runner' ? 'MENEKÜLŐ' : 'FOGÓ';
        document.getElementById('display-role').className = `role-chip ${role}`;
        document.getElementById('auth-view').classList.add('hidden');
        document.getElementById('game-view').classList.remove('hidden');

        initMap(pos.lat, pos.lon);
        
        // Game joining logic...
        if (state.gameBounds) {
            L.rectangle(state.gameBounds, { color: "#00f2ff", weight: 2, fillOpacity: 0.1, dashArray: '5, 5' }).addTo(state.map);
        }

        startTracking();
        syncPlayers();
        setupEventListeners();
        startGracePeriod();

        // Handle disconnect
        db.ref(`games/${state.gameId}/players/${state.userId}`).onDisconnect().remove();

    } catch (err) {
        alert(err.message || "Sikertelen belépés. Kérlek engedélyezd a GPS-t!");
        submitBtn.innerText = "Belépés a Játékba";
        submitBtn.disabled = false;
    }
});

function getInitialLocation() {
    return new Promise((resolve) => {
        if (!navigator.geolocation) {
            console.warn("Geolocation not supported. Using fallback.");
            resolve({ lat: 47.4979, lon: 19.0402 }); // Budapest
            return;
        }

        navigator.geolocation.getCurrentPosition(
            (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
            (err) => {
                console.warn("Geolocation error:", err.message, "Using fallback.");
                resolve({ lat: 47.4979, lon: 19.0402 });
            },
            { enableHighAccuracy: true, timeout: 15000 }
        );
    });
}

function startGracePeriod() {
    const overlay = document.getElementById('grace-overlay');
    if (!overlay) return;
    const label = document.getElementById('grace-countdown');
    overlay.classList.remove('hidden');
    let timeLeft = 5;
    label.innerText = timeLeft;
    
    gameStartTime = Date.now();
    
    startSurvivalScoring();
    
    const interval = setInterval(() => {
        timeLeft--;
        if (timeLeft > 0) {
            label.innerText = timeLeft;
        } else {
            label.innerText = "START!";
            setTimeout(() => {
                overlay.classList.add('hidden');
            }, 1000);
            clearInterval(interval);
        }
    }, 1000);
}

// --- LEADERBOARD ---
document.getElementById('leaderboard-btn').addEventListener('click', () => {
    document.getElementById('leaderboard-modal').classList.remove('hidden');
    loadLeaderboard();
});

document.getElementById('close-leaderboard').addEventListener('click', () => {
    document.getElementById('leaderboard-modal').classList.add('hidden');
});

function loadLeaderboard() {
    const list = document.getElementById('leaderboard-list');
    list.innerHTML = '<li>Betöltés...</li>';
    
    db.ref('users').once('value', (snap) => {
        const users = snap.val() || {};
        const chasers = [];
        for (let name in users) {
             const u = users[name];
             if (u.catches) {
                 chasers.push({ name: name, catches: u.catches });
             }
        }
        
        chasers.sort((a, b) => b.catches - a.catches);
        
        list.innerHTML = '';
        if (chasers.length === 0) {
            list.innerHTML = '<li style="text-align:center; opacity:0.7;">Még nincs elkapás adat.</li>';
            return;
        }
        
        chasers.forEach((c, index) => {
            const li = document.createElement('li');
            li.className = 'leaderboard-item';
            let rankSymbol = (index + 1) + '.';
            if (index === 0) rankSymbol = '🥇';
            if (index === 1) rankSymbol = '🥈';
            if (index === 2) rankSymbol = '🥉';
            
            li.innerHTML = `
                <span class="leaderboard-rank">${rankSymbol}</span>
                <span class="leaderboard-name">${c.name}</span>
                <span class="leaderboard-score">${c.catches} db</span>
            `;
            list.appendChild(li);
        });
    });
}

// --- SURVIVAL SCORING ---
let survivalInterval = null;
function startSurvivalScoring() {
    if (survivalInterval) clearInterval(survivalInterval);
    if (!state.user || state.user.role !== 'runner') return;

    // 1 point for every minute survived
    survivalInterval = setInterval(() => {
        if (!state.isCaught && state.user.name) {
            db.ref(`users/${state.user.name}/survivalPoints`).set(firebase.database.ServerValue.increment(1));
            console.log("Survival point awarded!");
        }
    }, 60000);
}

// --- INITIALIZATION ---
document.getElementById('mode-join').addEventListener('click', () => toggleSessionMode('join'));
document.getElementById('mode-create').addEventListener('click', () => toggleSessionMode('create'));
listAvailableGames();
