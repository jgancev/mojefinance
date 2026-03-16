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
        safeClick('openAdmin', () => this.showAdmin());
        safeClick('closeAdmin', () => this.hideAdmin());
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
                this.isAdmin = (profile.role === 'admin');
            } else {
                this.user.custom_categories = this.defCats;
            }
        } catch (err) { console.warn(err); }
        this.init();
    },

    init() {
        document.getElementById('authSection').classList.add('hidden');
        document.getElementById('mainSection').classList.remove('hidden');
        
        if (this.isAdmin) {
            document.getElementById('openAdmin')?.classList.remove('hidden');
        }

        this.applyLang();
        document.getElementById('userLabel').innerText = `👤 ${this.user.email}`;
        const today = new Date().toISOString().slice(0,10);
        document.getElementById('expDate').value = today; document.getElementById('incDate').value = today;
        this.renderCats(); this.loadTxns();
    },

    async login() {
        const { data, error } = await db.auth.signInWithPassword({ 
            email: document.getElementById('loginUser').value, 
            password: document.getElementById('loginPass').value 
        });
        if (error) return alert(error.message);
        await this.handleAuth(data.user);
    },

    async register() {
        const { data, error } = await db.auth.signUp({ 
            email: document.getElementById('regUser').value, 
            password: document.getElementById('regPass').value 
        });
        if (error) return alert(error.message);
        if (data.user) {
            await db.from('app_users').insert([{ id: data.user.id, role: 'user', custom_categories: this.defCats }]);
            alert("OK! Teď se přihlas."); this.toggleAuth(false);
        }
    },

    async logout() { await db.auth.signOut(); location.reload(); },

    // --- ADMIN SEKCE ---
    async showAdmin() {
        document.getElementById('adminOverlay').classList.remove('hidden');
        this.loadAdminData();
    },
    hideAdmin() { document.getElementById('adminOverlay').classList.add('hidden'); },

    async loadAdminData() {
        // Anonymní statistiky
        const { count: uCount } = await db.from('app_users').select('*', { count: 'exact', head: true });
        const { count: tCount } = await db.from('transactions').select('*', { count: 'exact', head: true });
        
        document.getElementById('statUsers').innerText = uCount || 0;
        document.getElementById('statTxns').innerText = tCount || 0;
        document.getElementById('statAvg').innerText = (tCount / (uCount || 1)).toFixed(1);

        // Seznam uživatelů
        const { data: users } = await db.from('app_users').select('id, role, lang');
        
        document.getElementById('adminUserList').innerHTML = `
            <div class="admin-row" style="font-weight:bold; border-bottom: 2px solid var(--border)">
                <div>ID Uživatele</div><div>Jazyk</div><div>Akce</div>
            </div>
            ${users.map(u => `
                <div class="admin-row">
                    <div style="font-family:monospace; font-size:0.7rem">${u.id} ${u.id === this.user.id ? '<b>(Já)</b>' : ''}</div>
                    <div>${u.lang}</div>
                    <div>
                        <button onclick="alert('Email s resetem hesla by byl odeslán přes Supabase Auth.')" style="padding:2px 5px; font-size:0.7rem; width:auto">Reset</button>
                        ${u.id !== this.user.id ? `<button onclick="confirm('Opravdu smazat?') && alert('Smazáno (zatím simulace)')" style="padding:2px 5px; font-size:0.7rem; width:auto; background:var(--expense)">Smazat</button>` : ''}
                    </div>
                </div>
            `).join('')}
        `;
    },

    // --- ZBYTEK LOGIKY ---
    async loadTxns() {
        const { data } = await db.from('transactions').select('*').eq('user_id', this.user.id).order('date', {ascending: true});
        this.txns = data || []; this.updateUI();
    },

    updateUI() {
        const now = new Date().toISOString().slice(0,10);
        const balToday = this.txns.filter(t => t.date <= now).reduce((a, b) => a + b.amount, 0);
        const balFuture = this.txns.reduce((a, b) => a + b.amount, 0);
        document.getElementById('balToday').innerText = `${balToday.toLocaleString()} ${this.curr}`;
        document.getElementById('balFuture').innerText = `${balFuture.toLocaleString()} ${this.curr}`;
        document.getElementById('dailyAvg').innerText = `${Math.round(balToday / this.calcDays()).toLocaleString()} ${this.curr}`;
        
        const filtered = this.curMonth === 'all' ? this.txns : this.txns.filter(t => t.date.slice(0,7) === this.curMonth);
        this.renderHistory(filtered, now);
        this.updateChart(filtered);
        this.renderMonthChips();
    },

    renderMonthChips() {
        const months = ['all', ...new Set(this.txns.map(t => t.date.slice(0,7)).sort().reverse())];
        document.getElementById('monthChips').innerHTML = months.map(m => `
            <span class="chip ${this.curMonth===m?'selected':''}" onclick="app.setMonth('${m}')">
                ${m==='all' ? (i18n[this.lang].all || 'Vše') : m}
            </span>`).join('');
    },
    setMonth(m) { this.curMonth = m; this.updateUI(); },

    renderHistory(filtered, now) {
        document.getElementById('txnList').innerHTML = filtered.slice().reverse().map(t => `
            <div class="txn-item ${t.date > now ? 'future' : ''}">
                <div><strong>${t.description}</strong><br><small>${t.date}</small></div>
                <div style="color:${t.amount>0?'var(--income)':'var(--expense)'}">
                    <strong>${t.amount.toLocaleString()}</strong>
                    <i class="icon-btn" onclick="app.delTxn('${t.id}')">✕</i>
                </div>
            </div>`).join('');
    },

    async saveTxn(isInc) {
        const prefix = isInc ? 'inc' : 'exp';
        const d = document.getElementById(prefix+'Date').value;
        const desc = document.getElementById(prefix+'Desc').value;
        const amt = parseFloat(document.getElementById(prefix+'Amt').value);
        if(!desc || isNaN(amt)) return;
        await db.from('transactions').insert([{ 
            user_id: this.user.id, description: desc, amount: isInc?amt:-amt, 
            category: isInc?(this.lang==='cs'?'Příjem':'Income'):document.getElementById('expCat').value, date: d 
        }]);
        this.loadTxns();
    },

    async delTxn(id) { if(confirm(i18n[this.lang].confirmDel)) { await db.from('transactions').delete().eq('id', id); this.loadTxns(); } },

    renderCats() {
        document.getElementById('expCat').innerHTML = this.user.custom_categories.map(c => `<option>${c}</option>`).join('');
        document.getElementById('catEditor').innerHTML = this.user.custom_categories.map((c, i) => `
            <div style="display:flex; gap:5px; margin-bottom:5px">
                <input type="text" value="${c}" onchange="app.editCat(${i}, this.value)">
                <button onclick="app.delCat(${i})" style="width:auto; background:var(--expense)">✕</button>
            </div>`).join('');
    },
    async editCat(i,v) { this.user.custom_categories[i]=v; await this.savePref(); },
    async addCat() { this.user.custom_categories.push("Nová"); await this.savePref(); this.renderCats(); },
    async delCat(i) { this.user.custom_categories.splice(i,1); await this.savePref(); this.renderCats(); },

    async updatePref(key, val) { 
        this[key] = val; if(key==='lang') localStorage.setItem('lang', val); 
        await this.savePref(); this.applyLang(); this.updateUI(); 
    },
    async savePref() { if(this.user) await db.from('app_users').update({ custom_categories:this.user.custom_categories, lang: this.lang, currency: this.curr }).eq('id', this.user.id); },

    applyLang() {
        const l = i18n[this.lang];
        Object.keys(l).forEach(k => { const el = document.getElementById('t-'+k); if(el) el.innerText = l[k]; });
        const map = { 'saveExpBtn': l.save, 'saveIncBtn': l.save, 'logoutBtn': l.logout, 'closeSettings': l.close, 'loginBtn': l.loginBtn, 'regBtn': l.regBtn };
        Object.entries(map).forEach(([id, txt]) => { const el = document.getElementById(id); if(el) el.innerText = txt; });
        this.updateThemeBtn();
    },

    toggleLang() { this.lang = this.lang === 'cs' ? 'en' : 'cs'; localStorage.setItem('lang', this.lang); this.applyLang(); },
    showSettings() { document.getElementById('settingsOverlay').classList.remove('hidden'); },
    hideSettings() { document.getElementById('settingsOverlay').classList.add('hidden'); },
    toggleAuth(reg) { document.getElementById('loginBox').classList.toggle('hidden', reg); document.getElementById('regBox').classList.toggle('hidden', !reg); },
    calcDays() {
        const today = new Date(); const target = new Date(today.getFullYear(), today.getMonth() + 1, 1);
        let wd = 0; while(true) { let d = target.getDay(); if(d !== 0 && d !== 6) wd++; if(wd === 2) break; target.setDate(target.getDate()+1); }
        return Math.max(1, Math.ceil((target - today) / 86400000));
    },
    updateChart(list) {
        const ctx = document.getElementById('myChart'); if(!ctx) return;
        const data = {}; list.filter(t => t.amount < 0).forEach(t => data[t.category] = (data[t.category]||0) + Math.abs(t.amount));
        if(chart) chart.destroy();
        chart = new Chart(ctx, { type: 'doughnut', data: { labels: Object.keys(data), datasets: [{ data: Object.values(data), backgroundColor: ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'] }] }, options: { plugins: { legend: { display:false } } } });
    },
    cycleTheme() {
        this.theme = this.theme === 'light' ? 'dark' : (this.theme === 'dark' ? 'amoled' : 'light');
        localStorage.setItem('theme', this.theme); this.applyTheme();
    },
    applyTheme() {
        document.body.classList.remove('dark', 'amoled');
        if (this.theme !== 'light') document.body.classList.add(this.theme);
        this.updateThemeBtn();
    },
    updateThemeBtn() {
        const btn = document.getElementById('themeBtn'); if (btn) btn.innerText = `🌓 Mode: ${this.theme}`;
    }
};

window.app = app;
app.start();
