import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, collection, doc, setDoc, getDocs, onSnapshot } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
const appId = typeof __app_id !== 'undefined' ? __app_id : 'daechon-festival-2026';

let db = null;
let auth = null;
let currentUserId = null;
let booths = [];
let currentManagedBoothId = null;
let selectedGradeFilter = 'all';
let selectedThemeFilter = 'all';
let selectedSubClass = null;

function getDefaultBooths() {
    let list = [];
    let idCounter = 1;
    const themes = ["먹거리", "오락/게임", "체험/전시", "포토존/기타"];

    for (let grade = 1; grade <= 3; grade++) {
        for (let classNum = 1; classNum <= 7; classNum++) {
            let defaultTheme = themes[(classNum + grade) % themes.length];
            list.push({
                id: idCounter++,
                gradeGroup: `${grade}학년`,
                name: `${grade}학년 ${classNum}반 축제 부스`,
                location: `본관 ${grade + 1}층 ${grade}-${classNum} 교실`,
                status: "여유",
                category: defaultTheme
            });
        }
    }

    const specials = [
        { name: "우솔관: 대강당 공연 및 장기자랑", location: "우솔관 1층 대강당", category: "체험/전시" },
        { name: "생명과학실: 과학 실험 체험", location: "과학동 2층", category: "체험/전시" },
        { name: "정보실: 코딩 게임 및 VR", location: "본관 3층", category: "오락/게임" },
        { name: "미술실: 캐리커처", location: "예술동 1층", category: "포토존/기타" }
    ];

    specials.forEach(s => {
        list.push({
            id: idCounter++,
            gradeGroup: "특별구역",
            name: s.name,
            location: s.location,
            status: "보통",
            category: s.category
        });
    });
    return list;
}

async function initFirebaseApp() {
    booths = getDefaultBooths();
    renderBoothGrid();
    populateBoothSelect();

    try {
        if (Object.keys(firebaseConfig).length > 0) {
            const app = initializeApp(firebaseConfig);
            auth = getAuth(app);
            db = getFirestore(app);

            if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
                await signInWithCustomToken(auth, __initial_auth_token);
            } else {
                await signInAnonymously(auth);
            }

            onAuthStateChanged(auth, async (user) => {
                if (user) {
                    currentUserId = user.uid;
                    updateSyncStatus(true, "클라우드 연동됨");
                    await setupRealtimeListener();
                }
            });
        } else {
            updateSyncStatus(false, "오프라인 모드");
        }
    } catch (err) {
        console.error("Firebase Init Error:", err);
        updateSyncStatus(false, "연결 실패");
    }
}

function updateSyncStatus(isConnected, message) {
    const dot = document.getElementById('sync-status-dot');
    const text = document.getElementById('sync-status-text');
    if (dot && text) {
        if (isConnected) {
            dot.className = "w-2 h-2 rounded-full bg-emerald-400";
            text.textContent = message;
        } else {
            dot.className = "w-2 h-2 rounded-full bg-rose-500";
            text.textContent = message;
        }
    }
}

async function setupRealtimeListener() {
    if (!db) return;
    const collectionRef = collection(db, 'artifacts', appId, 'public', 'data');

    // Check if collection is empty, if so populate with defaults
    const snapshot = await getDocs(collectionRef);
    if (snapshot.empty) {
        const defaults = getDefaultBooths();
        for (let booth of defaults) {
            await setDoc(doc(collectionRef, String(booth.id)), booth);
        }
    }

    // Real-time updates across all clients and refreshes
    onSnapshot(collectionRef, (querySnapshot) => {
        let fetchedBooths = [];
        querySnapshot.forEach((docSnap) => {
            fetchedBooths.push(docSnap.data());
        });
        if (fetchedBooths.length > 0) {
            fetchedBooths.sort((a, b) => a.id - b.id);
            booths = fetchedBooths;
            renderBoothGrid();
            populateBoothSelect();
        }
    }, (error) => {
        console.error("Snapshot error:", error);
        updateSyncStatus(false, "동기화 오류");
    });
}

window.updateStatus = async function(newStatus) {
    if (currentManagedBoothId === null) return;

    if (db && currentUserId) {
        try {
            const docRef = doc(db, 'artifacts', appId, 'public', 'data', String(currentManagedBoothId));
            const target = booths.find(b => b.id === currentManagedBoothId);
            if (target) {
                target.status = newStatus;
                await setDoc(docRef, {
                    id: target.id,
                    gradeGroup: target.gradeGroup,
                    name: target.name,
                    location: target.location,
                    status: newStatus,
                    category: target.category
                }, { merge: true });

                showAlert('완료', `부스 상태가 [${newStatus}] (으)로 모든 기기에 실시간 반영되었습니다.`, 'fa-solid fa-circle-check');
            }
        } catch (e) {
            console.error("Update error:", e);
            showAlert('오류', '상태 변경 중 문제가 발생했습니다.', 'fa-solid fa-triangle-exclamation');
        }
    } else {
        booths = booths.map(b => b.id === currentManagedBoothId ? { ...b, status: newStatus } : b);
        renderBoothGrid();
        showAlert('완료', `부스 상태가 [${newStatus}] (으)로 변경되었습니다.`, 'fa-solid fa-circle-check');
    }
}

window.renderBoothGrid = function() {
    const grid = document.getElementById('booth-grid');
    if (!grid) return;
    
    const fragment = document.createDocumentFragment();
    grid.innerHTML = '';

    let filtered = booths.filter(b => {
        if (selectedGradeFilter !== 'all' && b.gradeGroup !== selectedGradeFilter) return false;
        if (selectedThemeFilter !== 'all' && b.category !== selectedThemeFilter) return false;
        if (selectedSubClass && !b.name.includes(selectedSubClass)) return false;
        return true;
    });

    if (filtered.length === 0) {
        grid.innerHTML = `<div class="col-span-full py-12 text-center text-neutral-400 text-sm">해당 조건의 부스가 없습니다.</div>`;
        return;
    }

    filtered.forEach(booth => {
        let badgeStyle = booth.status === '여유' ? 'bg-emerald-100 text-emerald-800 border-emerald-300' : 
                         booth.status === '보통' ? 'bg-amber-100 text-amber-900 border-amber-300' : 
                         'bg-rose-100 text-rose-900 border-rose-300';
        let dotStyle = booth.status === '여유' ? 'bg-emerald-500' : booth.status === '보통' ? 'bg-amber-400' : 'bg-rose-500';

        const card = document.createElement('div');
        card.className = `bg-white rounded-2xl p-5 border border-neutral-200 shadow-xs hover:shadow-md transition flex flex-col justify-between space-y-4`;
        card.innerHTML = `
            <div>
                <div class="flex justify-between items-start mb-2.5">
                    <span class="text-xs font-semibold px-2.5 py-1 rounded-md bg-neutral-100 text-neutral-700">${booth.category}</span>
                    <span class="px-3 py-1 rounded-full text-xs font-bold border flex items-center space-x-1.5 ${badgeStyle}">
                        <span class="w-2 h-2 rounded-full ${dotStyle}"></span>
                        <span>${booth.status}</span>
                    </span>
                </div>
                <h4 class="text-base md:text-lg font-bold text-neutral-900">${booth.name}</h4>
                <p class="text-xs text-neutral-500 mt-1"><i class="fa-solid fa-location-dot text-neutral-400 mr-1"></i>${booth.location}</p>
            </div>
            <div class="pt-3 border-t border-neutral-100 flex justify-between items-center">
                <span class="text-xs text-neutral-400">터치하여 관리</span>
                <button onclick="quickManage(${booth.id})" class="text-xs font-semibold text-black hover:underline active:scale-95">담당자 모드</button>
            </div>
        `;
        fragment.appendChild(card);
    });

    grid.appendChild(fragment);
}

window.filterByType = function(type, value) {
    if (type === 'grade') {
        selectedGradeFilter = value;
        selectedSubClass = null;

        document.querySelectorAll('.filter-grade-btn').forEach(btn => {
            btn.className = "filter-grade-btn px-3 py-1.5 rounded-xl text-xs font-semibold bg-neutral-100 hover:bg-neutral-200 text-neutral-800 transition active:scale-95";
        });
        const activeBtn = document.getElementById(value === 'all' ? 'btn-filter-all' : `filter-${value}`);
        if (activeBtn) activeBtn.className = "filter-grade-btn px-3 py-1.5 rounded-xl text-xs font-bold bg-black text-white transition active:scale-95 shadow-xs";

        const subContainer = document.getElementById('sub-filter-container');
        subContainer.innerHTML = '';
        if (value !== 'all' && value !== '특별구역') {
            for (let i = 1; i <= 7; i++) {
                const subBtn = document.createElement('button');
                subBtn.className = "sub-class-btn px-2.5 py-1 rounded-lg text-xs font-semibold bg-neutral-100 hover:bg-neutral-200 text-neutral-700 transition active:scale-95";
                subBtn.textContent = `${i}반`;
                subBtn.onclick = () => filterByClass(value, i, subBtn);
                subContainer.appendChild(subBtn);
            }
        }
    } else if (type === 'theme') {
        selectedThemeFilter = value;
        document.querySelectorAll('.filter-theme-btn').forEach(btn => {
            btn.className = "filter-theme-btn px-3 py-1.5 rounded-xl text-xs font-semibold bg-neutral-100 hover:bg-neutral-200 text-neutral-800 transition active:scale-95";
        });
        const activeThemeBtn = document.getElementById(value === 'all' ? 'btn-theme-all' : `filter-theme-${value}`);
        if (activeThemeBtn) activeThemeBtn.className = "filter-theme-btn px-3 py-1.5 rounded-xl text-xs font-bold bg-neutral-800 text-white transition active:scale-95";
    }

    renderBoothGrid();
}

function filterByClass(grade, classNum, btnElement) {
    document.querySelectorAll('.sub-class-btn').forEach(b => {
        b.className = "sub-class-btn px-2.5 py-1 rounded-lg text-xs font-semibold bg-neutral-100 text-neutral-700 transition active:scale-95";
    });
    btnElement.className = "sub-class-btn px-2.5 py-1 rounded-lg text-xs font-semibold bg-neutral-800 text-white transition active:scale-95";

    selectedSubClass = `${grade} ${classNum}반`;
    renderBoothGrid();
}

window.populateBoothSelect = function() {
    const select = document.getElementById('login-booth-id');
    if (!select) return;
    select.innerHTML = booths.map(b => `<option value="${b.id}">${b.name}</option>`).join('');
}

window.switchView = function(viewName) {
    document.getElementById('view-main').classList.toggle('hidden', viewName !== 'main');
    document.getElementById('view-admin').classList.toggle('hidden', viewName !== 'admin');
    if (viewName === 'main') {
        currentManagedBoothId = null;
        renderBoothGrid();
    } else {
        const booth = booths.find(b => b.id === currentManagedBoothId);
        if (booth) document.getElementById('admin-booth-title').textContent = booth.name;
    }
}

window.openLoginModal = function() { document.getElementById('login-modal').classList.remove('hidden'); }
window.closeLoginModal = function() { document.getElementById('login-modal').classList.add('hidden'); }

window.handleLogin = function(event) {
    event.preventDefault();
    const boothId = parseInt(document.getElementById('login-booth-id').value);
    if (document.getElementById('login-password').value === '1234') {
        currentManagedBoothId = boothId;
        closeLoginModal();
        switchView('admin');
        document.getElementById('login-password').value = '';
    } else {
        showAlert('실패', '비밀번호가 틀렸습니다. (핀번호: 1234)', 'fa-solid fa-triangle-exclamation');
    }
}

window.quickManage = function(boothId) {
    currentManagedBoothId = boothId;
    openLoginModal();
    document.getElementById('login-booth-id').value = boothId;
}

window.logout = function() { switchView('main'); showAlert('로그아웃', '관리자 모드를 종료합니다.', 'fa-solid fa-circle-check'); }

function showAlert(title, msg, icon) {
    document.getElementById('alert-title').textContent = title;
    document.getElementById('alert-message').textContent = msg;
    document.getElementById('alert-icon').innerHTML = `<i class="${icon}"></i>`;
    document.getElementById('alert-modal').classList.remove('hidden');
}

window.closeAlertModal = function() { document.getElementById('alert-modal').classList.add('hidden'); }

window.onload = initFirebaseApp;