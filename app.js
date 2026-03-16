import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';
import { config } from './config.js';
import { i18n } from './translations.js';

const db = createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY);
let chart = null;

const app = {
    user: null, txns: [], curMonth: 'all', editingId: null, isAdmin: false,
    lang: localStorage.getItem('lang') || 'cs', 
    curr: 'Kč', 
    theme: localStorage.getItem('theme') || 'light',
    defCats: ["Jídlo 🍕", "Běžné 🏠", "Blbosti 🛍️", "Nadstandartní ✨", "Spoření 💰"],

    async start() {
        this.applyTheme();
        this.applyLang();
        this.setupEventListeners();
        
        const { data: { session } } = await db.auth.getSession();
        if (session) { 
            await this.handleAuth(session.user); 
        } else { 
            document.getElementById('authSection').classList.remove('hidden'); 
        }
    },

    setupEventListeners() {
        const safeClick = (id, fn) => { const el = document.getElementById(id); if(el) el.onclick = fn; };
        
        safeClick('loginBtn', () => this.login());
        safeClick('regBtn', () => this.register());
        safeClick('logoutBtn', () => this.logout());
        safeClick('toggleLangBtn', () => this.toggleLang());
        safeClick('themeBtn', () => this.cycleTheme());
        safeClick('openSettings', () => this.showSettings());
        safeClick('closeSettings', () => this.hideSettings());
        safeClick('saveExpBtn', () => this.saveTxn(false));
        safeClick('saveIncBtn', () => this.saveTxn(true));
        safeClick('addCatBtn', () => this.addCat());
        
        document.getElementById('toReg').onclick = (e) => { e.preventDefault(); this.toggleAuth(true); };
        document.getElementById('toLogin').onclick = (e) => { e.preventDefault(); this.toggleAuth(false); };
        document.getElementById('stLang').onchange = (e) => this.updatePref('lang', e.target.value);
        document.getElementById('stCurr').onchange = (e) => this.updatePref('curr', e.target.value);
    },

    async handleAuth(authUser) {
        this.user = authUser;
        try {
            const { data: profile } = await db.from('app_users').select('*').eq('id', authUser.id).maybeSingle();
            if (profile) {
                this.lang = profile.lang || this.lang; 
                this.curr = profile.currency || this.curr;
                this.user.custom_categories = profile.custom_categories || this.defCats;
                
                // JEDINÝ ZDROJ PRAVDY: Sloupec 'role'
                this.isAdmin = (profile.role === 'admin');
                console.log("Status přihlášení:", this.isAdmin ? "👑 ADMIN" : "👤 UŽIVATEL");
            } else {
                this.user.custom_categories = this.defCats;
                this.isAdmin = false;
            }
        } catch (err) {
            console.warn("Chyba při načítání profilu:", err);
            this.user.custom_categories = this.defCats;
        }
        this.init();
    },

    init() {
        document.getElementById('authSection').classList.add('hidden');
        document.getElementById('mainSection').classList.remove('hidden');
        
        // Zobrazení/skrytí Admin Panelu
        const adminTab = document.getElementById('adminOnly');
        if (adminTab) {
            if (this.isAdmin) adminTab.classList.remove('hidden');
            else adminTab.classList.add('hidden');
        }

        this.applyLang();
        document.getElementById('userLabel').innerText = `👤 ${this.user.email}`;
        const today = new Date().toISOString().slice(0,10);
        document.getElementById('expDate').value = today; 
        document.getElementById('incDate').value = today;
        this.renderCats(); 
        this.loadTxns();
    },

    async login() {
        const email = document.getElementById('loginUser').value.trim();
        const password = document.getElementById('loginPass').value;
        const { data, error } = await db.auth.signInWithPassword({ email, password });
        if (error) return alert(error.message);
        await this.handleAuth(data.user);
    },

    async register() {
        const email = document.getElementById('regUser').value.trim();
        const password = document.getElementById('regPass').value;
        const { data, error } = await db.auth.signUp({ email, password });
        if (error) return alert(error.message);
        if (data.user) {
            await db.from('app_users').insert([{ 
                id: data.user.id, 
                username: email.split('@')[0], 
                custom_categories: this.defCats, 
                lang: this.lang, 
                currency: this.curr,
                role: 'user' 
            }]);
            alert("Účet vytvořen!");
            this.toggleAuth(false);
        }
    },

    async logout() { await db.auth.signOut(); location.reload(); },

    async loadTxns() {
        const { data, error } = await db.from('transactions').select('*').eq('user_id', this.user.id).order('date', {ascending: true});
        this.txns = data || []; 
        this.updateUI();
    },

    updateUI() {
        const now = new Date().toISOString().slice(0,10);
        const balToday = this.txns.filter(t => t.date <= now).reduce((a, b) => a + b.amount, 0);
        const balFuture = this.txns.reduce((a, b) => a + b.amount, 0);
        
        document.getElementById('balToday').innerText = `${balToday.toLocaleString()} ${this.curr}`;
        document.getElementById('balFuture').innerText = `${balFuture.toLocaleString()} ${this.curr}`;
        document.getElementById('dailyAvg').innerText = `${Math.round(balToday / this.calcDays()).toLocaleString()} ${this.curr}`;
        
        const months = ['all', ...new Set(this.txns.map(t => t.date.slice(0,7)).sort().reverse())];
        document.getElementById('monthChips').innerHTML = months.map(m => `
            <span class="chip ${this.curMonth===m?'selected':''}" data-month="${m}">
                ${m==='all'? (i18n[this.lang].all || 'Vše') : m}
            </span>`).join('');
        
        document.querySelectorAll('.chip').forEach(c => {
            c.onclick = () => { this.curMonth = c.dataset.month; this.updateUI(); };
        });

        const filtered = this.curMonth === 'all' ? this.txns : this.txns.filter(t => t.date.slice(0,7) === this.curMonth);
        this.renderHistory(filtered, now);
        this.updateChart(filtered);
    },

    renderHistory(filtered, now) {
        document.getElementById('txnList').innerHTML = filtered.slice().reverse().map(t => {
            if(this.editingId === t.id) return this.renderEditRow(t);
            return `
                <div class="txn-item ${t.date > now ? 'future' : ''}">
                    <div><strong>${t.description}</strong><br><small>${t.date > now ? '⏳ ':''}${t.date} • ${t.category}</small></div>
                    <div style="color:${t.amount>0?'var(--income)':'var(--expense)'}">
                        <strong>${t.amount.toLocaleString()} ${this.curr}</strong>
                        <i class="icon-btn edit-btn" data-id="${t.id}">✏️</i>
                        <i class="icon-btn del-btn" data-id="${t.id}">✕</i>
                    </div>
                </div>`;
        }).join('');
        document.querySelectorAll('.edit-btn').forEach(btn => btn.onclick = () => { this.editingId = btn.dataset.id; this.updateUI(); });
        document.querySelectorAll('.del-btn').forEach(btn => btn.onclick = () => this.delTxn(btn.dataset.id));
    },

    renderEditRow(t) {
        const cats = t.amount > 0 ? [(this.lang==='cs'?'Příjem':'Income')] : this.user.custom_categories;
        const l = i18n[this.lang];
        setTimeout(() => {
            document.getElementById('saveEditBtn').onclick = () => this.saveEdit(t.id, t.amount > 0);
            document.getElementById('cancelEditBtn').onclick = () => { this.editingId = null; this.updateUI(); };
        }, 0);
        return `<div class="edit-box">
                <input type="date" id="edDate" value="${t.date}"><input type="text" id="edDesc" value="${t.description}">
                <input type="number" id="edAmt" value="${Math.abs(t.amount)}"><select id="edCat">${cats.map(c=>`<option ${t.category===c?'selected':''}>${c}</option>`).join('')}</select>
                <div style="display:flex; gap:5px"><button id="saveEditBtn">${l.save}</button><button id="cancelEditBtn" style="background:#64748b">${l.back}</button></div>
            </div>`;
    },

    async saveEdit(id, isInc) {
        const amt = document.getElementById('edAmt').value;
        await db.from('transactions').update({ date: document.getElementById('edDate').value, description: document.getElementById('edDesc').value, amount: isInc ? Math.abs(amt) : -Math.abs(amt), category: document.getElementById('edCat').value }).eq('id', id);
        this.editingId = null; this.loadTxns();
    },

    async saveTxn(isInc) {
        const d = isInc ? document.getElementById('incDate').value : document.getElementById('expDate').value;
        const desc = (isInc ? document.getElementById('incDesc').value : document.getElementById('expDesc').value).trim();
        const amt = parseFloat(isInc ? document.getElementById('incAmt').value : document.getElementById('expAmt').value);
        if(!desc || isNaN(amt)) return;
        await db.from('transactions').insert([{ user_id: this.user.id, description: desc, amount: isInc?amt:-amt, category: isInc?(this.lang==='cs'?'Příjem':'Income'):document.getElementById('expCat').value, date: d }]);
        this.loadTxns(); if(isInc) document.getElementById('incAmt').value=''; else document.getElementById('expAmt').value='';
    },

    async delTxn(id) { if(confirm(i18n[this.lang].confirmDel)) { await db.from('transactions').delete().eq('id', id); this.loadTxns(); } },

    renderCats() {
        const catSelect = document.getElementById('expCat');
        if(catSelect) catSelect.innerHTML = this.user.custom_categories.map(c => `<option value="${c}">${c}</option>`).join('');
        const catEditor = document.getElementById('catEditor');
        if(catEditor) {
            catEditor.innerHTML = this.user.custom_categories.map((c, i) => `<div style="display:flex; gap:5px; margin-bottom:5px"><input type="text" value="${c}" class="cat-input" data-idx="${i}" style="margin:0"><button class="cat-del" data-idx="${i}" style="width:auto; background:var(--expense); margin:0">✕</button></div>`).join('');
            document.querySelectorAll('.cat-input').forEach(inp => inp.onchange = (e) => this.editCat(inp.dataset.idx, e.target.value));
            document.querySelectorAll('.cat-del').forEach(btn => btn.onclick = () => this.delCat(btn.dataset.idx));
        }
    },

    async editCat(i,v) { this.user.custom_categories[i]=v; await this.savePref(); },
    async addCat() { if(this.user.custom_categories.length<10){this.user.custom_categories.push("Nová"); await this.savePref(); this.renderCats();} },
    async delCat(i) { this.user.custom_categories.splice(i,1); await this.savePref(); this.renderCats(); },

    async updatePref(key, val) { 
        if(key === 'lang') { this.lang = val; localStorage.setItem('lang', val); } 
        if(key === 'curr') this.curr = val; 
        await this.savePref(); this.applyLang(); this.updateUI(); 
    },
    async savePref() { if(this.user) await db.from('app_users').update({ custom_categories:this.user.custom_categories, lang: this.lang, currency: this.curr, role: this.isAdmin ? 'admin' : 'user' }).eq('id', this.user.id); },

    applyLang() {
        const l = i18n[this.lang];
        if(!l) return;
        
        Object.keys(l).forEach(key => {
            const el = document.getElementById('t-' + key);
            if(el) el.innerText = l[key];
        });

        const btnMap = {
            'saveExpBtn': l.save, 'saveIncBtn': l.save, 'logoutBtn': l.logout, 
            'closeSettings': l.close, 'loginBtn': l.loginBtn, 'regBtn': l.regBtn,
            'addCatBtn': '+ ' + (l.add || 'Add')
        };
        Object.entries(btnMap).forEach(([id, text]) => {
            const el = document.getElementById(id);
            if(el) el.innerText = text;
        });

        const phMap = {
            'expDesc': l.placeholderExp, 'incDesc': l.placeholderInc,
            'loginUser': l.userPH, 'regUser': l.userPH, 
            'loginPass': l.passPH, 'regPass': l.passPH
        };
        Object.entries(phMap).forEach(([id, text]) => {
            const el = document.getElementById(id);
            if(el) el.placeholder = text;
        });

        if(document.getElementById('stLang')) document.getElementById('stLang').value = this.lang;
        if(document.getElementById('stCurr')) document.getElementById('stCurr').value = this.curr;
        this.updateThemeBtn();
    },

    toggleLang() { this.lang = this.lang === 'cs' ? 'en' : 'cs'; localStorage.setItem('lang', this.lang); this.applyLang(); },
    showSettings() { document.getElementById('settingsOverlay').classList.remove('hidden'); },
    hideSettings() { document.getElementById('settingsOverlay').classList.add('hidden'); },
    toggleAuth(reg) { document.getElementById('loginBox').classList.toggle('hidden', reg); document.getElementById('regBox').classList.toggle('hidden', !reg); this.applyLang(); },
    calcDays() {
        const today = new Date(); const target = new Date(today.getFullYear(), today.getMonth() + 1, 1);
        let wd = 0; while(true) { let d = target.getDay(); if(d !== 0 && d !== 6) wd++; if(wd === 2) break; target.setDate(target.getDate()+1); }
        return Math.max(1, Math.ceil((target - today) / 86400000));
    },
    updateChart(list) {
        const ctx = document.getElementById('myChart'); if(!ctx) return;
        const data = {}; list.filter(t => t.amount < 0).forEach(t => data[t.category] = (data[t.category]||0) + Math.abs(t.amount));
        if(chart) chart.destroy();
        chart = new Chart(ctx, { type: 'doughnut', data: { labels: Object.keys(data), datasets: [{ data: Object.values(data), backgroundColor: ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#f97316', '#71717a', '#22c55e'] }] }, options: { plugins: { legend: { display:false } } } });
    },
    cycleTheme() {
        if (this.theme === 'light') this.theme = 'dark';
        else if (this.theme === 'dark') this.theme = 'amoled';
        else this.theme = 'light';
        localStorage.setItem('theme', this.theme);
        this.applyTheme();
    },
    applyTheme() {
        document.body.classList.remove('dark', 'amoled');
        if (this.theme !== 'light') document.body.classList.add(this.theme);
        this.updateThemeBtn();
    },
    updateThemeBtn() {
        const btn = document.getElementById('themeBtn'); if (!btn) return;
        const name = this.theme === 'light' ? i18n[this.lang].themeLight : (this.theme === 'dark' ? i18n[this.lang].themeDark : i18n[this.lang].themeAmoled);
        btn.innerText = `🌓 Mode: ${name}`;
    }
};

app.start();
