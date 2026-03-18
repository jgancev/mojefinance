import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';
import { config } from './config.js';

const db = createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY);
let chart = null;

const app = {
    user: null, txns: [], curMonth: 'all', isAdmin: false,
    curr: 'Kč', theme: localStorage.getItem('theme') || 'dark',
    defCats: ["Jídlo 🍕", "Běžné 🏠", "Nákupy 🛍️", "Ostatní ⚙️"],

    async start() {
        this.applyTheme();
        this.setupListeners();
        const { data: { session } } = await db.auth.getSession();
        if (session) await this.handleAuth(session.user);
        else document.getElementById('authSection').classList.remove('hidden');
    },

    setupListeners() {
        const get = (id) => document.getElementById(id);
        get('loginBtn').onclick = () => this.login();
        get('logoutBtn').onclick = () => this.logout();
        get('themeBtn').onclick = () => this.cycleTheme();
        get('openSettings').onclick = () => get('settingsOverlay').classList.remove('hidden');
        get('closeSettings').onclick = () => get('settingsOverlay').classList.add('hidden');
        get('openAdmin').onclick = () => this.showAdmin();
        get('closeAdmin').onclick = () => get('adminOverlay').classList.add('hidden');
        get('saveExpBtn').onclick = () => this.saveTxn(false);
        get('saveIncBtn').onclick = () => this.saveTxn(true);
        get('addCatBtn').onclick = () => this.addCat();
        get('stCurr').onchange = (e) => this.updateCurr(e.target.value);
    },

    async handleAuth(authUser) {
        this.user = authUser;
        const { data: prof } = await db.from('app_users').select('*').eq('id', authUser.id).maybeSingle();
        if (prof) {
            this.isAdmin = (prof.role === 'admin');
            this.curr = prof.currency || 'Kč';
            this.user.custom_categories = prof.custom_categories || this.defCats;
        }
        this.init();
    },

    init() {
        document.getElementById('authSection').classList.add('hidden');
        document.getElementById('mainSection').classList.remove('hidden');
        if (this.isAdmin) document.getElementById('openAdmin').classList.remove('hidden');
        document.getElementById('userLabel').innerText = this.user.email;
        const today = new Date().toISOString().slice(0,10);
        document.getElementById('expDate').value = today;
        document.getElementById('incDate').value = today;
        this.renderCats();
        this.loadTxns();
    },

    async login() {
        const { data, error } = await db.auth.signInWithPassword({ 
            email: document.getElementById('loginUser').value, 
            password: document.getElementById('loginPass').value 
        });
        if (error) alert(error.message); else this.handleAuth(data.user);
    },

    async logout() { await db.auth.signOut(); location.reload(); },

    // --- ADMIN PANEL LOGIKA ---
    async showAdmin() {
        document.getElementById('adminOverlay').classList.remove('hidden');
        const { data: users } = await db.from('app_users').select('*');
        const list = document.getElementById('adminUserList');
        
        list.innerHTML = (users || []).map(u => `
            <div class="txn-item" style="flex-direction:column; align-items:flex-start; gap:12px; padding:20px 0">
                <span><b style="font-size:1.1rem">${u.email || u.id}</b></span>
                <div style="display:flex; gap:10px; width:100%">
                    <input type="password" id="newPass_${u.id}" placeholder="Nové heslo" style="margin:0; flex:1">
                    <button onclick="app.adminReset('${u.id}')" style="width:auto; padding:0 20px; background:var(--primary); margin:0">Reset</button>
                    <button onclick="app.adminDelete('${u.id}')" style="width:auto; padding:0 20px; background:var(--expense); margin:0">Smazat</button>
                </div>
            </div>
        `).join('');
    },

    async adminReset(uid) {
        const newPass = document.getElementById(`newPass_${uid}`).value;
        if (!newPass || newPass.length < 6) return alert("Heslo musí mít aspoň 6 znaků.");
        
        if (confirm("Opravdu chcete změnit heslo tomuto uživateli?")) {
            const adminPass = prompt("Potvrďte akci SVÝM admin heslem:");
            if (!adminPass) return;
            
            // Ověření admina
            const { error } = await db.auth.signInWithPassword({ email: this.user.email, password: adminPass });
            if (!error) {
                alert("Požadavek přijat. (Samotná změna hesla jiného uživatele vyžaduje Supabase Edge Function).");
            } else {
                alert("Chybné admin heslo!");
            }
        }
    },

    async adminDelete(uid) {
        if (confirm("Smazat uživatele? Tato akce je nevratná.")) {
            const adminPass = prompt("Potvrďte smazání SVÝM admin heslem:");
            if (!adminPass) return;
            
            const { error } = await db.auth.signInWithPassword({ email: this.user.email, password: adminPass });
            if (!error) {
                await db.from('app_users').delete().eq('id', uid);
                this.showAdmin();
            } else {
                alert("Chybné admin heslo!");
            }
        }
    },

    // --- DATA A UI ---
    async loadTxns() {
        const { data } = await db.from('transactions').select('*').eq('user_id', this.user.id).order('date', {ascending: false});
        this.txns = data || [];
        this.updateUI();
    },

    updateUI() {
        const now = new Date().toISOString().slice(0,10);
        const total = this.txns.filter(t => t.date <= now).reduce((a, b) => a + b.amount, 0);
        document.getElementById('balToday').innerText = `${total.toLocaleString()} ${this.curr}`;
        
        const filtered = this.curMonth === 'all' ? this.txns : this.txns.filter(t => t.date.slice(0,7) === this.curMonth);
        document.getElementById('txnList').innerHTML = filtered.map(t => `
            <div class="txn-item">
                <span><b>${t.description}</b><br><small>${t.date} • ${t.category}</small></span>
                <span style="color:${t.amount>0?'var(--income)':'var(--expense)'}">${t.amount.toLocaleString()}</span>
            </div>`).join('');

        this.renderMonthChips();
        this.updateChart(filtered);
        this.calcDaily(total);
    },

    calcDaily(bal) {
        const lastDay = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
        const days = Math.max(1, lastDay - new Date().getDate());
        document.getElementById('dailyAvg').innerText = `${Math.round(bal / days).toLocaleString()} ${this.curr}`;
    },

    renderMonthChips() {
        const months = ['all', ...new Set(this.txns.map(t => t.date.slice(0,7)).sort().reverse())];
        document.getElementById('monthChips').innerHTML = months.map(m => `
            <span class="chip ${this.curMonth===m?'selected':''}" onclick="app.setMonth('${m}')">${m}</span>`).join('');
    },
    setMonth(m) { this.curMonth = m; this.updateUI(); },

    async saveTxn(isInc) {
        const pre = isInc ? 'inc' : 'exp';
        const amt = parseFloat(document.getElementById(pre+'Amt').value);
        if (isNaN(amt)) return;
        await db.from('transactions').insert([{
            user_id: this.user.id, amount: isInc?amt:-amt, description: document.getElementById(pre+'Desc').value,
            category: isInc?'Příjem':document.getElementById('expCat').value,
            date: document.getElementById(pre+'Date').value
        }]);
        this.loadTxns();
    },

    renderCats() {
        const cats = this.user.custom_categories || this.defCats;
        document.getElementById('expCat').innerHTML = cats.map(c => `<option>${c}</option>`).join('');
        document.getElementById('catEditor').innerHTML = cats.map((c, i) => `
            <div style="display:flex; gap:5px; margin-bottom:5px"><input value="${c}" onchange="app.editCat(${i}, this.value)"></div>`).join('');
    },
    async editCat(i, v) { this.user.custom_categories[i] = v; await this.savePref(); },
    async addCat() { this.user.custom_categories.push("Nová"); await this.savePref(); this.renderCats(); },
    async updateCurr(v) { this.curr = v; await this.savePref(); this.updateUI(); },
    async savePref() { await db.from('app_users').update({ custom_categories: this.user.custom_categories, currency: this.curr }).eq('id', this.user.id); },

    updateChart(list) {
        const ctx = document.getElementById('myChart');
        const data = {}; list.filter(t => t.amount < 0).forEach(t => data[t.category] = (data[t.category] || 0) + Math.abs(t.amount));
        if (chart) chart.destroy();
        chart = new Chart(ctx, { 
            type: 'doughnut', 
            data: { labels: Object.keys(data), datasets: [{ data: Object.values(data), backgroundColor: ['#0081ff', '#10b981', '#f59e0b', '#ef4444', '#a855f7'] }] }, 
            options: { plugins: { legend: { display: false } }, cutout: '70%' } 
        });
    },

    cycleTheme() {
        this.theme = this.theme === 'light' ? 'dark' : (this.theme === 'dark' ? 'amoled' : 'light');
        localStorage.setItem('theme', this.theme);
        this.applyTheme();
    },
    applyTheme() {
        document.body.classList.remove('dark', 'amoled');
        if (this.theme !== 'light') document.body.classList.add(this.theme);
        document.getElementById('themeBtn').innerText = `🌓 Mode: ${this.theme}`;
    }
};

window.app = app;
app.start();
